/**
 * The pager: what a signal of the rules does to the things that the maintainer
 * sees. One message per thing, in a topic of its own, edited in place as its state
 * changes; a new message, which notifies, only for a new thing, a bundle that
 * opens again, which keeps its topic, a new comment on a discussion, a comment
 * that opens a thing again, the answer of a draft or a fix, and the pictures of a
 * visual change.
 */
import { keyboard } from "./buttons.ts";
import { type ReleaseNotes, releaseNotes } from "./content.ts";
import type { Local } from "./context.ts";
import { type GitHub, GitHubError } from "./github.ts";
import {
  ARTIFACT,
  type Artifact,
  album,
  MAX_ARTIFACT,
  MAX_ARTIFACTS,
  MAX_LISTED,
  readArtifact,
} from "./pictures.ts";
import {
  ACKNOWLEDGE_DAYS,
  html,
  link,
  type PicturesView,
  picturesText,
  render,
} from "./render.ts";
import {
  type ContributionEnd,
  type DiscussionEnd,
  picturesBlocker,
  releaseBlocker,
  releaseVersion,
  type Signal,
} from "./rules.ts";
import type { Settings } from "./settings.ts";
import {
  type Advisory,
  type Alarm,
  type Alert,
  answering,
  type Contribution,
  type Discussion,
  type Entry,
  type IssueComment,
  type Item,
  isClosed,
  itemId,
  keys,
  type Pictures,
  type Release,
  type Store,
} from "./store.ts";
import {
  type Photo,
  type Telegram,
  TelegramError,
  type Thread,
} from "./telegram.ts";
import { type Texts, texts } from "./texts.ts";
import { retitle, sendThing } from "./topics.ts";

export interface Context {
  settings: Settings;
  store: Store;
  telegram: Telegram;
  github: GitHub;
  /** Every text that goes to the maintainer, in the language of the settings. */
  t: Texts;
  now: () => number;
  /** Wait, such as for GitHub to work out whether a pull request can merge. */
  sleep: (milliseconds: number) => Promise<void>;
  /** Run a change of the state after every change before it, as src/serial.ts does. */
  exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  /** The storage of the Durable Object, for the pager's notes on itself (src/health.ts). */
  local: Local;
  /** How many calls to Telegram and GitHub this request or run made so far. */
  subrequests: () => number;
}

/** The words of the log, which stays in English. */
const english = texts("en");

/** How often to ask again while GitHub still works out whether a pull request can merge. */
export const MERGEABLE_TRIES = 3;

/**
 * How long after a comment on an issue or a pull request notified the maintainer
 * the comments that follow only edit the message of its thing, in milliseconds: a
 * few quick comments notify once.
 */
export const QUIET = 10 * 60_000;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Show a thing: edit its message, or send a new one when it has none, when it is
 * gone, or with fresh, which also deletes the old one, as "Later" does when its
 * time is up. A new message goes into the thing's topic, and its first one opens
 * that; the name of the topic follows the thing. Then keep its state.
 */
export async function show(
  context: Context,
  item: Item,
  fresh = false,
): Promise<void> {
  const text = render(item, context.now(), context.t);
  const buttons = keyboard(item, context.t);
  const old = item.messageId;
  const shown =
    old !== null && !fresh
      ? await context.telegram.edit(old, text, buttons)
      : false;
  if (!shown) {
    item.messageId = await sendThing(context, item, text, buttons);
    if (old !== null && fresh) {
      await context.telegram.remove(old);
    }
  }
  await retitle(context, item);
  await context.store.put(item);
}

/**
 * Send a thing to the workflow of the control repository, as an event of its own.
 * Returns why it couldn't go, or null once it went.
 */
export async function toControl(
  context: Context,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const repo = context.settings.controlRepository;
  const installation = await context.github.installation(repo);
  if (installation === null) {
    return context.t("answer.notInstalled", { repo });
  }
  // The answers of the control repository to the maintainer come in their language.
  await context.github.dispatch(installation, repo, eventType, {
    ...payload,
    language: context.t.language,
  });
  return null;
}

/**
 * Ask the control repository for the draft of a reply to a contribution. Once the
 * event went, the thing waits for the job, until any answer comes, and the caller
 * shows it. Returns why it couldn't go, or null once it went.
 */
export async function askForDraft(
  context: Context,
  item: Contribution,
): Promise<string | null> {
  const { discussion, comment } = item;
  const failed = await toControl(context, "pager-draft", {
    item: item.id,
    repo: item.repo,
    number: item.number,
    pull: item.pull,
    // A discussion names the comment that the reply answers, if it answers one,
    // by its id in GraphQL; an issue or a pull request by its id in REST, as
    // issueComment, which a control repository from before it ignores.
    ...(discussion === undefined
      ? {}
      : {
          discussion: true,
          ...(discussion.comment === undefined
            ? {}
            : { comment: discussion.comment }),
        }),
    ...(comment === undefined ? {} : { issueComment: comment.id }),
  });
  if (failed === null) {
    item.state = "drafting";
    item.jobStarted = context.now();
    // The job just asked for answers the newest comment.
    delete answering(item)?.redraft;
  }
  return failed;
}

/** Ask for the draft of a discussion; returns why it couldn't, or null once it could. */
export async function draftOrWhyNot(
  context: Context,
  item: Contribution,
): Promise<string | null> {
  try {
    return await askForDraft(context, item);
  } catch (error) {
    if (!(error instanceof GitHubError)) {
      throw error;
    }
    return context.t("answer.refused", { detail: error.detail });
  }
}

function base(id: string, repo: string, installation: number) {
  return {
    id,
    repo,
    installation,
    messageId: null,
    note: null,
    snoozedUntil: null,
    topic: null,
  };
}

/** The start of what a signal's issue, pull request, discussion or comment says, as a field of its thing. */
function excerptOf(signal: { excerpt?: string }): { excerpt?: string } {
  return signal.excerpt === undefined ? {} : { excerpt: signal.excerpt };
}

/** Whether two notes of a release are the same, such as before and after an edit of its title alone. */
function sameNotes(
  one: ReleaseNotes | undefined,
  other: ReleaseNotes | undefined,
): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/** Whether two entries of a bundle show the same. */
function sameEntry(one: Entry, other: Entry): boolean {
  return (
    one.label === other.label &&
    one.url === other.url &&
    one.run === other.run &&
    one.rerun === other.rerun
  );
}

/**
 * Add an entry to the bundle of a repository, or change the one with its key; a
 * closed bundle opens anew. With only, only an entry of an open bundle changes,
 * and nothing opens. An entry that shows the same writes nothing.
 */
async function addEntry(
  context: Context,
  kind: "alarm" | "alert",
  repo: string,
  installation: number,
  entry: Entry,
  only: "change" | null = null,
): Promise<string> {
  const id = await itemId(
    kind === "alarm" ? keys.alarm(repo) : keys.alert(repo),
  );
  const known = (await context.store.get(id)) as Alarm | Alert | null;
  if (known === null || isClosed(known)) {
    if (only === "change") {
      return `no open ${kind}`;
    }
    const item = {
      ...base(id, repo, installation),
      kind,
      state: "open",
      entries: [entry],
      // The bundles of a kind and a repository share one topic.
      topic: known?.topic ?? null,
    } as Alarm | Alert;
    // A bundle that opens again gets a new message, which notifies, in the topic
    // that it had; the old one keeps its last state as history.
    await show(context, item);
    return `${kind} opened`;
  }
  const index = known.entries.findIndex((each) => each.key === entry.key);
  const shown = known.entries[index];
  if (shown === undefined) {
    if (only === "change") {
      return `not part of the ${kind}`;
    }
    known.entries.push(entry);
  } else if (sameEntry(shown, entry)) {
    return `${kind} unchanged`;
  } else {
    known.entries[index] = entry;
  }
  await show(context, known);
  return `${kind} updated`;
}

/**
 * The entry of an alert of secret scanning in the security message of its
 * repository: the kind of its secret and the file in which it was first found,
 * never the secret. A place that GitHub doesn't show the app, such as before the
 * app may read secret scanning, leaves the entry without its file.
 */
async function secretEntry(
  context: Context,
  signal: Extract<Signal, { type: "secret-open" }>,
): Promise<Entry> {
  let path: string | undefined;
  try {
    path = await context.github.secretPath(
      signal.installation,
      signal.repo,
      signal.number,
    );
  } catch (error) {
    if (!(error instanceof GitHubError)) {
      throw error;
    }
    console.warn(
      `The place of secret alert ${signal.number} of ${signal.repo}: ${error.message}`,
    );
  }
  const what = signal.what;
  const label =
    path === undefined
      ? context.t(signal.leaked ? "entry.secretPublic" : "entry.secret", {
          what,
        })
      : context.t(signal.leaked ? "entry.secretPublicAt" : "entry.secretAt", {
          what,
          path,
        });
  return { key: signal.key, label, url: signal.url };
}

/**
 * A private vulnerability report: a thing of its own, once, which notifies. The
 * schedule looks on the day before the acknowledgement is due whether it still
 * waits in triage, unless it came too late for that.
 */
async function advisory(
  context: Context,
  signal: Extract<Signal, { type: "advisory" }>,
): Promise<string> {
  const id = await itemId(keys.advisory(signal.repo, signal.ghsa));
  if ((await context.store.get(id)) !== null) {
    return "advisory shown already";
  }
  const reported = signal.reported ?? context.now();
  const remindAt = reported + (ACKNOWLEDGE_DAYS - 1) * DAY;
  const item: Advisory = {
    ...base(id, signal.repo, signal.installation),
    kind: "advisory",
    state: "open",
    ghsa: signal.ghsa,
    url: signal.url,
    severity: signal.severity,
    reported,
    ...(remindAt > context.now() ? { remindAt } : {}),
  };
  await show(context, item);
  return "advisory shown";
}

/** A published advisory ticks the report that it came from, if the pager showed it. */
async function advisoryPublished(
  context: Context,
  signal: Extract<Signal, { type: "advisory-published" }>,
): Promise<string> {
  const id = await itemId(keys.advisory(signal.repo, signal.ghsa));
  const known = (await context.store.get(id)) as Advisory | null;
  if (known === null) {
    return "an advisory that the pager never showed";
  }
  if (known.state === "published") {
    return "advisory published already";
  }
  known.state = "published";
  known.snoozedUntil = null;
  delete known.remindAt;
  await show(context, known);
  return "advisory published";
}

/** Take an entry out of the bundle; the last one closes it. */
async function removeEntry(
  context: Context,
  kind: "alarm" | "alert",
  repo: string,
  key: string,
): Promise<string> {
  const id = await itemId(
    kind === "alarm" ? keys.alarm(repo) : keys.alert(repo),
  );
  const known = (await context.store.get(id)) as Alarm | Alert | null;
  if (known === null || isClosed(known)) {
    return `no open ${kind}`;
  }
  const left = known.entries.filter((each) => each.key !== key);
  if (left.length === known.entries.length) {
    return `not part of the ${kind}`;
  }
  known.entries = left;
  if (left.length === 0) {
    known.state = known.kind === "alarm" ? "recovered" : "resolved";
  }
  await show(context, known);
  return left.length === 0 ? `${kind} closed` : `${kind} updated`;
}

/**
 * A discussion, or a comment on one, from someone else: a contribution whose draft
 * the pager asks for at once, since its buttons send, edit or ignore that draft. A
 * new comment becomes the message that the reply answers: a thing that is still
 * open gets a new message for it, which replaces the old one, and one whose reply
 * went opens again in its topic, where the old message stays as its history. An
 * ignored discussion stays ignored, a draft that the maintainer wrote himself
 * stays the reply, and the same comment twice changes nothing.
 */
async function discussion(
  context: Context,
  signal: Extract<Signal, { type: "discussion" }>,
): Promise<string> {
  const id = await itemId(keys.contribution(signal.repo, signal.number));
  const known = (await context.store.get(id)) as Contribution | null;
  if (known?.state === "ignored") {
    return "discussion ignored";
  }
  // GitHub delivers an event again when asked to, and the schedule asks for one
  // whose answer failed: the same comment, or the discussion itself after any of
  // its comments, which all come after it, changes nothing.
  const shown = known?.discussion;
  if (
    shown?.node === signal.node &&
    (signal.comment === undefined || signal.comment === shown.comment)
  ) {
    return "discussion shown already";
  }
  const open = known !== null && !isClosed(known);
  const thread: Discussion = {
    node: signal.node,
    ...(signal.comment === undefined ? {} : { comment: signal.comment }),
  };
  const item: Contribution = {
    ...base(id, signal.repo, signal.installation),
    kind: "contribution",
    state: "new",
    number: signal.number,
    pull: false,
    title: signal.title,
    url: signal.url,
    author: signal.author,
    ...excerptOf(signal),
    draft: null,
    // Counts on, so that no button of an older draft sends the next one.
    draftVersion: known?.draftVersion ?? 0,
    discussion: thread,
    messageId: open ? known.messageId : null,
    topic: known?.topic ?? null,
  };
  if (open && known.ownDraft === true) {
    // The maintainer wrote the draft himself: it stays the reply, now to this
    // comment, and no job drafts another one. The version counts on all the same,
    // since the draft answers another comment now.
    item.state = "draft";
    item.draft = known.draft;
    item.draftVersion += 1;
    item.ownDraft = true;
    item.note = context.t("note.ownDraft");
    await show(context, item, true);
    return "discussion shown anew, with the maintainer's own draft";
  }
  if (open && known.state === "drafting" && known.discussion !== undefined) {
    // The job for the draft of an older comment is still running, and the
    // control repository runs one job per thing at a time: its draft is dropped
    // when it comes, and the draft for this comment is asked for then.
    // The hour that the schedule waits counts from now, for both jobs.
    item.state = "drafting";
    item.jobStarted = context.now();
    thread.redraft = true;
    await show(context, item, true);
    return "discussion shown anew, its draft waits for the older one";
  }
  const failed = await draftOrWhyNot(context, item);
  // Without its job, the thing offers ✍️ Draft a reply, and its note says why.
  item.note = failed;
  await show(context, item, open);
  const outcome = known === null ? "discussion shown" : "discussion shown anew";
  return failed === null ? outcome : `${outcome}, without a draft`;
}

/** The note of each end of a discussion on GitHub, which says why its thing is done. */
const ENDS = {
  replied: "note.repliedOnGitHub",
  answered: "note.answerChosen",
  closed: "note.closedOnGitHub",
  deleted: "note.discussionDeleted",
} as const satisfies Record<DiscussionEnd, string>;

/** The note of each end of an issue or a pull request on GitHub, which says why its thing is done. */
const CLOSED = {
  replied: "note.repliedOnGitHub",
  closed: "note.closedOnGitHub",
  merged: "note.merged",
} as const satisfies Record<ContributionEnd, string>;

/** The open thing of an issue, a pull request or a discussion, if the pager shows one. */
async function openContribution(
  context: Context,
  repo: string,
  number: number,
): Promise<Contribution | null> {
  const known = await context.store.get(
    await itemId(keys.contribution(repo, number)),
  );
  return known?.kind === "contribution" && !isClosed(known) ? known : null;
}

/**
 * A contribution that GitHub dealt with, such as with a reply of the maintainer
 * there, is done, as pictures are once their pull request closed: its buttons go,
 * its topic gets ✅, and its message says why, in place, which notifies nobody,
 * since the maintainer was there or GitHub told him. A job that still drafts for
 * it finds it done, and its draft isn't shown.
 */
async function finish(
  context: Context,
  known: Contribution,
  note: (typeof ENDS)[DiscussionEnd] | (typeof CLOSED)[ContributionEnd],
): Promise<void> {
  known.state = "done";
  known.note = context.t(note);
  delete known.jobStarted;
  delete answering(known)?.redraft;
  await show(context, known);
}

/** A discussion that GitHub dealt with: its open thing is done. */
async function discussionDone(
  context: Context,
  signal: Extract<Signal, { type: "discussion-done" }>,
): Promise<string> {
  const known = await openContribution(context, signal.repo, signal.number);
  if (known?.discussion === undefined) {
    return "no open discussion shown";
  }
  await finish(context, known, ENDS[signal.reason]);
  return `discussion done: ${signal.reason}`;
}

/**
 * An issue or a pull request of someone else that GitHub dealt with, by a comment
 * of the maintainer there, its closing or its merge: its open thing is done.
 */
async function contributionDone(
  context: Context,
  signal: Extract<Signal, { type: "contribution-done" }>,
): Promise<string> {
  const known = await openContribution(context, signal.repo, signal.number);
  if (known === null || known.discussion !== undefined) {
    return "no open contribution shown";
  }
  await finish(context, known, CLOSED[signal.reason]);
  return `contribution done: ${signal.reason}`;
}

/**
 * What a new comment does to the draft of an open thing, and what it says of it:
 * a job that still drafts drafts again for the comment once its draft for the
 * older message came, a draft of the control repository is asked for again, and
 * one that the maintainer wrote himself stays, for him to change with ✏️ Edit.
 */
async function redraft(context: Context, known: Contribution): Promise<string> {
  switch (known.state) {
    case "drafting":
      // The control repository runs one job per thing at a time; the hour that
      // the schedule waits counts from now, for both jobs.
      (known.comment as IssueComment).redraft = true;
      known.jobStarted = context.now();
      return ", its draft waits for the older one";
    case "draft": {
      // The version counts on: no button of the older draft sends the next one.
      known.draftVersion += 1;
      if (known.ownDraft === true) {
        known.note = context.t("note.ownDraft");
        return ", with the maintainer's own draft";
      }
      known.draft = null;
      known.state = "new";
      // Without its job, the thing offers ✍️ Draft a reply, and its note says why.
      known.note = await draftOrWhyNot(context, known);
      return known.note === null ? ", drafted again" : ", without a draft";
    }
    default:
      return "";
  }
}

/**
 * A comment of someone else on an issue or a pull request of someone else: the
 * newest message, which the reply answers. A thing that is still open keeps its
 * message, edited in place to name the comment, which notifies nobody, so a
 * message below it in its topic notifies, once for a few quick comments. A thing
 * whose reply went, or that GitHub dealt with, opens again in its topic with
 * ✍️ Draft a reply, where its old message stays as history, and one that the
 * pager never showed, or whose record expired, is a new thing. An ignored thing
 * stays ignored, and the same comment twice, or an older one, changes nothing.
 */
async function comment(
  context: Context,
  signal: Extract<Signal, { type: "comment" }>,
): Promise<string> {
  const id = await itemId(keys.contribution(signal.repo, signal.number));
  const known = (await context.store.get(id)) as Contribution | null;
  if (known?.state === "ignored") {
    return "comment ignored";
  }
  // GitHub promises no order of its deliveries, and a redelivery can bring an
  // older comment back; the ids of comments only grow.
  if (known?.comment !== undefined && signal.comment <= known.comment.id) {
    return "comment shown already";
  }
  const now = context.now();
  if (known === null || isClosed(known)) {
    await show(context, {
      ...base(id, signal.repo, signal.installation),
      kind: "contribution",
      state: "new",
      number: signal.number,
      pull: signal.pull,
      title: signal.title,
      url: signal.url,
      author: signal.author,
      ...excerptOf(signal),
      draft: null,
      // Counts on, so that no button of an older draft sends the next one.
      draftVersion: known?.draftVersion ?? 0,
      comment: { id: signal.comment, noticed: now },
      topic: known?.topic ?? null,
    });
    return known === null ? "comment shown" : "comment shown anew";
  }
  const last = known.comment?.noticed;
  const quiet = last !== undefined && now - last < QUIET;
  known.title = signal.title;
  known.url = signal.url;
  known.author = signal.author;
  // The message quotes the comment now, which its reply answers.
  delete known.excerpt;
  Object.assign(known, excerptOf(signal));
  known.comment = { id: signal.comment, noticed: quiet ? last : now };
  known.note = null;
  // The comment needs the maintainer now, not once "Later" brings it back.
  known.snoozedUntil = null;
  const outcome = await redraft(context, known);
  await show(context, known);
  if (quiet) {
    return `comment shown in place${outcome}, quietly`;
  }
  await context.telegram.send(
    context.t("message.newComment", {
      author: html(signal.author, 100),
      link: link(`#${signal.number} ${signal.title}`, signal.url),
    }),
    [],
    known.topic?.thread ?? null,
    known.messageId,
  );
  return `comment shown in place${outcome}`;
}

async function releaseItem(
  context: Context,
  repo: string,
): Promise<Release | null> {
  const known = await context.store.get(await itemId(keys.release(repo)));
  return known?.kind === "release" ? known : null;
}

/**
 * Send the album of a visual change, if it has photos. Returns why Telegram
 * refused it, as the note of its thing, or null.
 */
async function sendAlbum(
  context: Context,
  photos: readonly Photo[],
  thread: Thread,
  replyTo: number | null,
  silent: boolean,
): Promise<string | null> {
  if (photos.length === 0) {
    return null;
  }
  try {
    await context.telegram.album(photos, thread, replyTo, silent);
    return null;
  } catch (error) {
    if (!(error instanceof TelegramError)) {
      throw error;
    }
    console.warn(`Telegram ${error.method}: ${error.description}`);
    return context.t("note.albumFailed", { detail: error.description });
  }
}

/**
 * The pictures of a release that the pager shows: a message of their own in its
 * topic, without buttons, since its own message keeps 🔀 Merge, and the album
 * below; the release keeps the head whose pictures went.
 */
async function releasePictures(
  context: Context,
  release: Release,
  view: PicturesView,
  photos: readonly Photo[],
): Promise<string> {
  const text = picturesText(view, context.t);
  const sent = await context.telegram.post(
    text,
    [],
    release.topic?.thread ?? null,
    release.messageId,
  );
  // The message notified already: the album below it comes quietly.
  const failed = await sendAlbum(
    context,
    photos,
    sent.thread,
    sent.message,
    true,
  );
  if (failed !== null) {
    await context.telegram.edit(
      sent.message,
      `${text}\n<i>${html(failed, 500)}</i>`,
      [],
    );
  }
  release.album = view.sha;
  await context.store.put(release);
  return "pictures shown with the release";
}

/**
 * A visual check that passed on a pull request: when a picture looks different
 * at its head, its pictures go into the topic of its thing, the release that the
 * pager shows or a thing of their own, as one message and an album of the largest
 * changes, before and after. At most one album per head, only for a pull request
 * of the maintainer or of a bot, and nothing when every picture looks as
 * committed; the message of a thing whose newest head looks as committed again
 * says so, in place.
 */
async function pictures(
  context: Context,
  signal: Extract<Signal, { type: "pictures" }>,
): Promise<string> {
  const release = await releaseItem(context, signal.repo);
  const ofRelease = release?.number === signal.number ? release : null;
  const id = await itemId(keys.pictures(signal.repo, signal.number));
  const known =
    ofRelease === null
      ? ((await context.store.get(id)) as Pictures | null)
      : null;
  if ((ofRelease ?? known)?.state === "ignored") {
    return "pictures ignored";
  }
  if ((ofRelease?.album ?? known?.sha) === signal.sha) {
    return "pictures shown already";
  }
  const pull = await context.github.pullRequest(
    signal.installation,
    signal.repo,
    signal.number,
  );
  const blocker = picturesBlocker(
    pull,
    signal.repo,
    signal.sha,
    context.settings.maintainer,
  );
  if (blocker !== null) {
    return `no pictures: ${blocker}`;
  }
  // The artifacts of the check, as many as fit into MAX_ARTIFACT together: the
  // pager holds them in memory for this one request.
  let total = 0;
  const kept = (
    await context.github.artifacts(signal.installation, signal.repo, signal.run)
  )
    .filter(({ name, size }) => {
      const fits = ARTIFACT.test(name) && total + size <= MAX_ARTIFACT;
      total += fits ? size : 0;
      return fits;
    })
    .slice(0, MAX_ARTIFACTS);
  if (kept.length === 0) {
    return "no pictures: the run kept no artifact that the pager reads";
  }
  // Each download may take only what is left of MAX_ARTIFACT, whatever size GitHub
  // listed; one that GitHub or its storage refuses, such as an artifact that expired
  // since the list, leaves out only itself.
  const artifacts: Artifact[] = [];
  let spent = 0;
  for (const { id } of kept) {
    let bytes: Uint8Array;
    try {
      bytes = await context.github.artifactZip(
        signal.installation,
        signal.repo,
        id,
        MAX_ARTIFACT - spent,
      );
    } catch (error) {
      if (!(error instanceof GitHubError)) {
        throw error;
      }
      console.warn(`artifact ${id} of ${signal.repo}: ${error.message}`);
      continue;
    }
    spent += bytes.length;
    const found = await readArtifact(bytes);
    if (found !== null) {
      artifacts.push(found);
    }
  }
  if (artifacts.length === 0) {
    return "no pictures: the artifact holds no report that the pager reads";
  }
  const read = await album(artifacts, context.t);
  const open = known !== null && !isClosed(known);
  if (read.changed.length === 0 && !open) {
    return "every picture looks as committed";
  }
  const view: PicturesView = {
    repo: signal.repo,
    number: signal.number,
    title: pull.title ?? "",
    url: pull.html_url ?? "",
    sha: signal.sha,
    changed: read.changed.slice(0, MAX_LISTED),
    count: read.changed.length,
    shown: read.shown,
    check: `https://github.com/${signal.repo}/actions/runs/${signal.run}`,
  };
  if (ofRelease !== null) {
    return releasePictures(context, ofRelease, view, read.photos);
  }
  const item: Pictures = {
    ...base(id, signal.repo, signal.installation),
    ...view,
    kind: "pictures",
    state: "open",
    // The next head of an open thing edits its message; one whose pull request
    // was closed and opened again gets a new message in the topic that it had.
    messageId: open ? known.messageId : null,
    topic: known?.topic ?? null,
  };
  const before = item.messageId;
  await show(context, item);
  // A new message notified already; the album of a message edited in place notifies.
  const failed = await sendAlbum(
    context,
    read.photos,
    item.topic?.thread ?? null,
    item.messageId,
    item.messageId !== before,
  );
  if (failed !== null) {
    item.note = failed;
    await show(context, item);
  }
  if (read.changed.length === 0) {
    return "pictures look as committed again";
  }
  return known === null ? "pictures shown" : "pictures shown anew";
}

/** A closed pull request of the maintainer or of a bot: its pictures are done. */
async function pullClosed(
  context: Context,
  signal: Extract<Signal, { type: "pull-closed" }>,
): Promise<string> {
  const known = await context.store.get(
    await itemId(keys.pictures(signal.repo, signal.number)),
  );
  if (known?.kind !== "pictures" || isClosed(known)) {
    return "no pictures shown";
  }
  known.state = "done";
  known.note = context.t(signal.merged ? "note.merged" : "note.closed");
  await show(context, known);
  return "pictures done";
}

/** Look at each release pull request whose checks finished: is it ready to merge? */
async function releaseCheck(
  context: Context,
  signal: Extract<Signal, { type: "release-check" }>,
): Promise<string> {
  const outcomes: string[] = [];
  for (const number of signal.numbers) {
    let pull = await context.github.pullRequest(
      signal.installation,
      signal.repo,
      number,
    );
    // GitHub works out whether a pull request can merge only when it is asked, and
    // answers "unknown" until then: ask again a moment later, as its docs advise.
    for (
      let tries = 1;
      (pull.mergeable_state ?? "unknown") === "unknown" &&
      tries < MERGEABLE_TRIES;
      tries += 1
    ) {
      await context.sleep(2000 * tries);
      pull = await context.github.pullRequest(
        signal.installation,
        signal.repo,
        number,
      );
    }
    const blocker = releaseBlocker(
      pull,
      pull.base?.repo?.default_branch ?? "main",
    );
    if (blocker !== null) {
      outcomes.push(`#${number} not ready: ${english.phrase(blocker)}`);
      continue;
    }
    const version = releaseVersion(String(pull.title)) as string;
    const sha = pull.head?.sha ?? "";
    const notes = releaseNotes(pull.body, version);
    const known = await releaseItem(context, signal.repo);
    const same = known !== null && known.version === version ? known : null;
    // A new version of a release that is still shown, such as 0.10.0 after a feat
    // on top of 0.9.0: its message replaces the old one, which goes, buttons and all.
    const replaced =
      known !== null && same === null && !isClosed(known) ? known : null;
    if (same?.state === "ignored") {
      outcomes.push(`#${number} ignored`);
      continue;
    }
    if (
      same !== null &&
      (isClosed(same) ||
        (same.state === "ready" &&
          same.sha === sha &&
          sameNotes(same.notes, notes)))
    ) {
      outcomes.push(`#${number} shown already`);
      continue;
    }
    const item: Release = {
      ...base(
        await itemId(keys.release(signal.repo)),
        signal.repo,
        signal.installation,
      ),
      kind: "release",
      state: "ready",
      number,
      version,
      sha,
      url: pull.html_url ?? "",
      ...(notes === undefined ? {} : { notes }),
      // The same release, ready again after an update, keeps its message; a new
      // version keeps the topic of the one that it replaces, renamed.
      messageId: same?.messageId ?? replaced?.messageId ?? null,
      snoozedUntil: same?.snoozedUntil ?? null,
      topic: same?.topic ?? replaced?.topic ?? null,
    };
    await show(context, item, replaced !== null);
    outcomes.push(`#${number} ready`);
  }
  return outcomes.join("; ");
}

async function releaseState(
  context: Context,
  repo: string,
  change: (item: Release) => string | null,
): Promise<string> {
  const known = await releaseItem(context, repo);
  if (known === null) {
    return "no release shown";
  }
  const outcome = change(known);
  if (outcome === null) {
    return "release unchanged";
  }
  await show(context, known);
  return outcome;
}

/** What a signal does to the things of the maintainer; returns what happened. */
export async function apply(context: Context, signal: Signal): Promise<string> {
  switch (signal.type) {
    case "contribution": {
      const id = await itemId(keys.contribution(signal.repo, signal.number));
      if ((await context.store.get(id)) !== null) {
        return "contribution shown already";
      }
      await show(context, {
        ...base(id, signal.repo, signal.installation),
        kind: "contribution",
        state: "new",
        number: signal.number,
        pull: signal.pull,
        title: signal.title,
        url: signal.url,
        author: signal.author,
        ...excerptOf(signal),
        draft: null,
        draftVersion: 0,
      });
      return "contribution shown";
    }
    case "discussion":
      return discussion(context, signal);
    case "discussion-done":
      return discussionDone(context, signal);
    case "comment":
      return comment(context, signal);
    case "contribution-done":
      return contributionDone(context, signal);
    case "failing":
    case "still-failing":
      return addEntry(
        context,
        "alarm",
        signal.repo,
        signal.installation,
        {
          key: signal.key,
          label: context.t.phrase(signal.label),
          url: signal.url,
          ...(signal.run === undefined ? {} : { run: signal.run }),
        },
        signal.type === "still-failing" ? "change" : null,
      );
    case "recovered":
      return removeEntry(context, "alarm", signal.repo, signal.key);
    case "check": {
      const required = await context.github.requiredChecks(
        signal.installation,
        signal.repo,
        signal.branch,
      );
      if (!required.includes(signal.name)) {
        return "a check that no rule requires";
      }
      const key = `check:${signal.name}`;
      if (!signal.failed) {
        return removeEntry(context, "alarm", signal.repo, key);
      }
      return addEntry(context, "alarm", signal.repo, signal.installation, {
        key,
        label: context.t("entry.check", {
          name: signal.name,
          branch: signal.branch,
        }),
        url: signal.url,
        ...(signal.run === undefined ? {} : { run: signal.run }),
      });
    }
    case "alert-open":
      return addEntry(context, "alert", signal.repo, signal.installation, {
        key: signal.key,
        label: context.t.phrase(signal.label),
        url: signal.url,
      });
    case "secret-open":
      return addEntry(
        context,
        "alert",
        signal.repo,
        signal.installation,
        await secretEntry(context, signal),
      );
    case "alert-closed":
      return removeEntry(context, "alert", signal.repo, signal.key);
    case "advisory":
      return advisory(context, signal);
    case "advisory-published":
      return advisoryPublished(context, signal);
    case "release-check":
      return releaseCheck(context, signal);
    case "release-updated":
      return releaseState(context, signal.repo, (item) => {
        if (
          item.number !== signal.number ||
          item.sha === signal.sha ||
          item.state !== "ready"
        ) {
          return null;
        }
        item.state = "updating";
        item.sha = signal.sha;
        return "release updating";
      });
    case "release-merged":
      return releaseState(context, signal.repo, (item) => {
        if (
          item.number !== signal.number ||
          item.state === "merged" ||
          isClosed(item)
        ) {
          return null;
        }
        item.state = "merged";
        return "release merged";
      });
    case "release-published":
      return releaseState(context, signal.repo, (item) => {
        if (
          signal.tag.replace(/^v/, "") !== item.version ||
          item.state === "published"
        ) {
          return null;
        }
        item.state = "published";
        item.note = null;
        return "release published";
      });
    case "pictures":
      return pictures(context, signal);
    case "pull-closed":
      return pullClosed(context, signal);
  }
}

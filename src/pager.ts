/**
 * The pager: what a signal of the rules does to the things that the maintainer
 * sees. One message per thing, in a topic of its own, edited in place as its state
 * changes; a new message, which notifies, only for a new thing, a bundle that
 * opens again, which keeps its topic, a new comment on a discussion, the answer
 * of a draft or a fix, and the pictures of a visual change.
 */
import { keyboard } from "./buttons.ts";
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
import { html, type PicturesView, picturesText, render } from "./render.ts";
import {
  picturesBlocker,
  releaseBlocker,
  releaseVersion,
  type Signal,
} from "./rules.ts";
import type { Settings } from "./settings.ts";
import {
  type Alarm,
  type Alert,
  type Contribution,
  type Discussion,
  type Entry,
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
}

/** The words of the log, which stays in English. */
const english = texts("en");

/** How often to ask again while GitHub still works out whether a pull request can merge. */
export const MERGEABLE_TRIES = 3;

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
  const discussion = item.discussion;
  const failed = await toControl(context, "pager-draft", {
    item: item.id,
    repo: item.repo,
    number: item.number,
    pull: item.pull,
    // A discussion names the comment that the reply answers, if it answers one.
    ...(discussion === undefined
      ? {}
      : {
          discussion: true,
          ...(discussion.comment === undefined
            ? {}
            : { comment: discussion.comment }),
        }),
  });
  if (failed === null) {
    item.state = "drafting";
    item.jobStarted = context.now();
    // The job just asked for answers the newest comment.
    delete discussion?.redraft;
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
 * ignored discussion stays ignored.
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
    draft: null,
    // Counts on, so that no button of an older draft sends the next one.
    draftVersion: known?.draftVersion ?? 0,
    discussion: thread,
    messageId: open ? known.messageId : null,
    topic: known?.topic ?? null,
  };
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
      (isClosed(same) || (same.state === "ready" && same.sha === sha))
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
        draft: null,
        draftVersion: 0,
      });
      return "contribution shown";
    }
    case "discussion":
      return discussion(context, signal);
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
    case "alert-closed":
      return removeEntry(context, "alert", signal.repo, signal.key);
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
        if (item.number !== signal.number || isClosed(item)) {
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

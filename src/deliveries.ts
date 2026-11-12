/**
 * The events of GitHub that the pager failed to handle. GitHub never delivers an
 * event of a webhook again by itself, so each run of the schedule asks it to: it
 * reads the deliveries of the app's webhook of the last three hours, and an event
 * whose newest attempt got a 5xx from the pager, or no answer in time, comes
 * again, three attempts in all. On a busy day the deliveries of three hours are
 * thousands, more than one run can read, so a run reads the failures of the last
 * three hours on a list of their own, and the deliveries of every outcome only
 * back to the newest that the run before read: they bring the answers that didn't
 * come in time, which the list of the failures leaves out, and the attempts that
 * passed. What the next runs need of them it keeps in the storage of the Durable
 * Object, and a run that can't read back as far as it should says so in the log.
 * An event whose third attempt fails becomes an entry of the alarm of the control
 * repository, the pager's own, which links the recent deliveries on the app's
 * Advanced page; an attempt that passes later, such as one asked for there, takes
 * it out. The list of the deliveries counts the attempts, so the pager writes
 * nothing to Workers KV for them, and each signal leaves the same state when it
 * comes twice, since a redelivery may bring one that went through before its
 * answer failed. A redelivery comes late, so an event that a newer one of the
 * same kind and repository overtook doesn't come again: its signal could bring
 * back an older state.
 */
import { type Deliveries, type Delivery, GitHubError } from "./github.ts";
import { apply, type Context } from "./pager.ts";
import { type Alarm, DELIVERY_ENTRY, isClosed, itemId, keys } from "./store.ts";

/** How far back the schedule reads the deliveries of the webhook, in milliseconds. */
export const LOOK_BACK = 3 * 60 * 60 * 1000;

/** How many pages of 100 failures one run reads at most: they reach back hours, also on a busy day. */
export const FAILURE_PAGES = 3;

/**
 * How many pages of 100 deliveries of every outcome one run reads at most, back
 * to the newest that the run before read: more than the busiest quarter of an
 * hour of a fleet of ten repositories, 431 workflow runs, each with three
 * deliveries of its own besides those of its checks.
 */
export const MAX_PAGES = 20;

/** How many attempts an event gets in all, its first delivery included. */
export const MAX_ATTEMPTS = 3;

/** How many events one run has GitHub deliver again at most. */
export const MAX_REDELIVERIES = 10;

/** How many calls to the network one request of a Worker makes at most on the free plan. */
export const SUBREQUESTS = 50;

/**
 * The most calls to the network that one change of the alarm takes: the
 * installation of the control repository and the page of the app, and for its
 * message an edit, a message into its topic, a new topic with its check, its
 * message and their fallbacks, the new name of the topic, and the notice of a
 * new entry below it.
 */
export const ALARM_CHANGE = 11;

/**
 * The calls that each page of every outcome leaves for the redeliveries and one
 * change of the alarm.
 */
export const RESERVE = MAX_REDELIVERIES + ALARM_CHANGE;

/** The key of what a run keeps of the deliveries for the next, in the storage of the Durable Object. */
export const SEEN = "deliveries";

/** What a run keeps of the deliveries for the next. */
export interface Seen {
  /** The id of the newest delivery of every outcome that a run read, or null before any. */
  newest: number | null;
  /**
   * The deliveries of the last LOOK_BACK that the list of the failures leaves out
   * and the next runs need: an answer that didn't come in time, an attempt asked
   * for again that passed, and of each kind and repository the newest event that
   * passed at once, which may overtake an older one.
   */
  kept: Delivery[];
}

/**
 * The events whose signal a newer one of the same kind and repository can
 * overtake: a run, a check or an alert that changed since, a pull request at a
 * new head, or an issue, a pull request, a discussion or a release that was
 * closed, answered, edited or deleted since. A late copy would bring back the
 * older state. A comment adds to its thing and overtakes nothing, and neither
 * does a vulnerability report: one that comes again is shown once, and one that
 * stayed away would be a report missed. Nor does an alert of secret scanning,
 * whose events come in bursts, one per alert, and a leak missed is worse: a late
 * copy of one that was resolved since is known by its time (src/pager.ts).
 */
export const SUPERSEDED = new Set([
  "check_run",
  "check_suite",
  "code_scanning_alert",
  "discussion",
  "issues",
  "pull_request",
  "release",
  "workflow_run",
]);

/** An event as its deliveries show it: its newest attempt, and how many it had. */
interface Event {
  newest: Delivery;
  attempts: number;
  /** Its first delivery, when it is among those read, so that all its attempts are. */
  first: Delivery | null;
  /** Whether one of its attempts passed. */
  passed: boolean;
}

/** Whether the pager handled an attempt: a 2xx or 3xx. */
function passed(delivery: Delivery): boolean {
  return delivery.status_code > 0 && delivery.status_code < 400;
}

/** Whether the pager failed an attempt: a 5xx, or no answer in time. */
export function failed(delivery: Delivery): boolean {
  // A 4xx is a refusal of the pager, such as of a wrong signature: it would
  // refuse the same event again.
  return delivery.status_code === 0 || delivery.status_code >= 500;
}

/** The key of the entry of an event in the alarm, by the guid that all its attempts share. */
export function entryKey(guid: string): string {
  return `${DELIVERY_ENTRY}${guid}`;
}

/** How many more calls to the network this request may make. */
function left(context: Context): number {
  return SUBREQUESTS - context.subrequests();
}

/** Whether the list of the failures shows a delivery: GitHub's `failure`, a code from 400 to 599. */
function listed(delivery: Delivery): boolean {
  return delivery.status_code >= 400 && delivery.status_code <= 599;
}

/** A delivery with only the fields that the pager reads, as a run keeps it. */
function compact(delivery: Delivery): Delivery {
  return {
    id: delivery.id,
    guid: delivery.guid,
    delivered_at: delivery.delivered_at,
    redelivery: delivery.redelivery,
    status_code: delivery.status_code,
    event: delivery.event,
    action: delivery.action,
    repository_id: delivery.repository_id,
  };
}

/** The pages that a run read of one list, and whether they reach back as far as it should. */
interface Read {
  deliveries: Delivery[];
  reached: boolean;
}

/**
 * The deliveries of one list, newest first, page by page until the oldest of
 * them is as old as `enough` asks, or the list ends, on as many pages as `pages`
 * and the calls left allow: each page only while more than `room` calls are
 * left. A page that GitHub refuses ends the list: the pages before it still
 * reach back from the newest.
 */
async function read(
  context: Context,
  status: "failure" | null,
  pages: number,
  room: number,
  enough: (oldest: Delivery) => boolean,
): Promise<Read> {
  const deliveries: Delivery[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < pages; page += 1) {
    if (left(context) <= room) {
      break;
    }
    let answer: Deliveries;
    try {
      answer = await context.github.deliveries(cursor, status);
    } catch (error) {
      if (!(error instanceof GitHubError)) {
        throw error;
      }
      console.error(
        "The deliveries of the webhook can't be read:",
        error.message,
      );
      break;
    }
    deliveries.push(...answer.deliveries);
    cursor = answer.cursor;
    const oldest = deliveries.at(-1);
    if (cursor === null || oldest === undefined || enough(oldest)) {
      return { deliveries, reached: true };
    }
  }
  return { deliveries, reached: false };
}

/**
 * Say in the log when the pages of a list ended before they reached as far back
 * as they should, since the next run starts from the newest again. A run that
 * read no page leaves the whole list to the next, which reaches back as far.
 */
function gap(list: Read, name: string, goal: string, missed: string): void {
  const oldest = list.deliveries.at(-1);
  if (!list.reached && oldest !== undefined) {
    console.warn(
      `The ${name} of the webhook were read back to ${oldest.delivered_at}, not to ${goal}: ${missed}`,
    );
  }
}

/**
 * What the next runs need of the deliveries that the list of the failures leaves
 * out: an answer that didn't come in time, an attempt asked for again that
 * passed, and of each kind and repository that SUPERSEDED names the newest event
 * that passed at once, since only a newer one may overtake an event.
 */
function keep(deliveries: Delivery[]): Delivery[] {
  const kept: Delivery[] = [];
  const newest = new Map<string, Delivery>();
  for (const delivery of deliveries) {
    if (listed(delivery)) {
      continue;
    }
    if (failed(delivery) || (passed(delivery) && delivery.redelivery)) {
      kept.push(delivery);
    } else if (
      passed(delivery) &&
      SUPERSEDED.has(delivery.event) &&
      delivery.repository_id !== null
    ) {
      const kind = `${delivery.event} ${delivery.repository_id}`;
      const known = newest.get(kind);
      if (known === undefined || known.id < delivery.id) {
        newest.set(kind, delivery);
      }
    }
  }
  return [...kept, ...newest.values()];
}

/**
 * The deliveries of the last LOOK_BACK that a run needs: the failures, those of
 * every outcome back to the newest that the run before read, and what the runs
 * before kept of the older ones. The failures come first, and each page of every
 * outcome leaves the calls of the redeliveries and of a change of the alarm.
 * Keeps what the next runs need. Without a page of every outcome, the run
 * doesn't see what passed since the run before, so it must not act on them.
 */
async function recent(
  context: Context,
): Promise<{ found: Delivery[]; complete: boolean }> {
  const since = context.now() - LOOK_BACK;
  const old = (delivery: Delivery) => Date.parse(delivery.delivered_at) < since;
  const before = await context.local.get<Seen>(SEEN);
  const newest = before?.newest ?? null;
  const failures = await read(context, "failure", FAILURE_PAGES, 0, old);
  gap(
    failures,
    "failures",
    "three hours",
    "an older failed event gets no more attempts and no entry in the alarm",
  );
  const all = await read(
    context,
    null,
    MAX_PAGES,
    RESERVE,
    (oldest) => old(oldest) || (newest !== null && oldest.id <= newest),
  );
  gap(
    all,
    "deliveries",
    newest === null ? "three hours" : `delivery ${newest} of the run before`,
    "an answer that didn't come in time before then is missed, and so is an attempt that passed",
  );
  const byId = new Map<number, Delivery>();
  for (const delivery of [
    ...(before?.kept ?? []),
    ...failures.deliveries,
    ...all.deliveries,
  ]) {
    byId.set(delivery.id, compact(delivery));
  }
  const found = [...byId.values()].filter((delivery) => !old(delivery));
  const ids = all.deliveries.map((delivery) => delivery.id);
  await context.local.put<Seen>(SEEN, {
    newest: ids.length === 0 ? newest : Math.max(...ids),
    kept: keep(found),
  });
  return { found, complete: all.reached || ids.length > 0 };
}

/** The events of the deliveries, by their guid, each with its newest attempt by id. */
function events(deliveries: Delivery[]): Event[] {
  const found = new Map<string, Event>();
  for (const delivery of deliveries) {
    const known = found.get(delivery.guid);
    found.set(delivery.guid, {
      newest:
        known !== undefined && known.newest.id > delivery.id
          ? known.newest
          : delivery,
      attempts: (known?.attempts ?? 0) + 1,
      first: delivery.redelivery ? (known?.first ?? null) : delivery,
      passed: known?.passed === true || passed(delivery),
    });
  }
  return [...found.values()];
}

/**
 * Whether a newer event of the same kind and repository passed after this one
 * was first delivered: its signal may be stale by now, so it doesn't come again,
 * and the newer one stands, as it did before the pager asked for any event again.
 */
function overtaken(event: Event, all: Event[]): boolean {
  const first = event.first as Delivery;
  return (
    SUPERSEDED.has(first.event) &&
    first.repository_id !== null &&
    all.some(
      (other) =>
        other.passed &&
        other.first !== null &&
        other.first.id > first.id &&
        other.first.event === first.event &&
        other.first.repository_id === first.repository_id,
    )
  );
}

/**
 * Have GitHub deliver the newest attempt of each event again, the oldest first,
 * within the calls left. One that GitHub refuses, such as an attempt too old for
 * it, leaves out only itself.
 */
async function redeliver(context: Context, again: Delivery[]): Promise<void> {
  const plan = again
    .sort((one, other) => one.id - other.id)
    .slice(0, Math.min(MAX_REDELIVERIES, left(context)));
  for (const delivery of plan) {
    try {
      await context.github.redeliver(delivery.id);
    } catch (error) {
      if (!(error instanceof GitHubError)) {
        throw error;
      }
      console.warn(`delivery ${delivery.id} again: ${error.message}`);
    }
  }
}

/**
 * The entries of the alarm of the control repository: an event whose attempts
 * all failed comes in once, and leaves once an attempt passed. An entry that the
 * alarm shows already, also one that was ignored or is being fixed, stays as it
 * is. Returns the id of the alarm when it changed.
 */
async function alarm(
  context: Context,
  exhausted: Delivery[],
  passed: Delivery[],
): Promise<string[]> {
  if (exhausted.length + passed.length === 0) {
    return [];
  }
  const repo = context.settings.controlRepository;
  const id = await itemId(keys.alarm(repo));
  const known = (await context.store.get(id)) as Alarm | null;
  const shown = new Set(known?.entries.map((entry) => entry.key));
  const open = known !== null && !isClosed(known);
  const out = passed.filter(
    (delivery) => open && shown.has(entryKey(delivery.guid)),
  );
  const into = exhausted.filter(
    (delivery) => !shown.has(entryKey(delivery.guid)),
  );
  let changed = false;
  for (const delivery of out) {
    if (left(context) < ALARM_CHANGE) {
      break;
    }
    await apply(context, {
      type: "recovered",
      repo,
      installation: (known as Alarm).installation,
      key: entryKey(delivery.guid),
    });
    changed = true;
  }
  let at: { installation: number; url: string } | null = null;
  for (const delivery of into.sort((one, other) => one.id - other.id)) {
    if (left(context) < ALARM_CHANGE) {
      break;
    }
    if (at === null) {
      const installation =
        known?.installation ?? (await context.github.installation(repo));
      if (installation === null) {
        console.error(
          `The GitHub App isn't installed on ${repo}: no alarm for the events that fail`,
        );
        break;
      }
      at = {
        installation,
        url: `${await context.github.appSettings()}/advanced`,
      };
    }
    const { event, action } = delivery;
    await apply(context, {
      type: "failing",
      repo,
      installation: at.installation,
      key: entryKey(delivery.guid),
      label: {
        key: "entry.delivery",
        values: { event: action === null ? event : `${event}.${action}` },
      },
      url: at.url,
    });
    changed = true;
  }
  return changed ? [id] : [];
}

/**
 * The events that failed, as one run of the schedule takes them: the deliveries
 * of the last three hours, the events that get another attempt and the entries
 * of the alarm. Returns the id of the alarm when it changed.
 */
export async function failedEvents(context: Context): Promise<string[]> {
  const { found: deliveries, complete } = await recent(context);
  if (!complete) {
    // A newer pass that overtakes a failed event, or an attempt that passed
    // already, may be among the deliveries that this run couldn't read: the
    // next run reads them and decides.
    return [];
  }
  const found = events(deliveries);
  const failing = found.filter(
    (event) =>
      event.first !== null && failed(event.newest) && !overtaken(event, found),
  );
  await redeliver(
    context,
    failing
      .filter((event) => event.attempts < MAX_ATTEMPTS)
      .map((event) => event.newest),
  );
  return alarm(
    context,
    failing
      .filter((event) => event.attempts >= MAX_ATTEMPTS)
      .map((event) => event.newest),
    // Only an attempt asked for again can pass after one that failed.
    found
      .filter((event) => event.newest.redelivery && passed(event.newest))
      .map((event) => event.newest),
  );
}

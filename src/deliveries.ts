/**
 * The events of GitHub that the pager failed to handle. GitHub never delivers an
 * event of a webhook again by itself, so each run of the schedule asks it to: it
 * reads the deliveries of the app's webhook of the last three hours, and an event
 * whose newest attempt got a 5xx from the pager, or no answer in time, comes
 * again, three attempts in all. An event whose third attempt fails becomes an
 * entry of the alarm of the control repository, the pager's own, which links the
 * recent deliveries on the app's Advanced page; an attempt that passes later, such
 * as one asked for there, takes it out. The list of the deliveries counts the
 * attempts, so the pager writes nothing for them, and each signal leaves the same
 * state when it comes twice, since a redelivery may bring one that went through
 * before its answer failed.
 */
import { type Delivery, GitHubError } from "./github.ts";
import { apply, type Context } from "./pager.ts";
import { type Alarm, isClosed, itemId, keys } from "./store.ts";

/** How far back the schedule reads the deliveries of the webhook, in milliseconds. */
export const LOOK_BACK = 3 * 60 * 60 * 1000;

/** How many pages of 100 deliveries one run reads at most. */
export const MAX_PAGES = 3;

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
 * message and their fallbacks, and the new name of the topic.
 */
export const ALARM_CHANGE = 10;

/** An event as its deliveries show it: its newest attempt, and how many it had. */
interface Event {
  newest: Delivery;
  attempts: number;
  /** Whether its first delivery is among those read, so that all its attempts are. */
  counted: boolean;
}

/** Whether the pager failed an attempt: a 5xx, or no answer in time. */
export function failed(delivery: Delivery): boolean {
  // A 4xx is a refusal of the pager, such as of a wrong signature: it would
  // refuse the same event again.
  return delivery.status_code === 0 || delivery.status_code >= 500;
}

/** The key of the entry of an event in the alarm, by the guid that all its attempts share. */
export function entryKey(guid: string): string {
  return `delivery:${guid}`;
}

/** How many more calls to the network this request may make. */
function left(context: Context): number {
  return SUBREQUESTS - context.subrequests();
}

/**
 * The deliveries of the last LOOK_BACK, newest first, as GitHub lists them, on as
 * many pages as MAX_PAGES and the calls left allow. A page that GitHub refuses
 * ends the list: the pages before it still reach back from the newest.
 */
async function recent(context: Context): Promise<Delivery[]> {
  const since = context.now() - LOOK_BACK;
  const read: Delivery[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES && left(context) > 0; page += 1) {
    try {
      const answer = await context.github.deliveries(cursor);
      read.push(...answer.deliveries);
      cursor = answer.cursor;
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
    const oldest = read.at(-1);
    if (
      cursor === null ||
      oldest === undefined ||
      Date.parse(oldest.delivered_at) < since
    ) {
      break;
    }
  }
  return read.filter((delivery) => Date.parse(delivery.delivered_at) >= since);
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
      counted: known?.counted === true || !delivery.redelivery,
    });
  }
  return [...found.values()];
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
  const found = events(await recent(context));
  const failing = found.filter(
    (event) => event.counted && failed(event.newest),
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
      .filter(
        (event) =>
          event.newest.redelivery &&
          event.newest.status_code > 0 &&
          event.newest.status_code < 400,
      )
      .map((event) => event.newest),
  );
}

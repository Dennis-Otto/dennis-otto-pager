/**
 * The schedule of the Worker, every 15 minutes: a thing that "Later" put aside
 * comes back as a new message when its time is up, and the reminder of the token
 * of Claude comes three weeks before it expires.
 */
import { type Context, show } from "./pager.ts";
import { itemId, keys } from "./store.ts";

const DAY = 24 * 60 * 60 * 1000;
/** How many days before the token of Claude expires the pager reminds. */
export const REMIND_DAYS = 21;

async function bringBack(context: Context): Promise<string[]> {
  const done: string[] = [];
  for (const id of await context.store.due(context.now())) {
    const item = await context.store.get(id);
    if (item === null) {
      // Expired between the list and the read.
      continue;
    }
    item.snoozedUntil = null;
    await show(context, item, true);
    done.push(id);
  }
  return done;
}

async function remind(context: Context): Promise<string | null> {
  const expires = context.settings.tokenExpires;
  if (expires === null) {
    return null;
  }
  const left = Math.ceil(
    (Date.parse(`${expires}T00:00:00Z`) - context.now()) / DAY,
  );
  if (left > REMIND_DAYS) {
    return null;
  }
  const id = await itemId(keys.reminder(`claude-token:${expires}`));
  if ((await context.store.get(id)) !== null) {
    return null;
  }
  const repo = context.settings.controlRepository;
  const when =
    left > 0
      ? `in ${left} days, on ${expires}`
      : `on ${expires}: it has expired`;
  await show(context, {
    id,
    kind: "reminder",
    state: "open",
    repo,
    installation: 0,
    messageId: null,
    note: null,
    snoozedUntil: null,
    text: `The token of Claude in ${repo} expires ${when}. Renew it: run "claude setup-token", then "gh secret set CLAUDE_CODE_OAUTH_TOKEN -R ${repo}", and change CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.`,
  });
  return id;
}

/** One run of the schedule; returns the ids of the things that it showed. */
export async function runSchedule(context: Context): Promise<string[]> {
  const shown = await bringBack(context);
  const reminder = await remind(context);
  return reminder === null ? shown : [...shown, reminder];
}

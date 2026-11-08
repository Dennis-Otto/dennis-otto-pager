/**
 * The allowlist of the buttons: which actions each kind of thing offers in each of
 * its states. The message shows exactly these buttons, and a press runs an action
 * only when the thing, in its state at the time of the press, still offers it, so
 * an old button of a changed message does nothing.
 */
import type { Contribution, Decision, Item } from "./store.ts";
import type { Keyboard } from "./telegram.ts";
import type { Texts } from "./texts.ts";

export const ACTIONS = [
  "merge",
  "assistant",
  "fix",
  "rerun",
  "draft",
  "send",
  "edit",
  "ignore",
  "later",
  "done",
  "choose",
] as const;

export type Action = (typeof ACTIONS)[number];

/** The actions whose buttons have a label of the catalog: an option of a decision is its own. */
export type Labeled = Exclude<Action, "choose">;

/** The label of a button, in the language of the texts. */
export function label(t: Texts, action: Labeled): string {
  return t(`button.${action}`);
}

/** The actions of a contribution in its current state, in the order of its buttons. */
function contribution(item: Contribution): Action[] {
  switch (item.state) {
    case "new":
      return item.pull
        ? ["draft", "later", "ignore"]
        : ["draft", "assistant", "later", "ignore"];
    case "drafting":
      return ["later", "ignore"];
    case "draft":
      return ["send", "edit", "later", "ignore"];
    default:
      return [];
  }
}

/** The actions that a thing offers in its current state, in the order of its buttons. */
export function allowed(item: Item): Action[] {
  switch (item.kind) {
    case "contribution":
      // A discussion gets its draft by itself, which it sends, edits or ignores;
      // the issue assistant answers issues only.
      return item.discussion === undefined
        ? contribution(item)
        : contribution(item).filter(
            (action) => action !== "later" && action !== "assistant",
          );
    case "alarm":
    case "alert":
      switch (item.state) {
        case "open":
          // 🔁 Rerun where an entry of an alarm names a run that failed: it
          // costs no run of Claude.
          return item.kind === "alarm" &&
            item.entries.some((entry) => entry.run !== undefined)
            ? ["rerun", "fix", "later", "ignore"]
            : ["fix", "later", "ignore"];
        case "fixing":
          return ["later", "ignore"];
        default:
          return [];
      }
    case "release":
      return item.state === "ready" ? ["merge", "later", "ignore"] : [];
    case "pictures":
      // Ignore stops the pictures of the pull request; they need nothing else.
      return item.state === "open" ? ["ignore"] : [];
    case "reminder":
      return item.state === "open" ? ["done", "later"] : [];
    case "decision":
      // An agent waits for the answer: it takes no "Later" and no "Ignore".
      return item.state === "open" ? ["choose"] : [];
  }
}

/**
 * A short number for the head commit of a release (32-bit FNV-1a), so that a Merge
 * button names the head that it was offered at.
 */
export function headTag(sha: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sha.length; index += 1) {
    hash = Math.imul(hash ^ sha.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The data of a button, at most 64 bytes as Telegram allows: the action, the id of
 * the thing and, for "Send", the version of the draft that the message shows, for
 * "Merge" the head of the release that it shows; an option of a decision carries
 * its place instead, as options() makes it.
 */
export function callbackData(action: Action, item: Item): string {
  let version = "";
  if (action === "send" && item.kind === "contribution") {
    version = `:${item.draftVersion}`;
  } else if (action === "merge" && item.kind === "release") {
    version = `:${headTag(item.sha)}`;
  }
  return `${action}:${item.id}${version}`;
}

export interface Press {
  action: Action;
  id: string;
  version: number | null;
}

/** The action, the thing and the version of a button's data, or null for a stranger's. */
export function parsePress(data: string): Press | null {
  const match = /^([a-z]+):(i[0-9a-f]{15})(?::(\d+))?$/.exec(data);
  const action = ACTIONS.find((name) => name === match?.[1]);
  if (match === null || action === undefined) {
    return null;
  }
  return {
    action,
    id: match[2] as string,
    version: match[3] === undefined ? null : Number(match[3]),
  };
}

/** The buttons of a decision that is open: one option a row, each its own label. */
function options(item: Decision): Keyboard {
  if (!allowed(item).includes("choose")) {
    return [];
  }
  return item.options.map((option, place) => [
    { text: option, callback_data: `choose:${item.id}:${place}` },
  ]);
}

/** The keyboard of a thing: its allowed actions, two buttons a row. */
export function keyboard(item: Item, t: Texts): Keyboard {
  if (item.kind === "decision") {
    return options(item);
  }
  const labeled = allowed(item).filter(
    (action): action is Labeled => action !== "choose",
  );
  const buttons = labeled.map((action) => ({
    text: label(t, action),
    callback_data: callbackData(action, item),
  }));
  const rows: Keyboard = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return rows;
}

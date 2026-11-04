/**
 * The allowlist of the buttons: which actions each kind of thing offers in each of
 * its states. The message shows exactly these buttons, and a press runs an action
 * only when the thing, in its state at the time of the press, still offers it, so
 * an old button of a changed message does nothing.
 */
import type { Item } from "./store.ts";
import type { Keyboard } from "./telegram.ts";
import type { Texts } from "./texts.ts";

export const ACTIONS = [
  "merge",
  "assistant",
  "fix",
  "draft",
  "send",
  "edit",
  "ignore",
  "later",
  "done",
] as const;

export type Action = (typeof ACTIONS)[number];

/** The label of a button, in the language of the texts. */
export function label(t: Texts, action: Action): string {
  return t(`button.${action}`);
}

/** The actions that a thing offers in its current state, in the order of its buttons. */
export function allowed(item: Item): Action[] {
  switch (item.kind) {
    case "contribution":
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
    case "alarm":
    case "alert":
      switch (item.state) {
        case "open":
          return ["fix", "later", "ignore"];
        case "fixing":
          return ["later", "ignore"];
        default:
          return [];
      }
    case "release":
      return item.state === "ready" ? ["merge", "later", "ignore"] : [];
    case "reminder":
      return item.state === "open" ? ["done", "later"] : [];
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
 * "Merge" the head of the release that it shows.
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

/** The keyboard of a thing: its allowed actions, two buttons a row. */
export function keyboard(item: Item, t: Texts): Keyboard {
  const buttons = allowed(item).map((action) => ({
    text: label(t, action),
    callback_data: callbackData(action, item),
  }));
  const rows: Keyboard = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return rows;
}

/**
 * What a run of Claude took, as the control repository reads it from the transcript
 * of the Claude Code action: the models that worked, with the tokens of each, the
 * effort that its workflow set, and the turns and the time. The footer of an answer
 * says it on one line, such as "🧮 Opus 5.5 · high · 48,213 tokens", in the
 * language of the pager.
 */
import type { Texts } from "./texts.ts";

/** The levels of effort of Claude Code, as its option --effort names them. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** A model that worked in a run, by its id, such as claude-opus-5-5, and its tokens. */
export interface ModelUsage {
  model: string;
  tokens: number;
}

/** What a run of Claude took from the maintainer's weekly limit. */
export interface Usage {
  turns: number;
  seconds: number;
  /** The effort of the run, one of EFFORTS, or a newer one that the pager shows as it is. */
  effort?: string;
  /** The models, each with every token that it read and wrote, the cache included. */
  models?: ModelUsage[];
}

/** The most models that a footer names. */
export const MAX_MODELS = 5;

/** The id of a model as Claude Code names it, with a provider's prefix or a date at most. */
const MODEL = /^[\w.:@[\]/-]{1,100}$/;

type Fields = Partial<Record<string, unknown>>;

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function modelsOf(value: unknown): ModelUsage[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_MODELS
  ) {
    return null;
  }
  const models: ModelUsage[] = [];
  for (const each of value as (Fields | null)[]) {
    const model = each?.model;
    const tokens = each?.tokens;
    if (
      typeof model !== "string" ||
      !MODEL.test(model) ||
      !count(tokens) ||
      tokens === 0
    ) {
      return null;
    }
    models.push({ model, tokens });
  }
  return models;
}

/** The usage of a body: undefined when it has none, null when it is wrong. */
export function usageOf(value: unknown): Usage | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const usage = value as Fields | null;
  if (!count(usage?.turns) || !count(usage?.seconds)) {
    return null;
  }
  const read: Usage = { turns: usage.turns, seconds: usage.seconds };
  if (usage.effort !== undefined) {
    if (
      typeof usage.effort !== "string" ||
      !/^[a-z]{1,20}$/.test(usage.effort)
    ) {
      return null;
    }
    read.effort = usage.effort;
  }
  if (usage.models !== undefined) {
    const models = modelsOf(usage.models);
    if (models === null) {
      return null;
    }
    read.models = models;
  }
  return read;
}

/**
 * The short name of a model, such as Opus 5.5 for claude-opus-5-5 or Haiku 3.5 for
 * claude-3-5-haiku-20241022: its family and its version, without a date or the size
 * of its context. An id of another form stays as it is.
 */
export function modelName(id: string): string {
  if (!id.startsWith("claude-")) {
    return id;
  }
  const parts = id
    .slice("claude-".length)
    .replace(/\[\w+\]$/, "")
    .replace(/[-@]\d{8}$/, "")
    .split("-");
  const words = parts.filter((part) => /^[a-z]+$/.test(part));
  const numbers = parts.filter((part) => /^\d{1,2}$/.test(part));
  const [word] = words;
  if (
    word === undefined ||
    words.length > 1 ||
    numbers.length === 0 ||
    numbers.length > 2 ||
    words.length + numbers.length !== parts.length
  ) {
    return id;
  }
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} ${numbers.join(".")}`;
}

/** The effort in the words of the language; a newer level stays as Claude Code names it. */
function effortName(effort: string, t: Texts): string {
  return (EFFORTS as readonly string[]).includes(effort)
    ? t(`effort.${effort as (typeof EFFORTS)[number]}`)
    : effort;
}

/**
 * The share of a model in the tokens of a run, in whole percent. Only called when
 * several models worked, so no share reads 0 or 100: a tiny one is "<1", a huge one ">99".
 */
function share(tokens: number, total: number): string {
  const percent = (tokens * 100) / total;
  if (percent < 1) {
    return "<1";
  }
  return percent > 99 ? ">99" : String(Math.round(percent));
}

/**
 * The footer of an answer, on one line: the model, or each with its share when more
 * than one worked, the effort and every token of the run. Without the models, as
 * from a control repository before them, the turns and the time. Plain text: an
 * HTML message escapes it.
 */
export function footer(usage: Usage | undefined, t: Texts): string | null {
  if (usage === undefined) {
    return null;
  }
  const models = [...(usage.models ?? [])].sort((a, b) => b.tokens - a.tokens);
  if (models.length === 0) {
    const turns =
      usage.turns === 1
        ? t("usage.one")
        : t("usage.many", { turns: usage.turns });
    return t("usage.line", { turns, seconds: usage.seconds });
  }
  const total = models.reduce((sum, each) => sum + each.tokens, 0);
  const named = models
    .map((each) =>
      models.length === 1
        ? modelName(each.model)
        : t("usage.share", {
            model: modelName(each.model),
            share: share(each.tokens, total),
          }),
    )
    .join(", ");
  const parts = [named];
  if (usage.effort !== undefined) {
    parts.push(effortName(usage.effort, t));
  }
  parts.push(t("usage.tokens", { tokens: t.number(total) }));
  return `🧮 ${parts.join(" · ")}`;
}

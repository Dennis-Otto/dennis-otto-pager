/**
 * The answer to /status: the health of the pager, which the control repository
 * asks for once a day (src/health.ts), in the words of the maintainer, and whether
 * the app is installed on the control repository, one line each. A line that
 * fails names the step of docs/setup.md that fixes it, so a new instance can test
 * itself before its control repository runs, and a quiet pager can be asked why
 * at once. It is the answer to a question, not a message that all is well, which
 * decision 0013 turned down: the check from outside stays what catches a dead
 * pager. Like the health, it names no secret and changes nothing.
 */
import { errorOf, type Failure, type Health, health } from "./health.ts";
import type { Context } from "./pager.ts";
import { html } from "./render.ts";
import type { Key } from "./texts.ts";
import { REMIND_DAYS, type Token, type TokenState } from "./tokens.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * How old the last run of the schedule may be, which runs every 15 minutes, and
 * how long an error of the webhook counts: the bounds of the check Health of the
 * control repository (pager/health.mjs of repo-pager-control-template), so that
 * both say the same of one pager.
 */
export const SCHEDULE_WITHIN = HOUR;
export const WEBHOOK_WITHIN = DAY;

/** The name of each token in a line, in the order of the lines. */
const NAMES = {
  claude: "status.token.claude",
  user: "status.token.user",
  fix: "status.token.fix",
} as const satisfies Record<Token, Key>;

function schedule(context: Context, ran: string | null): string {
  const { t } = context;
  if (ran === null) {
    return t("status.scheduleNever");
  }
  const at = Date.parse(ran);
  const time = t.time(at);
  return at < context.now() - SCHEDULE_WITHIN
    ? t("status.scheduleLate", { time })
    : t("status.schedule", { time });
}

/**
 * The last thing that failed in a run of the schedule, while the runs since
 * haven't got past it: one that a later run that came to its end left behind
 * is over.
 */
function failure(
  context: Context,
  failed: Failure | null,
  ran: string | null,
): string[] {
  if (failed === null || (ran !== null && failed.at <= ran)) {
    return [];
  }
  return [
    context.t("status.failure", {
      time: context.t.time(Date.parse(failed.at)),
      what: html(failed.what),
      error: html(failed.error),
    }),
  ];
}

function telegram(context: Context, state: Health["telegram"]): string[] {
  const { t } = context;
  if (!state.ok) {
    return [t("status.telegramRefused", { error: html(state.error) })];
  }
  const lines = [state.webhook ? t("status.telegram") : t("status.noWebhook")];
  const last = state.lastError;
  if (
    last !== undefined &&
    Date.parse(last.at) >= context.now() - WEBHOOK_WITHIN
  ) {
    lines.push(
      t("status.webhookFailed", {
        time: t.time(Date.parse(last.at)),
        error: html(last.message),
        pending: state.pending,
      }),
    );
  }
  return lines;
}

function github(context: Context, state: Health["github"]): string {
  return state.ok
    ? context.t("status.github")
    : context.t("status.githubRefused", { error: html(state.error) });
}

/** Whether the app is installed on the control repository, as free text needs. */
async function control(context: Context): Promise<string> {
  const { t } = context;
  const repo = html(context.settings.controlRepository);
  try {
    const installation = await context.github.installation(
      context.settings.controlRepository,
    );
    return installation === null
      ? t("status.noControl", { repo })
      : t("status.control", { repo });
  } catch (error) {
    return t("status.controlFailed", { repo, error: html(errorOf(error)) });
  }
}

/** The line of a token that the pager knows. */
function token(context: Context, which: Token, state: TokenState): string {
  const { t } = context;
  const name = t(NAMES[which], {
    repo: html(context.settings.controlRepository),
  });
  if (state.refused !== undefined) {
    return t("status.tokenRefused", {
      token: name,
      date: t.date(state.refused),
    });
  }
  if (state.expires === null) {
    return t("status.tokenForever", { token: name });
  }
  const date = t.date(state.expires);
  const left = Math.ceil(
    (Date.parse(`${state.expires}T00:00:00Z`) - context.now()) / DAY,
  );
  if (left <= 0) {
    return t("status.tokenExpired", { token: name, date });
  }
  const days =
    left === 1
      ? t("reminder.days.one")
      : t("reminder.days.many", { days: left });
  return t(left > REMIND_DAYS ? "status.tokenExpires" : "status.tokenSoon", {
    token: name,
    days,
    date,
  });
}

/**
 * The lines of the tokens: GITHUB_USER_TOKEN whether it is set or not, since the
 * pager works without it, and each token whose day the pager knows, or will know
 * once the control repository names it.
 */
function tokens(context: Context, known: Health["tokens"]): string[] {
  const { t } = context;
  const repo = html(context.settings.controlRepository);
  const lines: string[] = [];
  if (known.claude !== undefined) {
    lines.push(token(context, "claude", known.claude));
  }
  if (context.settings.userToken === null) {
    lines.push(t("status.noUserToken"));
  } else if (known.user === undefined) {
    lines.push(t("status.userUnchecked"));
  } else {
    lines.push(token(context, "user", known.user));
  }
  lines.push(
    known.fix === undefined
      ? t("status.fixUnknown", { repo })
      : token(context, "fix", known.fix),
  );
  return lines;
}

/** The answer to /status, one line per thing that the pager needs. */
export async function status(context: Context): Promise<string> {
  const now = await health(context);
  return [
    context.t("status.title"),
    schedule(context, now.schedule),
    ...failure(context, now.failure, now.schedule),
    ...telegram(context, now.telegram),
    github(context, now.github),
    await control(context),
    ...tokens(context, now.tokens),
  ].join("\n");
}

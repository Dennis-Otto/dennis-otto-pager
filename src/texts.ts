/**
 * Every text that the pager sends to the maintainer, in each language that it
 * speaks: the messages and their states, the names of their topics, the buttons,
 * /help, the answers of the buttons, the errors that it shows and the reminder of
 * the token. LANGUAGE in
 * wrangler.jsonc chooses one, and English is the default. A text names its parts
 * in braces, such as {repo}, and what fills them, such as the title of an issue,
 * goes in as it is: only the words around it change with the language. The logs
 * stay in English.
 *
 * Both catalogs have the same keys, the compiler says so, and the same placeholders
 * and tags of Telegram's HTML, as test/texts.test.ts checks.
 */

/** The languages of the pager; the first is the default. */
export const LANGUAGES = ["en", "de"] as const;

export type Language = (typeof LANGUAGES)[number];

const en = {
  "button.merge": "🔀 Merge",
  "button.assistant": "🤖 Assistant again",
  "button.fix": "🛠 Start fix",
  "button.rerun": "🔁 Rerun",
  "button.draft": "✍️ Draft a reply",
  "button.send": "✅ Send",
  "button.edit": "✏️ Edit",
  "button.ignore": "✖ Ignore",
  "button.later": "⏰ Later",
  "button.done": "✅ Renewed",
  "button.confirm": "✅ Confirm",

  "state.drafting": "✍️ The control repository drafts a reply…",
  "state.sent": "✅ Sent.",
  "state.ignored": "✖ Ignored.",
  "state.fixing": "🛠 A fix is under way in the control repository…",
  "state.recovered": "✅ Green again.",
  "state.resolved": "✅ Resolved.",
  "state.updating": "⏳ Updated: waiting for its checks again.",
  "state.merging": "🔀 Merging…",
  "state.merged": "🔀 Merged: the release is being published…",
  "state.done": "✅ Done.",

  "message.issue": "🙋 <b>New issue</b> in {repo} by <b>{author}</b>\n{link}",
  "message.pull":
    "🙋 <b>New pull request</b> in {repo} by <b>{author}</b>\n{link}",
  "message.discussion":
    "💬 <b>New discussion</b> in {repo} by <b>{author}</b>\n{link}",
  "message.comment":
    "💬 <b>New comment</b> on a discussion in {repo} by <b>{author}</b>\n{link}",
  "message.draft":
    '<b>Draft of a reply</b>, which "Send" posts in your name as it stands here:\n<blockquote>{draft}</blockquote>',
  "message.reply":
    '<b>Draft of a reply</b>, which "Send" posts in the discussion as the app of the pager, as it stands here:\n<blockquote>{draft}</blockquote>',
  "message.alarm": "🚨 <b>{repo} needs you</b>\n{entries}",
  "message.alert": "🛡 <b>Code scanning in {repo}</b>\n{entries}",
  "message.more": "… and {count} more",
  "message.rerunning": "🔁 running again…",
  "message.release": "📦 <b>Release {version}</b> of {repo}: {link}",
  "message.ready": 'Every check is green, and "Merge" publishes it.',
  "message.published": "✅ Published.",
  "message.back": "⏰ Back in {hours} h.",

  "entry.bot": "A bot fails: {title}",
  "entry.release": "The release fails: {name}",
  "entry.check": "{name} fails on {branch}",
  "entry.alert": "{severity}: {what}",
  "entry.alertAt": "{severity}: {what} in {path}",

  "blocker.closed": "it isn't open",
  "blocker.branch": "it isn't a release pull request",
  "blocker.base": "it doesn't go into {branch}",
  "blocker.title": "its title names no release",
  "blocker.draft": "it is a draft",
  "blocker.checks": "its checks aren't all green ({state})",

  "answer.notInstalled":
    "The GitHub App isn't installed on {repo}, which does this: install it there, as docs/setup.md says.",
  "answer.releaseMoved":
    "This release changed since this message: use its newest message.",
  "answer.releaseChanged":
    "The release changed since this message: it comes back once its checks are green.",
  "answer.notMerged": "Not merged: {why}.",
  "answer.merging": "Merging.",
  "answer.fixing":
    "Sent to the control repository: Claude looks for a fix, from your weekly limit.",
  "answer.rerun":
    "The failed jobs run again: a pass takes the entry out, a failure says so.",
  "answer.rerunRunning":
    "It still runs, or a newer attempt of it runs: nothing was started.",
  "answer.rerunPassed": "It passed already on a retry: nothing was started.",
  "answer.drafting":
    "The control repository drafts a reply with Claude, from your weekly limit.",
  "answer.noOverride":
    "The issue assistant of {repo} doesn't take the override yet: it comes with the release of the blueprint that brings the runs by hand of the issue assistant. Nothing was started.",
  "answer.assistant": "The issue assistant runs.",
  "answer.draftOutdated":
    "This draft is out of date: send the one that the message shows now.",
  "answer.sent": "Sent.",
  "answer.edit": "Write the new text in reply.",
  "answer.outdated": "This button is out of date.",
  "answer.later": "Back in {hours} h.",
  "answer.ignored": "Ignored.",
  "answer.done": "Done.",
  "answer.refused": "GitHub refused: {detail}",
  "answer.noUserToken":
    "GITHUB_USER_TOKEN isn't set, so nothing can act in your name: set it, as docs/setup.md says.",
  "answer.unknown": "This button is unknown.",
  "answer.gone": "This thing is gone.",

  "note.assistant": "🤖 The issue assistant answers again.",
  "note.sent": "Posted in your name.",
  "note.replied": "Posted in the discussion as the app of the pager.",
  "note.noAnswer":
    "⌛ No answer from the control repository within the hour: its run in its Actions tab says why.",

  "edit.prompt":
    '✏️ Reply to this message with the new text of the reply to {thing}. The message of the draft then shows your text, and "Send" posts it as it stands.',
  "edit.placeholder": "Reply",
  "edit.gone": "That draft is gone; nothing changed.",
  "edit.tooLong":
    "That text has {length} characters; a reply here takes {max} at most. Send a shorter one with ✏️ Edit.",

  "chat.help":
    "👋 This is your pager. It writes only when something needs you, one message per thing, each in a topic of its own, and edits that message as the thing changes; a thing that is done gets ✅ in front of its topic.\n\nThe buttons act on GitHub from a fixed list. Any other text goes to the control repository, which answers here; an answer that proposes an action comes with a ✅ Confirm button, and only a press acts. Write in the topic of a thing, or reply to its message, to ask about it; a topic that you open, and General, start a conversation of their own.\n\nEach answer, draft and fix of the control repository is a run of Claude with your subscription: it counts against your weekly limit, and its message says how much it took.",
  "chat.noControl":
    "Free text goes to the workflow of {repo}, where the GitHub App isn't installed yet: install it there, as docs/setup.md says.",

  "usage.one": "1 turn",
  "usage.many": "{turns} turns",
  "usage.line": "🧮 Claude: {turns}, {seconds} s, from your weekly limit",
  "usage.tokens": "{tokens} tokens",
  "usage.share": "{model} {share}%",
  "effort.low": "low",
  "effort.medium": "medium",
  "effort.high": "high",
  "effort.xhigh": "extra high",
  "effort.max": "max",

  "proposal.codeScanning": "code scanning of {repo}",
  "proposal.notShown":
    "No button: the pager shows no {kind} of {repo} for {label}.",
  "proposal.notOffered": "No button: {thing} doesn't offer {label} now.",
  "kind.contribution": "contribution",
  "kind.alarm": "alarm",
  "kind.alert": "alert",
  "kind.release": "release",

  "topic.contribution": "🙋 {repo}#{number} {title}",
  "topic.discussion": "💬 {repo}#{number} {title}",
  "topic.alarm": "🚨 {repo} needs you",
  "topic.alert": "🛡 Code scanning in {repo}",
  "topic.release": "📦 {repo} {version}",
  "topic.reminder": "🔔 Token of Claude",
  "topic.done": "✅ {name}",

  "reminder.days.one": "1 day",
  "reminder.days.many": "{days} days",
  "reminder.soon":
    'The token of Claude in {repo} expires in {days}, on {date}. Renew it: run "claude setup-token", then "gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}", and change CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.',
  "reminder.expired":
    'The token of Claude in {repo} expires on {date}: it has expired. Renew it: run "claude setup-token", then "gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}", and change CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.',
} as const;

export type Key = keyof typeof en;

/** The names in the braces of a text, such as "repo" of "in {repo}". */
type Names<Text extends string> =
  Text extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Names<Rest>
    : never;

/** A key, with the values of its placeholders when it has any. */
type Fields<K extends Key> = [Names<(typeof en)[K]>] extends [never]
  ? { key: K }
  : { key: K; values: Record<Names<(typeof en)[K]>, string | number> };

/**
 * A text of the catalog with its values, but without a language: what the rules
 * hand on, such as why a release may not merge yet, for the pager to word.
 */
export type Phrase = { [K in Key]: Fields<K> }[Key];

/** The texts of one language. */
export interface Texts {
  /** The text of a key, its placeholders filled with the values. */
  <K extends Key>(
    key: K,
    ...values: Fields<K> extends { values: infer V } ? [V] : []
  ): string;
  /** The text of a phrase. */
  phrase(phrase: Phrase): string;
  /** A day, such as 2027-10-07, as the language writes it. */
  date(day: string): string;
  /** A whole number, such as 48213, as the language writes it: 48,213 or 48.213. */
  number(value: number): string;
  readonly language: Language;
}

type Catalog = { readonly [K in Key]: string };

const de: Catalog = {
  "button.merge": "🔀 Mergen",
  "button.assistant": "🤖 Assistent nochmal",
  "button.fix": "🛠 Fix starten",
  "button.rerun": "🔁 Neu starten",
  "button.draft": "✍️ Antwort entwerfen",
  "button.send": "✅ Senden",
  "button.edit": "✏️ Bearbeiten",
  "button.ignore": "✖ Ignorieren",
  "button.later": "⏰ Später",
  "button.done": "✅ Erneuert",
  "button.confirm": "✅ Bestätigen",

  "state.drafting": "✍️ Das Steuer-Repository entwirft eine Antwort …",
  "state.sent": "✅ Gesendet.",
  "state.ignored": "✖ Ignoriert.",
  "state.fixing": "🛠 Das Steuer-Repository arbeitet an einem Fix …",
  "state.recovered": "✅ Wieder grün.",
  "state.resolved": "✅ Behoben.",
  "state.updating": "⏳ Aktualisiert: wartet wieder auf seine Checks.",
  "state.merging": "🔀 Wird gemergt …",
  "state.merged": "🔀 Gemergt: Das Release wird veröffentlicht …",
  "state.done": "✅ Erledigt.",

  "message.issue":
    "🙋 <b>Neues Issue</b> in {repo} von <b>{author}</b>\n{link}",
  "message.pull":
    "🙋 <b>Neuer Pull Request</b> in {repo} von <b>{author}</b>\n{link}",
  "message.discussion":
    "💬 <b>Neue Diskussion</b> in {repo} von <b>{author}</b>\n{link}",
  "message.comment":
    "💬 <b>Neuer Kommentar</b> zu einer Diskussion in {repo} von <b>{author}</b>\n{link}",
  "message.draft":
    "<b>Entwurf einer Antwort</b>, den „Senden“ genau so in deinem Namen postet:\n<blockquote>{draft}</blockquote>",
  "message.reply":
    "<b>Entwurf einer Antwort</b>, den „Senden“ genau so als App des Pagers in der Diskussion postet:\n<blockquote>{draft}</blockquote>",
  "message.alarm": "🚨 <b>{repo} braucht dich</b>\n{entries}",
  "message.alert": "🛡 <b>Code Scanning in {repo}</b>\n{entries}",
  "message.more": "… und {count} weitere",
  "message.rerunning": "🔁 läuft erneut …",
  "message.release": "📦 <b>Release {version}</b> von {repo}: {link}",
  "message.ready": "Alle Checks sind grün, und „Mergen“ veröffentlicht es.",
  "message.published": "✅ Veröffentlicht.",
  "message.back": "⏰ Zurück in {hours} Std.",

  "entry.bot": "Ein Bot scheitert: {title}",
  "entry.release": "Das Release scheitert: {name}",
  "entry.check": "{name} scheitert auf {branch}",
  "entry.alert": "{severity}: {what}",
  "entry.alertAt": "{severity}: {what} in {path}",

  "blocker.closed": "er ist nicht offen",
  "blocker.branch": "er ist kein Release-Pull-Request",
  "blocker.base": "er geht nicht in {branch}",
  "blocker.title": "sein Titel nennt kein Release",
  "blocker.draft": "er ist ein Entwurf",
  "blocker.checks": "seine Checks sind nicht alle grün ({state})",

  "answer.notInstalled":
    "Die GitHub-App ist auf {repo} nicht installiert, und dieses Repository erledigt das: Installier sie dort, wie docs/setup.md es beschreibt.",
  "answer.releaseMoved":
    "Das Release hat sich seit dieser Nachricht geändert: Nimm seine neueste Nachricht.",
  "answer.releaseChanged":
    "Das Release hat sich seit dieser Nachricht geändert: Es kommt wieder, sobald seine Checks grün sind.",
  "answer.notMerged": "Nicht gemergt: {why}.",
  "answer.merging": "Wird gemergt.",
  "answer.fixing":
    "Ans Steuer-Repository geschickt: Claude sucht einen Fix, von deinem Wochenlimit.",
  "answer.rerun":
    "Die gescheiterten Jobs laufen erneut: Ein Erfolg nimmt den Eintrag heraus, ein Fehlschlag sagt es.",
  "answer.rerunRunning":
    "Der Lauf läuft noch, oder ein neuerer Versuch von ihm läuft: Nichts wurde gestartet.",
  "answer.rerunPassed":
    "Der Lauf ist bei einem neuen Versuch schon grün geworden: Nichts wurde gestartet.",
  "answer.drafting":
    "Das Steuer-Repository entwirft mit Claude eine Antwort, von deinem Wochenlimit.",
  "answer.noOverride":
    "Der Issue-Assistent von {repo} kennt den Override noch nicht: Er kommt mit dem Release des Blueprints, das die Läufe des Issue-Assistenten von Hand bringt. Nichts gestartet.",
  "answer.assistant": "Der Issue-Assistent läuft.",
  "answer.draftOutdated":
    "Der Entwurf ist veraltet: Schick den, den die Nachricht jetzt zeigt.",
  "answer.sent": "Gesendet.",
  "answer.edit": "Schreib den neuen Text als Antwort.",
  "answer.outdated": "Der Knopf ist veraltet.",
  "answer.later": "Zurück in {hours} Std.",
  "answer.ignored": "Ignoriert.",
  "answer.done": "Erledigt.",
  "answer.refused": "GitHub lehnt ab: {detail}",
  "answer.noUserToken":
    "GITHUB_USER_TOKEN ist nicht gesetzt, also kann nichts in deinem Namen handeln: Setz ihn, wie docs/setup.md es beschreibt.",
  "answer.unknown": "Diesen Knopf kenne ich nicht.",
  "answer.gone": "Die Sache gibt es nicht mehr.",

  "note.assistant": "🤖 Der Issue-Assistent antwortet noch einmal.",
  "note.sent": "In deinem Namen gepostet.",
  "note.replied": "In der Diskussion als App des Pagers gepostet.",
  "note.noAnswer":
    "⌛ Keine Antwort vom Steuer-Repository binnen einer Stunde: Sein Lauf im Actions-Tab sagt, warum.",

  "edit.prompt":
    "✏️ Antworte auf diese Nachricht mit dem neuen Text der Antwort an {thing}. Die Nachricht des Entwurfs zeigt dann deinen Text, und „Senden“ postet ihn genau so.",
  "edit.placeholder": "Antwort",
  "edit.gone": "Den Entwurf gibt es nicht mehr; nichts geändert.",
  "edit.tooLong":
    "Der Text hat {length} Zeichen; eine Antwort hier nimmt höchstens {max}. Schick einen kürzeren mit ✏️ Bearbeiten.",

  "chat.help":
    "👋 Das ist dein Pager. Er schreibt nur, wenn etwas dich braucht, eine Nachricht pro Sache, jede in einem eigenen Thema, und ändert diese Nachricht, wenn sich die Sache ändert; eine erledigte Sache bekommt ✅ vor ihr Thema.\n\nDie Knöpfe handeln auf GitHub, aus einer festen Liste. Jeder andere Text geht ans Steuer-Repository, das hier antwortet; eine Antwort, die eine Aktion vorschlägt, kommt mit einem Knopf ✅ Bestätigen, und erst dein Druck darauf handelt. Schreib im Thema einer Sache, oder antworte auf ihre Nachricht, um nach ihr zu fragen; ein Thema, das du selbst öffnest, und General beginnen ein eigenes Gespräch.\n\nJede Antwort, jeder Entwurf und jeder Fix des Steuer-Repositorys ist ein Lauf von Claude mit deinem Abo: Er zählt auf dein Wochenlimit, und seine Nachricht sagt, wie viel er genommen hat.",
  "chat.noControl":
    "Freier Text geht an den Workflow von {repo}, wo die GitHub-App noch nicht installiert ist: Installier sie dort, wie docs/setup.md es beschreibt.",

  "usage.one": "1 Runde",
  "usage.many": "{turns} Runden",
  "usage.line": "🧮 Claude: {turns}, {seconds} s, von deinem Wochenlimit",
  "usage.tokens": "{tokens} Tokens",
  "usage.share": "{model} {share} %",
  "effort.low": "Niedrig",
  "effort.medium": "Mittel",
  "effort.high": "Hoch",
  "effort.xhigh": "Extra Hoch",
  "effort.max": "Max",

  "proposal.codeScanning": "Code Scanning von {repo}",
  "proposal.notShown":
    "Kein Knopf: Für {label} zeigt der Pager in {repo} nichts ({kind}).",
  "proposal.notOffered": "Kein Knopf: {thing} bietet {label} gerade nicht an.",
  "kind.contribution": "Beitrag",
  "kind.alarm": "Alarm",
  "kind.alert": "Code Scanning",
  "kind.release": "Release",

  "topic.contribution": "🙋 {repo}#{number} {title}",
  "topic.discussion": "💬 {repo}#{number} {title}",
  "topic.alarm": "🚨 {repo} braucht dich",
  "topic.alert": "🛡 Code Scanning in {repo}",
  "topic.release": "📦 {repo} {version}",
  "topic.reminder": "🔔 Claude-Token",
  "topic.done": "✅ {name}",

  "reminder.days.one": "1 Tag",
  "reminder.days.many": "{days} Tagen",
  "reminder.soon":
    "Das Claude-Token in {repo} läuft in {days} ab, am {date}. Erneuere es: Führ „claude setup-token“ aus, dann „gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}“, und ändere CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.",
  "reminder.expired":
    "Das Claude-Token in {repo} ist am {date} abgelaufen. Erneuere es: Führ „claude setup-token“ aus, dann „gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}“, und ändere CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.",
};

export const CATALOGS: Readonly<Record<Language, Catalog>> = { en, de };

/** How each language writes a day of the form 2027-10-07. */
const DATES: Readonly<Record<Language, (day: string) => string>> = {
  en: (day) => day,
  de: (day) => day.split("-").reverse().join("."),
};

/** The sign between the thousands of a number in each language. */
const THOUSANDS: Readonly<Record<Language, string>> = { en: ",", de: "." };

/**
 * A text with its placeholders filled. One pass over the text of the catalog, so a
 * value that holds braces itself, such as a title, stays as it is.
 */
function fill(
  text: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

/** The language of LANGUAGE: English when it is empty, null when it is unknown. */
export function languageOf(value: string | undefined): Language | null {
  const name = value?.trim() ?? "";
  if (name === "") {
    return LANGUAGES[0];
  }
  return LANGUAGES.find((each) => each === name) ?? null;
}

/** The texts of a language. */
export function texts(language: Language): Texts {
  const catalog = CATALOGS[language];
  const say = (key: Key, values?: Record<string, string | number>) =>
    fill(catalog[key], values);
  return Object.assign(say, {
    phrase: (phrase: Phrase) =>
      fill(catalog[phrase.key], "values" in phrase ? phrase.values : {}),
    date: DATES[language],
    number: (value: number) =>
      String(value).replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS[language]),
    language,
  }) as Texts;
}

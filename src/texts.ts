/**
 * Every text that the pager sends to the maintainer, in each language that it
 * speaks: the messages and their states, the names of their topics, the buttons,
 * /help, the answers of the buttons, the errors that it shows and the reminders of
 * the tokens. LANGUAGE in
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
  "state.rerunning": "🔁 The failed jobs run again…",

  "message.issue": "🙋 <b>New issue</b> in {repo} by <b>{author}</b>\n{link}",
  "message.pull":
    "🙋 <b>New pull request</b> in {repo} by <b>{author}</b>\n{link}",
  "message.discussion":
    "💬 <b>New discussion</b> in {repo} by <b>{author}</b>\n{link}",
  "message.comment":
    "💬 <b>New comment</b> on a discussion in {repo} by <b>{author}</b>\n{link}",
  "message.issueComment":
    "💬 <b>New comment</b> on an issue in {repo} by <b>{author}</b>\n{link}",
  "message.pullComment":
    "💬 <b>New comment</b> on a pull request in {repo} by <b>{author}</b>\n{link}",
  "message.pullReview":
    "💬 <b>New review</b> of a pull request in {repo} by <b>{author}</b>\n{link}",
  "message.newComment": "💬 <b>{author}</b> commented: {link}",
  "message.newReview": "💬 <b>{author}</b> reviewed: {link}",
  "message.newCommits": "🔁 <b>{author}</b> pushed new commits: {link}",
  "message.reopened": "🔓 <b>{author}</b> reopened: {link}",
  "message.readyForReview":
    "👀 <b>{author}</b> made it ready for review: {link}",
  "message.newAlarmEntry": "🚨 New in this alarm: {link}",
  "message.newAlertEntry": "🛡 New in this security message: {link}",
  "message.draft":
    '<b>Draft of a reply</b>, which "Send" posts in your name as it stands here:\n<blockquote>{draft}</blockquote>',
  "message.reply":
    '<b>Draft of a reply</b>, which "Send" posts in the discussion as the app of the pager, as it stands here:\n<blockquote>{draft}</blockquote>',
  "message.otherDraft":
    "🤖 <b>Another draft came</b> for {thing}, but your own text stays the reply. Only for you to read:\n<blockquote>{draft}</blockquote>",
  "message.alarm": "🚨 <b>{repo} needs you</b>\n{entries}",
  "message.alert": "🛡 <b>Security in {repo}</b>\n{entries}",
  "message.advisory":
    "🔐 <b>Vulnerability report in {repo}</b>\n{link} · severity: {severity}",
  "message.advisoryDue":
    "📅 Acknowledge it by {acknowledge} and assess it by {assess}, as SECURITY.md promises. What it says stays on GitHub until it is published.",
  "message.more": "… and {count} more",
  "notes.breaking": "Breaking changes",
  "notes.features": "Features",
  "notes.added": "Added",
  "notes.changes": "Changes",
  "notes.changed": "Changed",
  "notes.deprecated": "Deprecated",
  "notes.removed": "Removed",
  "notes.fixes": "Bug fixes",
  "notes.fixed": "Fixed",
  "notes.performance": "Performance",
  "notes.security": "Security",
  "notes.reverts": "Reverts",
  "notes.documentation": "Documentation",
  "notes.refactoring": "Code refactoring",
  "notes.tests": "Tests",
  "notes.build": "Build system",
  "notes.ci": "Continuous integration",
  "notes.miscellaneous": "Miscellaneous",
  "notes.style": "Style",
  "notes.dependencies": "Dependencies",
  "message.rerunning": "🔁 running again…",
  "message.workflow": "🔴 <b>{name} fails on {branch} in {repo}</b>",
  "message.jobs": "Failed: {jobs}",
  "message.run": "The run that failed",
  "message.failedOnce": "Failed on {time}.",
  "message.failedTimes":
    "Failed {count} times since {since}, the last time on {time}.",
  "message.release": "📦 <b>Release {version}</b> of {repo}: {link}",
  "message.breaking":
    "⚠️ <b>Breaking changes</b>: read the notes before you merge.",
  "message.ready": 'Every check is green, and "Merge" publishes it.',
  "message.published": "✅ Published.",
  "message.back": "⏰ Back in {hours} h.",
  "message.pictures.one":
    "🖼 <b>1 picture looks different</b> in {repo} at {sha}: {link}",
  "message.pictures.many":
    "🖼 <b>{count} pictures look different</b> in {repo} at {sha}: {link}",
  "message.picturesSame":
    "🖼 <b>Every picture looks as committed again</b> in {repo} at {sha}: {link}",
  "message.album": "📸 The album below: {shown} of {count}.",
  "message.noAlbum":
    "📸 No album: none of them is a PNG or WebP that Telegram shows as a photo.",
  "message.check": "All of them before and after",
  "message.checkRed": "All of them before and after, the changes in red",
  "message.decision": "🤔 <b>A decision for you</b>\n{question}",
  "message.chosen": "✅ Your answer: <b>{option}</b>",
  "message.ownAnswer": "✅ Your answer, in your own words:\n{answer}",
  "message.withdrawn":
    "↩️ Your agent took this question back: it no longer waits for an answer.",
  "message.report": "🧾 <b>The report of a run</b>\n{text}",

  "picture.changed": "changed, {share} of its pixels",
  "picture.resized": "another size or frames",
  "picture.new": "new",
  "picture.deleted": "deleted",
  "caption.diff": "🔴 Changed pixels: {path}",
  "caption.diffFrame": "🔴 Changed pixels, frame {frame} of {frames}: {path}",
  "caption.diffAnimation":
    "🔴 Changed pixels of one frame of the animation: {path}",
  "caption.comparison": "🔍 Before and after: {path}, {how}",
  "caption.comparisonFrame":
    "🔍 Before and after, frame {frame} of {frames}: {path}, {how}",
  "caption.before": "◀️ Before: {path}",
  "caption.after": "▶️ After: {path}",
  "caption.new": "🆕 New: {path}",
  "caption.deleted": "🗑 Deleted: {path}",

  "entry.bot": "A bot fails: {title}",
  "entry.preview": "🖼 Upload the new social preview",
  "entry.release": "The release fails: {name}",
  "entry.check": "{name} fails on {branch}",
  "entry.delivery": "An event of GitHub fails: {event}",
  "entry.alert": "{severity}: {what}",
  "entry.alertAt": "{severity}: {what} in {path}",
  "entry.secret": "🔑 {what}",
  "entry.secretAt": "🔑 {what} in {path}",
  "entry.secretPublic": "🔑 {what}, leaked in public too",
  "entry.secretPublicAt": "🔑 {what} in {path}, leaked in public too",

  "blocker.closed": "it isn't open",
  "blocker.branch": "it isn't a release pull request",
  "blocker.fork": "it comes from a fork",
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
  "answer.nothingToFix":
    "Nothing here for Claude to fix: no entry links to a page of its repository.",
  "answer.rerun":
    "The failed jobs run again: a pass takes the entry out, a failure says so.",
  "answer.rerunWorkflow":
    "The failed jobs run again: a pass turns it ✅, a failure says so.",
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
  "answer.chosen": "Saved for your agent: {option}",
  "answer.refused": "GitHub refused: {detail}",
  "answer.noUserToken":
    "GITHUB_USER_TOKEN isn't set, so nothing can act in your name: set it, as docs/setup.md says.",
  "answer.userTokenRefused":
    'GitHub refuses GITHUB_USER_TOKEN: it expired or was revoked. Make a new one and set it with "npx wrangler secret put GITHUB_USER_TOKEN", as docs/setup.md says.',
  "answer.unknown": "This button is unknown.",
  "answer.gone": "This thing is gone.",
  "answer.failed":
    "😢 The pager failed on this press, and whether it acted is uncertain: look at the thing on GitHub, then press again.",

  "note.assistant": "🤖 The issue assistant answers again.",
  "note.sent": "Posted in your name.",
  "note.replied": "Posted in the discussion as the app of the pager.",
  "note.repliedOnGitHub":
    "💬 You replied on GitHub, so the pager sends nothing.",
  "note.answerChosen": "✅ An answer was marked on GitHub.",
  "note.closedOnGitHub": "Closed on GitHub.",
  "note.advisoryDue":
    "⏰ Still in triage on GitHub: acknowledge it by {date}, as SECURITY.md promises.",
  "note.discussionDeleted": "Deleted on GitHub.",
  "note.ownDraft":
    "✏️ A new comment came, and your own text stays the draft: send it, or edit it for the new comment.",
  "note.merged": "🔀 Merged.",
  "note.closed": "Closed without a merge.",
  "note.newCommits": "🔁 New commits by {author}.",
  "note.reopened": "🔓 Reopened by {author}.",
  "note.readyForReview": "👀 Ready for review, says {author}.",
  "note.albumFailed": "Telegram refused the pictures: {detail}",
  "note.noAnswer":
    "⌛ No answer from the control repository within the hour: its run in its Actions tab says why.",

  "edit.prompt":
    '✏️ Reply to this message with the new text of the reply to {thing}. The message of the draft then shows your text, and "Send" posts it as it stands.',
  "edit.placeholder": "Reply",
  "edit.gone": "That draft is gone; nothing changed.",
  "edit.tooLong":
    "That text has {length} characters; a reply here takes {max} at most. Send a shorter one with ✏️ Edit.",

  "decision.tooLong":
    "That answer has {length} characters; your agent takes {max} at most. Write a shorter one, or press an option.",
  "decision.notSaved":
    "😢 Not saved for your agent: GitHub refused: {detail}. The question stays open: write your answer again, or press an option.",

  "chat.help":
    "👋 This is your pager. It writes only when something needs you, one message per thing, each in a topic of its own, and edits that message as the thing changes; a thing that is done gets ✅ in front of its topic.\n\nThe buttons act on GitHub from a fixed list. Any other text goes to the control repository, which answers here, and so do the words below a photo or a file; the pager reads text only, not the picture, the file or a voice message itself; an answer that proposes an action comes with a ✅ Confirm button, and only a press acts. Write in the topic of a thing, or reply to its message, to ask about it; a topic that you open, and General, start a conversation of their own. A text in the topic of an open question of your agent is your answer to it, in your own words.\n\nEach answer, draft and fix of the control repository is a run of Claude with your subscription: it counts against your weekly limit, and its message says how much it took.",
  "chat.noControl":
    "Free text goes to the workflow of {repo}, where the GitHub App isn't installed yet: install it there, as docs/setup.md says.",
  "chat.notSent":
    "😢 Not sent to the control repository: GitHub refused: {detail}. Write your text again once that is fixed.",
  "chat.failed":
    "😢 The pager failed on this text, and whether it acted on it is uncertain: look whether it did, then write it again.",
  "chat.textOnly":
    "The pager reads text only: write it as a message, or put your words below the photo or the file.",
  "chat.tooLong":
    "That text has {length} characters; the control repository takes {max} at most. Send a shorter one.",

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

  "severity.critical": "critical",
  "severity.high": "high",
  "severity.medium": "medium",
  "severity.low": "low",
  "severity.none": "not rated yet",

  "proposal.security": "the security of {repo}",
  "proposal.notShown":
    "No button: the pager shows no {kind} of {repo} for {label}.",
  "proposal.notOffered": "No button: {thing} doesn't offer {label} now.",
  "kind.contribution": "contribution",
  "kind.alarm": "alarm",
  "kind.alert": "security message",
  "kind.release": "release",

  "topic.contribution": "🙋 {repo}#{number} {title}",
  "topic.discussion": "💬 {repo}#{number} {title}",
  "topic.alarm": "🚨 {repo} needs you",
  "topic.workflow": "🔴 {name} in {repo}",
  "topic.alert": "🛡 Security in {repo}",
  "topic.advisory": "🔐 Vulnerability report in {repo}",
  "topic.release": "📦 {repo} {version}",
  "topic.reminder": "🔔 Token of Claude",
  "topic.reminderUser": "🔔 GitHub token of the pager",
  "topic.reminderFix": "🔔 Token of 🛠 Start fix",
  "topic.pictures": "🖼 {repo}#{number} {title}",
  "topic.decision": "🤔 Decision: {question}",
  "topic.report": "🧾 Run",
  "topic.reportTitled": "🧾 Run: {title}",
  "topic.done": "✅ {name}",

  "reminder.days.one": "1 day",
  "reminder.days.many": "{days} days",
  "reminder.soon":
    'The token of Claude in {repo} expires in {days}, on {date}. Renew it: run "claude setup-token", then "gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}", and change CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.',
  "reminder.expired":
    'The token of Claude in {repo} expires on {date}: it has expired. Renew it: run "claude setup-token", then "gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}", and change CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.',
  "reminder.userSoon":
    'The GitHub token of the pager, GITHUB_USER_TOKEN, expires in {days}, on {date}; then ✅ Send and 🤖 Assistant again stop working. Renew it: regenerate it on https://github.com/settings/personal-access-tokens, then run "npx wrangler secret put GITHUB_USER_TOKEN" and paste the new token.',
  "reminder.userExpired":
    'The GitHub token of the pager, GITHUB_USER_TOKEN, expires on {date}: it has expired, so ✅ Send and 🤖 Assistant again fail. Renew it: regenerate it on https://github.com/settings/personal-access-tokens, then run "npx wrangler secret put GITHUB_USER_TOKEN" and paste the new token.',
  "reminder.userRefused":
    'GitHub refuses the token of the pager, GITHUB_USER_TOKEN: it expired or was revoked, so ✅ Send and 🤖 Assistant again fail. Make a new one on https://github.com/settings/personal-access-tokens with the permissions of docs/setup.md, then run "npx wrangler secret put GITHUB_USER_TOKEN".',
  "reminder.fixSoon":
    'The token PAGER_FIX_TOKEN in {repo} expires in {days}, on {date}; then 🛠 Start fix opens no pull request. Renew it: regenerate it on https://github.com/settings/personal-access-tokens, then run "gh secret set PAGER_FIX_TOKEN -R {repo}" and paste the new token.',
  "reminder.fixExpired":
    'The token PAGER_FIX_TOKEN in {repo} expires on {date}: it has expired, so 🛠 Start fix opens no pull request. Renew it: regenerate it on https://github.com/settings/personal-access-tokens, then run "gh secret set PAGER_FIX_TOKEN -R {repo}" and paste the new token.',
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
  /**
   * A moment, in milliseconds since 1970, to the minute in UTC, which the pager
   * knows no other zone than: 2026-11-08 at 11:20 UTC, or 08.11.2026 um 11:20 UTC.
   */
  time(at: number): string;
  /** A whole number, such as 48213, as the language writes it: 48,213 or 48.213. */
  number(value: number): string;
  /** A share between 0 and 1, such as 0.0231, as a percentage: 2.31 % or 2,31 %. */
  percent(share: number): string;
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
  "state.rerunning": "🔁 Die gescheiterten Jobs laufen erneut …",

  "message.issue":
    "🙋 <b>Neues Issue</b> in {repo} von <b>{author}</b>\n{link}",
  "message.pull":
    "🙋 <b>Neuer Pull Request</b> in {repo} von <b>{author}</b>\n{link}",
  "message.discussion":
    "💬 <b>Neue Diskussion</b> in {repo} von <b>{author}</b>\n{link}",
  "message.comment":
    "💬 <b>Neuer Kommentar</b> zu einer Diskussion in {repo} von <b>{author}</b>\n{link}",
  "message.issueComment":
    "💬 <b>Neuer Kommentar</b> zu einem Issue in {repo} von <b>{author}</b>\n{link}",
  "message.pullComment":
    "💬 <b>Neuer Kommentar</b> zu einem Pull Request in {repo} von <b>{author}</b>\n{link}",
  "message.pullReview":
    "💬 <b>Neues Review</b> zu einem Pull Request in {repo} von <b>{author}</b>\n{link}",
  "message.newComment": "💬 <b>{author}</b> hat kommentiert: {link}",
  "message.newReview": "💬 <b>{author}</b> hat ein Review geschrieben: {link}",
  "message.newCommits": "🔁 <b>{author}</b> hat neue Commits gepusht: {link}",
  "message.reopened": "🔓 <b>{author}</b> hat wieder geöffnet: {link}",
  "message.readyForReview":
    "👀 <b>{author}</b> hat ihn zum Review freigegeben: {link}",
  "message.newAlarmEntry": "🚨 Neu in diesem Alarm: {link}",
  "message.newAlertEntry": "🛡 Neu in dieser Sicherheitsmeldung: {link}",
  "message.draft":
    "<b>Entwurf einer Antwort</b>, den „Senden“ genau so in deinem Namen postet:\n<blockquote>{draft}</blockquote>",
  "message.reply":
    "<b>Entwurf einer Antwort</b>, den „Senden“ genau so als App des Pagers in der Diskussion postet:\n<blockquote>{draft}</blockquote>",
  "message.otherDraft":
    "🤖 <b>Ein weiterer Entwurf kam</b> für {thing}, aber dein eigener Text bleibt die Antwort. Nur zum Lesen:\n<blockquote>{draft}</blockquote>",
  "message.alarm": "🚨 <b>{repo} braucht dich</b>\n{entries}",
  "message.alert": "🛡 <b>Sicherheit in {repo}</b>\n{entries}",
  "message.advisory":
    "🔐 <b>Sicherheitslücke gemeldet in {repo}</b>\n{link} · Schweregrad: {severity}",
  "message.advisoryDue":
    "📅 Bestätige sie bis {acknowledge} und bewerte sie bis {assess}, wie SECURITY.md verspricht. Was sie sagt, bleibt auf GitHub, bis sie veröffentlicht ist.",
  "message.more": "… und {count} weitere",
  "notes.breaking": "Inkompatible Änderungen",
  "notes.features": "Neue Funktionen",
  "notes.added": "Hinzugefügt",
  "notes.changes": "Änderungen",
  "notes.changed": "Geändert",
  "notes.deprecated": "Veraltet",
  "notes.removed": "Entfernt",
  "notes.fixes": "Fehlerbehebungen",
  "notes.fixed": "Behoben",
  "notes.performance": "Leistung",
  "notes.security": "Sicherheit",
  "notes.reverts": "Zurückgenommen",
  "notes.documentation": "Dokumentation",
  "notes.refactoring": "Umbau des Codes",
  "notes.tests": "Tests",
  "notes.build": "Build-System",
  "notes.ci": "Continuous Integration",
  "notes.miscellaneous": "Sonstiges",
  "notes.style": "Stil",
  "notes.dependencies": "Abhängigkeiten",
  "message.rerunning": "🔁 läuft erneut …",
  "message.workflow": "🔴 <b>{name} scheitert auf {branch} in {repo}</b>",
  "message.jobs": "Gescheitert: {jobs}",
  "message.run": "Der gescheiterte Lauf",
  "message.failedOnce": "Gescheitert am {time}.",
  "message.failedTimes":
    "{count}-mal gescheitert seit dem {since}, zuletzt am {time}.",
  "message.release": "📦 <b>Release {version}</b> von {repo}: {link}",
  "message.breaking":
    "⚠️ <b>Inkompatible Änderungen</b>: lies die Versionshinweise, bevor du mergst.",
  "message.ready": "Alle Checks sind grün, und „Mergen“ veröffentlicht es.",
  "message.published": "✅ Veröffentlicht.",
  "message.back": "⏰ Zurück in {hours} Std.",
  "message.pictures.one":
    "🖼 <b>1 Bild sieht anders aus</b> in {repo} bei {sha}: {link}",
  "message.pictures.many":
    "🖼 <b>{count} Bilder sehen anders aus</b> in {repo} bei {sha}: {link}",
  "message.picturesSame":
    "🖼 <b>Jedes Bild sieht wieder so aus wie committet</b> in {repo} bei {sha}: {link}",
  "message.album": "📸 Das Album unten: {shown} von {count}.",
  "message.noAlbum":
    "📸 Kein Album: Keines davon ist ein PNG oder WebP, das Telegram als Foto zeigt.",
  "message.check": "Alle vorher und nachher",
  "message.checkRed": "Alle vorher und nachher, die Änderungen rot",
  "message.decision": "🤔 <b>Eine Entscheidung für dich</b>\n{question}",
  "message.chosen": "✅ Deine Antwort: <b>{option}</b>",
  "message.ownAnswer": "✅ Deine Antwort, in deinen eigenen Worten:\n{answer}",
  "message.withdrawn":
    "↩️ Dein Agent hat die Frage zurückgenommen: Er wartet nicht mehr auf eine Antwort.",
  "message.report": "🧾 <b>Der Bericht eines Laufs</b>\n{text}",

  "picture.changed": "geändert, {share} seiner Pixel",
  "picture.resized": "andere Größe oder Frames",
  "picture.new": "neu",
  "picture.deleted": "gelöscht",
  "caption.diff": "🔴 Geänderte Pixel: {path}",
  "caption.diffFrame":
    "🔴 Geänderte Pixel, Einzelbild {frame} von {frames}: {path}",
  "caption.diffAnimation":
    "🔴 Geänderte Pixel eines Einzelbilds der Animation: {path}",
  "caption.comparison": "🔍 Vorher und nachher: {path}, {how}",
  "caption.comparisonFrame":
    "🔍 Vorher und nachher, Einzelbild {frame} von {frames}: {path}, {how}",
  "caption.before": "◀️ Vorher: {path}",
  "caption.after": "▶️ Nachher: {path}",
  "caption.new": "🆕 Neu: {path}",
  "caption.deleted": "🗑 Gelöscht: {path}",

  "entry.bot": "Ein Bot scheitert: {title}",
  "entry.preview": "🖼 Lade die neue Social Preview hoch",
  "entry.release": "Das Release scheitert: {name}",
  "entry.check": "{name} scheitert auf {branch}",
  "entry.delivery": "Ein Ereignis von GitHub scheitert: {event}",
  "entry.alert": "{severity}: {what}",
  "entry.alertAt": "{severity}: {what} in {path}",
  "entry.secret": "🔑 {what}",
  "entry.secretAt": "🔑 {what} in {path}",
  "entry.secretPublic": "🔑 {what}, auch öffentlich geleakt",
  "entry.secretPublicAt": "🔑 {what} in {path}, auch öffentlich geleakt",

  "blocker.closed": "er ist nicht offen",
  "blocker.branch": "er ist kein Release-Pull-Request",
  "blocker.fork": "er kommt aus einem Fork",
  "blocker.base": "er geht nicht in {branch}",
  "blocker.title": "sein Titel nennt kein Release",
  "blocker.draft": "er ist ein Entwurf",
  "blocker.checks": "seine Checks sind nicht alle grün ({state})",

  "answer.notInstalled":
    "Die GitHub-App ist auf {repo} nicht installiert, und dieses Repository erledigt das: Installier sie dort, wie docs/setup.md es beschreibt.",
  "chat.notSent":
    "😢 Nicht ans Steuer-Repository gesendet: GitHub lehnt ab: {detail}. Schreib deinen Text noch einmal, sobald das behoben ist.",
  "chat.failed":
    "😢 Der Pager ist an diesem Text gescheitert, und ob er danach gehandelt hat, ist unklar: Sieh nach, ob er es tat, dann schreib ihn noch einmal.",
  "chat.textOnly":
    "Der Pager liest nur Text: Schreib es als Nachricht, oder setz deine Worte unter das Foto oder die Datei.",
  "chat.tooLong":
    "Der Text hat {length} Zeichen; das Steuer-Repository nimmt höchstens {max}. Schick einen kürzeren.",
  "answer.releaseMoved":
    "Das Release hat sich seit dieser Nachricht geändert: Nimm seine neueste Nachricht.",
  "answer.releaseChanged":
    "Das Release hat sich seit dieser Nachricht geändert: Es kommt wieder, sobald seine Checks grün sind.",
  "answer.notMerged": "Nicht gemergt: {why}.",
  "answer.merging": "Wird gemergt.",
  "answer.fixing":
    "Ans Steuer-Repository geschickt: Claude sucht einen Fix, von deinem Wochenlimit.",
  "answer.nothingToFix":
    "Hier gibt es für Claude nichts zu beheben: Kein Eintrag verlinkt eine Seite seines Repositorys.",
  "answer.rerun":
    "Die gescheiterten Jobs laufen erneut: Ein Erfolg nimmt den Eintrag heraus, ein Fehlschlag sagt es.",
  "answer.rerunWorkflow":
    "Die gescheiterten Jobs laufen erneut: Ein Erfolg macht es ✅, ein Fehlschlag sagt es.",
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
  "answer.chosen": "Für deinen Agenten gespeichert: {option}",
  "answer.refused": "GitHub lehnt ab: {detail}",
  "answer.noUserToken":
    "GITHUB_USER_TOKEN ist nicht gesetzt, also kann nichts in deinem Namen handeln: Setz ihn, wie docs/setup.md es beschreibt.",
  "answer.userTokenRefused":
    "GitHub lehnt GITHUB_USER_TOKEN ab: Das Token ist abgelaufen oder wurde widerrufen. Erstell ein neues und setz es mit „npx wrangler secret put GITHUB_USER_TOKEN“, wie docs/setup.md es beschreibt.",
  "answer.unknown": "Diesen Knopf kenne ich nicht.",
  "answer.gone": "Die Sache gibt es nicht mehr.",
  "answer.failed":
    "😢 Der Pager ist an diesem Druck gescheitert, und ob er gehandelt hat, ist unklar: Sieh dir die Sache auf GitHub an, dann drück noch einmal.",

  "note.assistant": "🤖 Der Issue-Assistent antwortet noch einmal.",
  "note.sent": "In deinem Namen gepostet.",
  "note.replied": "In der Diskussion als App des Pagers gepostet.",
  "note.repliedOnGitHub":
    "💬 Du hast auf GitHub geantwortet, also sendet der Pager nichts.",
  "note.answerChosen": "✅ Auf GitHub wurde eine Antwort markiert.",
  "note.closedOnGitHub": "Auf GitHub geschlossen.",
  "note.advisoryDue":
    "⏰ Auf GitHub noch in der Triage: Bestätige sie bis {date}, wie SECURITY.md verspricht.",
  "note.discussionDeleted": "Auf GitHub gelöscht.",
  "note.ownDraft":
    "✏️ Ein neuer Kommentar kam, und dein eigener Text bleibt der Entwurf: Sende ihn, oder bearbeite ihn für den neuen Kommentar.",
  "note.merged": "🔀 Gemergt.",
  "note.closed": "Ohne Merge geschlossen.",
  "note.newCommits": "🔁 Neue Commits von {author}.",
  "note.reopened": "🔓 Wieder geöffnet von {author}.",
  "note.readyForReview": "👀 Bereit zum Review, sagt {author}.",
  "note.albumFailed": "Telegram hat die Bilder abgelehnt: {detail}",
  "note.noAnswer":
    "⌛ Keine Antwort vom Steuer-Repository binnen einer Stunde: Sein Lauf im Actions-Tab sagt, warum.",

  "edit.prompt":
    "✏️ Antworte auf diese Nachricht mit dem neuen Text der Antwort an {thing}. Die Nachricht des Entwurfs zeigt dann deinen Text, und „Senden“ postet ihn genau so.",
  "edit.placeholder": "Antwort",
  "edit.gone": "Den Entwurf gibt es nicht mehr; nichts geändert.",
  "edit.tooLong":
    "Der Text hat {length} Zeichen; eine Antwort hier nimmt höchstens {max}. Schick einen kürzeren mit ✏️ Bearbeiten.",

  "decision.tooLong":
    "Die Antwort hat {length} Zeichen; dein Agent nimmt höchstens {max}. Schreib eine kürzere, oder drück eine Option.",
  "decision.notSaved":
    "😢 Nicht für deinen Agenten gespeichert: GitHub lehnt ab: {detail}. Die Frage bleibt offen: Schreib deine Antwort noch einmal, oder drück eine Option.",

  "chat.help":
    "👋 Das ist dein Pager. Er schreibt nur, wenn etwas dich braucht, eine Nachricht pro Sache, jede in einem eigenen Thema, und ändert diese Nachricht, wenn sich die Sache ändert; eine erledigte Sache bekommt ✅ vor ihr Thema.\n\nDie Knöpfe handeln auf GitHub, aus einer festen Liste. Jeder andere Text geht ans Steuer-Repository, das hier antwortet, und so auch die Worte unter einem Foto oder einer Datei; der Pager liest nur Text, nicht das Bild, die Datei oder eine Sprachnachricht selbst; eine Antwort, die eine Aktion vorschlägt, kommt mit einem Knopf ✅ Bestätigen, und erst dein Druck darauf handelt. Schreib im Thema einer Sache, oder antworte auf ihre Nachricht, um nach ihr zu fragen; ein Thema, das du selbst öffnest, und General beginnen ein eigenes Gespräch. Ein Text im Thema einer offenen Frage deines Agenten ist deine Antwort darauf, in deinen eigenen Worten.\n\nJede Antwort, jeder Entwurf und jeder Fix des Steuer-Repositorys ist ein Lauf von Claude mit deinem Abo: Er zählt auf dein Wochenlimit, und seine Nachricht sagt, wie viel er genommen hat.",
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

  "severity.critical": "kritisch",
  "severity.high": "hoch",
  "severity.medium": "mittel",
  "severity.low": "niedrig",
  "severity.none": "noch nicht eingestuft",

  "proposal.security": "die Sicherheit von {repo}",
  "proposal.notShown":
    "Kein Knopf: Für {label} zeigt der Pager in {repo} nichts ({kind}).",
  "proposal.notOffered": "Kein Knopf: {thing} bietet {label} gerade nicht an.",
  "kind.contribution": "Beitrag",
  "kind.alarm": "Alarm",
  "kind.alert": "Sicherheitsmeldung",
  "kind.release": "Release",

  "topic.contribution": "🙋 {repo}#{number} {title}",
  "topic.discussion": "💬 {repo}#{number} {title}",
  "topic.alarm": "🚨 {repo} braucht dich",
  "topic.workflow": "🔴 {name} in {repo}",
  "topic.alert": "🛡 Sicherheit in {repo}",
  "topic.advisory": "🔐 Sicherheitslücke gemeldet in {repo}",
  "topic.release": "📦 {repo} {version}",
  "topic.reminder": "🔔 Claude-Token",
  "topic.reminderUser": "🔔 GitHub-Token des Pagers",
  "topic.reminderFix": "🔔 Token für 🛠 Fix starten",
  "topic.pictures": "🖼 {repo}#{number} {title}",
  "topic.decision": "🤔 Entscheidung: {question}",
  "topic.report": "🧾 Lauf",
  "topic.reportTitled": "🧾 Lauf: {title}",
  "topic.done": "✅ {name}",

  "reminder.days.one": "1 Tag",
  "reminder.days.many": "{days} Tagen",
  "reminder.soon":
    "Das Claude-Token in {repo} läuft in {days} ab, am {date}. Erneuere es: Führ „claude setup-token“ aus, dann „gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}“, und ändere CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.",
  "reminder.expired":
    "Das Claude-Token in {repo} ist am {date} abgelaufen. Erneuere es: Führ „claude setup-token“ aus, dann „gh secret set CLAUDE_CODE_OAUTH_TOKEN -R {repo}“, und ändere CLAUDE_TOKEN_EXPIRES in wrangler.jsonc.",
  "reminder.userSoon":
    "Das GitHub-Token des Pagers, GITHUB_USER_TOKEN, läuft in {days} ab, am {date}; dann gehen ✅ Senden und 🤖 Assistent nochmal nicht mehr. Erneuere es: Erzeug es auf https://github.com/settings/personal-access-tokens neu, führ dann „npx wrangler secret put GITHUB_USER_TOKEN“ aus und füg das neue Token ein.",
  "reminder.userExpired":
    "Das GitHub-Token des Pagers, GITHUB_USER_TOKEN, ist am {date} abgelaufen, also schlagen ✅ Senden und 🤖 Assistent nochmal fehl. Erneuere es: Erzeug es auf https://github.com/settings/personal-access-tokens neu, führ dann „npx wrangler secret put GITHUB_USER_TOKEN“ aus und füg das neue Token ein.",
  "reminder.userRefused":
    "GitHub lehnt das Token des Pagers ab, GITHUB_USER_TOKEN: Es ist abgelaufen oder wurde widerrufen, also schlagen ✅ Senden und 🤖 Assistent nochmal fehl. Erstell ein neues auf https://github.com/settings/personal-access-tokens mit den Berechtigungen aus docs/setup.md, dann führ „npx wrangler secret put GITHUB_USER_TOKEN“ aus.",
  "reminder.fixSoon":
    "Das Token PAGER_FIX_TOKEN in {repo} läuft in {days} ab, am {date}; dann öffnet 🛠 Fix starten keinen Pull Request mehr. Erneuere es: Erzeug es auf https://github.com/settings/personal-access-tokens neu, führ dann „gh secret set PAGER_FIX_TOKEN -R {repo}“ aus und füg das neue Token ein.",
  "reminder.fixExpired":
    "Das Token PAGER_FIX_TOKEN in {repo} ist am {date} abgelaufen, also öffnet 🛠 Fix starten keinen Pull Request mehr. Erneuere es: Erzeug es auf https://github.com/settings/personal-access-tokens neu, führ dann „gh secret set PAGER_FIX_TOKEN -R {repo}“ aus und füg das neue Token ein.",
};

export const CATALOGS: Readonly<Record<Language, Catalog>> = { en, de };

/** How each language writes a day of the form 2027-10-07. */
const DATES: Readonly<Record<Language, (day: string) => string>> = {
  en: (day) => day,
  de: (day) => day.split("-").reverse().join("."),
};

/** The word between the day and the hour of a moment in each language. */
const AT: Readonly<Record<Language, string>> = { en: "at", de: "um" };

/** A moment to the minute in UTC, in the words of a language. */
function time(at: number, language: Language): string {
  const moment = new Date(at).toISOString();
  return `${DATES[language](moment.slice(0, 10))} ${AT[language]} ${moment.slice(11, 16)} UTC`;
}

/** The sign between the thousands of a number in each language. */
const THOUSANDS: Readonly<Record<Language, string>> = { en: ",", de: "." };

/** The sign before the decimals of a number in each language. */
const DECIMALS: Readonly<Record<Language, string>> = { en: ".", de: "," };

/**
 * A share as a percentage with two decimals, as the visual check writes it: a
 * change too small for them is "< 0.01 %", and a share of 1 or more is "100 %".
 */
function percent(share: number, decimal: string): string {
  if (share >= 1) {
    return "100 %";
  }
  const text = share < 0.0001 ? "< 0.01" : (share * 100).toFixed(2);
  return `${text.replace(".", decimal)} %`;
}

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
    time: (at: number) => time(at, language),
    number: (value: number) =>
      String(value).replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS[language]),
    percent: (share: number) => percent(share, DECIMALS[language]),
    language,
  }) as Texts;
}

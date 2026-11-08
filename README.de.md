# Dennis Otto Pager

[![CI](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Dennis-Otto/dennis-otto-pager/badge)](https://scorecard.dev/viewer/?uri=github.com/Dennis-Otto/dennis-otto-pager)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16429/badge)](https://www.bestpractices.dev/projects/16429)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/16429/baseline)](https://www.bestpractices.dev/projects/16429)
[![REUSE](https://api.reuse.software/badge/github.com/Dennis-Otto/dennis-otto-pager)](https://api.reuse.software/info/github.com/Dennis-Otto/dennis-otto-pager)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-website-526cfe?logo=materialformkdocs&logoColor=white)](https://dennis-otto.github.io/dennis-otto-pager/)
[![Issues: Triage durch den Issue-Assistenten](https://img.shields.io/badge/issues-triaged%20by%20issue%20assistant-blue)](https://dennis-otto.github.io/issue-assistant/)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Dennis-Otto)

Ein Telegram-Bot auf einem Cloudflare Worker, der seinem Maintainer nur meldet, was ihn in seinen GitHub-Repositorys braucht, und es mit einem Knopf erledigt.

Die Dokumentation steht auf der [Website](https://dennis-otto.github.io/dennis-otto-pager/de/). English: [README.md](README.md).

<sub>💛 Wenn dir Dennis Otto Pager nützt, kannst du [seine Entwicklung unterstützen](https://github.com/sponsors/Dennis-Otto).</sub>

## Was er tut

Der Pager schreibt nur, wenn etwas den Maintainer braucht, nie, um zu sagen, dass alles gut ist:

| Was auf GitHub passiert | Was die Nachricht anbietet |
| --- | --- |
| Jemand anderes als der Maintainer oder ein Bot eröffnet ein Issue oder einen Pull Request | ✍️ **Antwort entwerfen**: ein Entwurf in der Stimme des Maintainers, den ✅ **Senden** genau so postet, wie er angezeigt wird; 🤖 **Assistent nochmal** bei einem Issue |
| Jemand anderes als der Maintainer oder ein Bot kommentiert ein solches Issue oder einen solchen Pull Request | Dieselbe Nachricht, an Ort und Stelle bearbeitet, um den Kommentar zu nennen, und ein Hinweis in ihrem Thema für einige schnelle Kommentare; sobald ihre Antwort gesendet ist, wieder ✍️ **Antwort entwerfen** |
| Jemand anderes als der Maintainer oder ein Bot eröffnet eine Diskussion oder kommentiert eine | Sofort ihr Entwurf einer Antwort, den ✅ **Senden** als App des Pagers postet, im Thread des Kommentars, auf den er antwortet; ✏️ **Bearbeiten** |
| Ein Pflicht-Check schlägt auf `main` fehl, ein Release-Workflow scheitert, oder der Bot-Health-Bot eröffnet ein Issue mit `bot-failure` | 🔁 **Neu starten**, das die gescheiterten Jobs des Laufs erneut startet, für einen kurzen Ausfall von GitHub; 🛠 **Fix starten**, dessen Antwort 🔁 Neu starten mit einem ✅ **Bestätigen** vorschlägt, wenn die Logs einen solchen Ausfall zeigen |
| Ein Code-Scanning-Alarm mit Schweregrad high oder critical erscheint auf `main` | 🛠 **Fix starten** |
| Ein Release-Pull-Request ist grün und aktuell | 🔀 **Mergen**, das das Release veröffentlicht |
| Ein Pull Request des Maintainers oder eines Bots ändert, wie etwas aussieht, wie sein Visual Check findet | Die Bilder, die anders aussehen, vorher und nachher, als ein Album in seinem Thema, höchstens einmal pro Head |
| Das Token von Claude im Steuer-Repository läuft in drei Wochen ab | ✅ **Erneuert** |

Eine Nachricht zeigt, was ihre Sache sagt, sodass du GitHub selten öffnen musst: den Anfang eines Issues, eines Pull Requests, einer Diskussion oder eines Kommentars als eingeklapptes Zitat und die Versionshinweise eines Releases, mit *⚠️ Inkompatible Änderungen* darüber, wenn es etwas bricht, sodass du weißt, was 🔀 **Mergen** veröffentlicht.

Jede Nachricht hat außerdem ✖ **Ignorieren**, und alle außer denen einer Diskussion und von Bildern ⏰ **Später**, das sie nach vier Stunden zurückbringt. Jede Sache bekommt **eine Nachricht**, die der Pager an Ort und Stelle ändert, wenn sich die Sache ändert, etwa *Wird gemergt … → Gemergt → ✅ Veröffentlicht*; was in einem Repository fehlschlägt, wird in einer Nachricht gebündelt, die von selbst wieder grün wird, sobald es behoben ist. Nur eine neue Sache, ein neuer Kommentar zu einer Diskussion, einem Issue oder einem Pull Request, die Antwort auf einen Entwurf oder Fix und das Album eines neueren Heads eines Pull Requests benachrichtigen. Eine Diskussion, ein Issue oder ein Pull Request erledigt sich selbst, sobald du auf GitHub antwortest oder es geschlossen wird, eine Diskussion auch, sobald eine Antwort markiert wird, und ein Text von ✏️ **Bearbeiten** bleibt dein Entwurf, was das Steuer-Repository auch später entwirft.

Ein Ereignis von GitHub, dessen Verarbeitung im Pager scheitert, etwa bei einem kurzen Ausfall von Telegram, geht nicht verloren: GitHub stellt es von sich aus nie noch einmal zu, also lässt der Zeitplan es noch einmal zustellen, drei Versuche insgesamt, und ein Ereignis, dessen Versuche alle scheitern, wird ein Eintrag im Alarm des Steuer-Repositorys, *Ein Ereignis von GitHub scheitert: pull_request.opened*, verlinkt auf die letzten Zustellungen auf der Seite Advanced der App. Jedes Signal ändert nichts, wenn es zweimal kommt, und ein spätes Ereignis, das ein neueres seiner Art im selben Repository überholt hat, etwa ein gescheiterter Lauf vor einem gelungenen Neustart, kommt nicht noch einmal, also bringt eine zweite Zustellung keinen älteren Zustand zurück.

Jeder andere Text an den Bot geht an das private Steuer-Repository, das mit Claude Code und dem eigenen Abo des Maintainers antwortet; eine Antwort auf eine Nachricht fragt nach deren Sache. Eine Antwort, die eine Aktion vorschlägt, etwa das Mergen des Releases, nach dem du gefragt hast, kommt mit einem Knopf ✅ **Bestätigen**, und ohne dessen Druck geschieht nichts. Dein Text bekommt ein 👀, wenn er geht, ein 👍, wenn seine Antwort kommt, und ein 😢, wenn keine kam, und jede Antwort, jeder Entwurf und jeder Fix endet mit einer Zeile zu seinem Lauf von Claude: dem Modell, dem Aufwand und den Tokens, etwa *🧮 Opus 5.5 · Hoch · 48.213 Tokens*.

Auch deine eigenen Agenten fragen über den Pager, etwa ein Orchestrator, der die Nacht über mit `gh` auf deinem PC arbeitet: Eine **Frage** kommt in einem eigenen Thema, etwa *🤔 Entscheidung: Welches Release zuerst?*, mit ihren zwei bis vier Optionen als Knöpfen, und dein Druck speichert die Antwort im privaten Steuer-Repository, wo der Agent sie mit `gh` liest, ohne ein eigenes Geheimnis. Passt keine Option, ist ein Text in ihrem Thema deine Antwort in deinen eigenen Worten, und ein Agent, der keine Antwort mehr braucht, nimmt seine Frage zurück, sodass ihre Knöpfe verschwinden. Auch der **Bericht eines Laufs** kommt in einem eigenen Thema, etwa *🧾 Lauf: Nachtlauf*. [So arbeitet er](docs/how-it-works.de.md#fragen-und-berichte-deiner-agenten) hat die Befehle.

Sind die Threads von Telegram für den Bot an, **bekommt jede Sache ein eigenes Thema**, etwa *🚨 repo-blueprint braucht dich* oder *📦 repo-blueprint 1.11.1*: Ihre Nachricht mit den Knöpfen kommt zuerst, und ihre Entwürfe, die Antwort von 🛠 **Fix starten**, die Rückfrage von ✏️ **Bearbeiten** und die Antworten auf das, was du darin fragst, folgen dort. Eine Frage im Thema einer Sache geht mit dieser Sache an das Steuer-Repository, so genügt *warum?*. Eine erledigte Sache bekommt ein ✅ vor ihr Thema, das als ihre Geschichte bleibt, und die Liste der Themen ist die Übersicht. Ein Thema, das du selbst öffnest, und General beginnen ein eigenes Gespräch, und jede Antwort bleibt im Thread des Textes, auf den sie antwortet. Ohne Themen bleibt alles in der Hauptansicht, wie bisher.

Der Pager spricht Deutsch oder Englisch: `LANGUAGE` in `wrangler.jsonc` entscheidet, `de` für diesen Pager, Englisch, wenn es leer ist. Jeder Text, den er schickt, folgt ihr, die Knöpfe und `/help` eingeschlossen, und ebenso die Antworten des Steuer-Repositorys; ein Antwortentwurf bleibt in der Sprache seines Issues oder Pull Requests, und was von GitHub kommt, etwa ein Titel, bleibt, wie es ist. Diese Seite nennt die Knöpfe, wie sie mit `de` heißen.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/diagrams/how-the-pager-works.de.dark.svg">
  <img src="docs/images/diagrams/how-the-pager-works.de.svg" alt="So arbeitet der Pager: GitHub schickt die Ereignisse der GitHub-App an den Worker auf Cloudflare, signiert mit dem Geheimnis ihres Webhooks. Die Regeln entscheiden, was Dennis braucht; alles andere endet dort. Was zählt, wird eine Nachricht in Telegram, die sich an Ort und Stelle ändert, mit Knöpfen. Ein Knopf führt eine Aktion der Positivliste auf GitHub aus, etwa das Mergen eines grünen Releases. Entwürfe, Fixes und freier Text gehen an den Workflow des privaten Steuer-Repositorys, der Claude Code mit Dennis' Abo ausführt und seine Antwort signiert zurückschickt, als Entwurf, Notiz oder Vorschlag, die ein Knopf freigeben muss.">
</picture>

[So arbeitet er](docs/how-it-works.de.md) zählt die Regeln, die Knöpfe und das auf, was das Steuer-Repository zurückschickt.

## Sicherheit und Datenschutz

- **Nur der Maintainer:** Der Worker bedient nur den Chat, dessen ID `TELEGRAM_CHAT_ID` nennt, und nur dessen Nutzer; jede Anfrage beweist zuerst, woher sie kommt: der geheime Header von Telegram, die HMAC-Signatur von GitHub, die Signatur des Steuer-Repositorys mit ihrer Zeit.
- **Knöpfe statt Befehle:** Ein Knopf führt eine Aktion einer festen Positivliste aus, und nur, solange seine Sache sie noch anbietet; ein Merge prüft erneut, dass das Release an dem Stand grün ist, den die Nachricht zeigte. Was ein Issue oder ein Pull Request sagt, sind Daten: Es wird angezeigt, maskiert, und nie ausgeführt.
- **Geringste Rechte:** Die GitHub-App verlangt, was der Pager nutzt, und nichts sonst, und jedes ihrer Tokens gilt für ein Repository und die Rechte eines Aufrufs. Zwei Dinge handeln im Namen des Maintainers, mit seinem eigenen Token: eine Antwort auf ein Issue oder einen Pull Request, die er mit ✅ **Senden** freigegeben hat, und der Issue-Assistent über seine Ein-Kommentar-Regel hinaus; eine Antwort in einer Diskussion geht als App.
- **Kein Geheimnis im Repository oder in den Logs:** Die Geheimnisse liegen in Cloudflare, der Zustand in Workers KV enthält kein Geheimnis, und die Logs nennen die Antworten der APIs, nie ein Token oder den Text eines Issues.
- **Telegram ist bei Chats mit einem Bot nicht Ende-zu-Ende-verschlüsselt:** Telegram kann die Nachrichten lesen, die Titel von Issues und Antwortentwürfe zeigen. Freier Text und Entwürfe laufen nur im **privaten** Steuer-Repository, mit Claude Code und dem eigenen Abo des Maintainers, weil die Logs von Actions in einem öffentlichen Repository öffentlich sind.

## Einrichten

Der Pager läuft mit den kostenlosen Tarifen von Cloudflare und Telegram. [Einrichten](docs/setup.de.md) geht jeden Schritt in seiner Reihenfolge durch: der Bot bei @BotFather, der Worker auf Cloudflare, die GitHub-App aus ihrem Manifest, die Geheimnisse und der Webhook von Telegram. Auf deinem Rechner läuft er unter <http://localhost:8787>, mit den Geheimnissen aus `.dev.vars` (siehe `.dev.vars.example`):

```sh
npm ci --ignore-scripts
npm run dev
```

## Entwicklung

Jede Änderung kommt über einen Pull Request, dessen Titel den [Conventional Commits](https://www.conventionalcommits.org/) folgt, mit Commits, die abgezeichnet (`git commit -s`) und signiert (`git commit -S`) sind. Die Prüfungen der CI laufen lokal mit

```sh
bash scripts/check.sh
```

Die Tests laufen in workerd, der Laufzeit von Cloudflare, gegen ein simuliertes Telegram und GitHub, mit jeder Zeile und jedem Zweig abgedeckt. [CONTRIBUTING.md](CONTRIBUTING.md) erklärt die Einrichtung und die Regeln, [die Architektur](docs/architecture.md) die Module des Workers und den Weg einer Anfrage durch sie, und [die Roadmap](docs/roadmap.de.md), was der Pager in den nächsten zwölf Monaten vorhat und was nicht.

## Releases

Der Release-Bot hält einen Pull Request für das nächste Release offen, mit der Version und dem Changelog aus den gemergten Pull Requests. Sein Merge veröffentlicht das Release, mit SBOM und signierter Provenienz, und Cloudflare stellt es bereit, wie [docs/releases.md](docs/releases.md) beschreibt; [CHANGELOG.md](CHANGELOG.md) listet jede Änderung.

## Hilfe und Sicherheit

Fragen und Probleme: siehe [SUPPORT.md](SUPPORT.md). Sicherheitslücken bitte vertraulich melden, wie [SECURITY.md](SECURITY.md) beschreibt.

## Lizenz

MIT; siehe [LICENSE](LICENSE). Jede Datei nennt ihre Lizenz in der maschinenlesbaren Form von [REUSE](https://reuse.software).

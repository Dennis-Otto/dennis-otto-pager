# Dennis Otto Pager

[![CI](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Dennis-Otto/dennis-otto-pager/badge)](https://scorecard.dev/viewer/?uri=github.com/Dennis-Otto/dennis-otto-pager)
[![REUSE](https://api.reuse.software/badge/github.com/Dennis-Otto/dennis-otto-pager)](https://api.reuse.software/info/github.com/Dennis-Otto/dennis-otto-pager)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-website-526cfe?logo=materialformkdocs&logoColor=white)](https://dennis-otto.github.io/dennis-otto-pager/)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Dennis-Otto)

Ein Telegram-Bot auf einem Cloudflare Worker, der seinem Maintainer nur meldet, was ihn in seinen GitHub-Repositorys braucht, und es mit einem Knopf erledigt.

Die Dokumentation steht auf der [Website](https://dennis-otto.github.io/dennis-otto-pager/de/). English: [README.md](README.md).

<sub>💛 Wenn dir Dennis Otto Pager nützt, kannst du [seine Entwicklung unterstützen](https://github.com/sponsors/Dennis-Otto).</sub>

## Was er tut

Der Pager schreibt nur, wenn etwas den Maintainer braucht, nie, um zu sagen, dass alles gut ist:

| Was auf GitHub passiert | Was die Nachricht anbietet |
| --- | --- |
| Jemand anderes als der Maintainer oder ein Bot eröffnet ein Issue oder einen Pull Request | ✍️ **Antwort entwerfen**: ein Entwurf in der Stimme des Maintainers, den ✅ **Senden** genau so postet, wie er angezeigt wird; 🤖 **Assistent nochmal** bei einem Issue |
| Ein Pflicht-Check schlägt auf `main` fehl, ein Release-Workflow scheitert, oder der Bot-Health-Bot eröffnet ein Issue mit `bot-failure` | 🛠 **Fix starten** |
| Ein Code-Scanning-Alarm mit Schweregrad high oder critical erscheint auf `main` | 🛠 **Fix starten** |
| Ein Release-Pull-Request ist grün und aktuell | 🔀 **Mergen**, das das Release veröffentlicht |
| Das Token von Claude im Steuer-Repository läuft in drei Wochen ab | ✅ **Erneuert** |

Jede Nachricht hat außerdem ⏰ **Später**, das sie nach vier Stunden zurückbringt, und ✖ **Ignorieren**. Jede Sache bekommt **eine Nachricht**, die der Pager an Ort und Stelle ändert, wenn sich die Sache ändert, etwa *Wird gemergt … → Gemergt → ✅ Veröffentlicht*; was in einem Repository fehlschlägt, wird in einer Nachricht gebündelt, die von selbst wieder grün wird, sobald es behoben ist. Nur eine neue Sache benachrichtigt.

Jeder andere Text an den Bot geht an das private Steuer-Repository, das mit Claude Code und dem eigenen Abo des Maintainers antwortet; eine Antwort auf eine Nachricht fragt nach deren Sache. Eine Antwort, die eine Aktion vorschlägt, etwa das Mergen des Releases, nach dem du gefragt hast, kommt mit einem Knopf ✅ **Bestätigen**, und ohne dessen Druck geschieht nichts. Jede Antwort, jeder Entwurf und jeder Fix zeigt, was sein Lauf von Claude vom Wochenlimit genommen hat.

Der Pager spricht Deutsch oder Englisch: `LANGUAGE` in `wrangler.jsonc` entscheidet, `de` für diesen Pager, Englisch, wenn es leer ist. Jeder Text, den er schickt, folgt ihr, die Knöpfe und `/help` eingeschlossen, und ebenso die Antworten des Steuer-Repositorys; ein Antwortentwurf bleibt in der Sprache seines Issues oder Pull Requests, und was von GitHub kommt, etwa ein Titel, bleibt, wie es ist. Diese Seite nennt die Knöpfe, wie sie mit `de` heißen.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/diagrams/how-the-pager-works.de.dark.svg">
  <img src="docs/images/diagrams/how-the-pager-works.de.svg" alt="So arbeitet der Pager: GitHub schickt die Ereignisse der GitHub-App an den Worker auf Cloudflare, signiert mit dem Geheimnis ihres Webhooks. Die Regeln entscheiden, was Dennis braucht; alles andere endet dort. Was zählt, wird eine Nachricht in Telegram, die sich an Ort und Stelle ändert, mit Knöpfen. Ein Knopf führt eine Aktion der Positivliste auf GitHub aus, etwa das Mergen eines grünen Releases. Entwürfe, Fixes und freier Text gehen an den Workflow des privaten Steuer-Repositorys, der Claude Code mit Dennis' Abo ausführt und seine Antwort signiert zurückschickt, als Entwurf, Notiz oder Vorschlag, die ein Knopf freigeben muss.">
</picture>

[So arbeitet er](docs/how-it-works.de.md) zählt die Regeln, die Knöpfe und das auf, was das Steuer-Repository zurückschickt.

## Sicherheit und Datenschutz

- **Nur der Maintainer:** Der Worker bedient nur den Chat, dessen ID `TELEGRAM_CHAT_ID` nennt, und nur dessen Nutzer; jede Anfrage beweist zuerst, woher sie kommt: der geheime Header von Telegram, die HMAC-Signatur von GitHub, die Signatur des Steuer-Repositorys mit ihrer Zeit.
- **Knöpfe statt Befehle:** Ein Knopf führt eine Aktion einer festen Positivliste aus, und nur, solange seine Sache sie noch anbietet; ein Merge prüft erneut, dass das Release an dem Stand grün ist, den die Nachricht zeigte. Was ein Issue oder ein Pull Request sagt, sind Daten: Es wird angezeigt, maskiert, und nie ausgeführt.
- **Geringste Rechte:** Die GitHub-App verlangt, was der Pager nutzt, und nichts sonst, und jedes ihrer Tokens gilt für ein Repository und die Rechte eines Aufrufs. Zwei Dinge handeln im Namen des Maintainers, mit seinem eigenen Token: eine Antwort, die er mit ✅ **Senden** freigegeben hat, und der Issue-Assistent über seine Ein-Kommentar-Regel hinaus.
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

Die Tests laufen in workerd, der Laufzeit von Cloudflare, gegen ein simuliertes Telegram und GitHub, mit jeder Zeile und jedem Zweig abgedeckt. [CONTRIBUTING.md](CONTRIBUTING.md) erklärt die Einrichtung und die Regeln.

## Releases

Der Release-Bot hält einen Pull Request für das nächste Release offen, mit der Version und dem Changelog aus den gemergten Pull Requests. Sein Merge veröffentlicht das Release, mit SBOM und signierter Provenienz, und Cloudflare stellt es bereit, wie [docs/releases.md](docs/releases.md) beschreibt; [CHANGELOG.md](CHANGELOG.md) listet jede Änderung.

## Hilfe und Sicherheit

Fragen und Probleme: siehe [SUPPORT.md](SUPPORT.md). Sicherheitslücken bitte vertraulich melden, wie [SECURITY.md](SECURITY.md) beschreibt.

## Lizenz

MIT; siehe [LICENSE](LICENSE). Jede Datei nennt ihre Lizenz in der maschinenlesbaren Form von [REUSE](https://reuse.software).

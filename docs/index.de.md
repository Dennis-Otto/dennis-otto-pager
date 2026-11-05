# Dennis Otto Pager

Ein Telegram-Bot auf einem Cloudflare Worker, der seinem Maintainer nur meldet, was ihn in seinen GitHub-Repositorys braucht, und es mit einem Knopf erledigt.

Der Pager schreibt nur, wenn etwas den Maintainer braucht, nie, um zu sagen, dass alles gut ist: ein Beitrag von außen, ein fehlschlagendes `main`, ein scheiterndes Release, ein Code-Scanning-Alarm mit Schweregrad high oder critical, ein grüner Release-Pull-Request und das Token von Claude im Steuer-Repository, bevor es abläuft. Jede Sache bekommt **eine Nachricht** mit ihren Knöpfen, in einem eigenen Thema, sobald der Threaded Mode für den Bot an ist, die der Pager an Ort und Stelle ändert, wenn sich die Sache ändert; was in einem Repository fehlschlägt, wird gebündelt, und nur eine neue Sache und die Antwort auf einen Entwurf oder Fix, den du gestartet hast, benachrichtigen. Eine Frage im Thema einer Sache geht mit dieser Sache an das Steuer-Repository, und eine erledigte Sache bekommt ein ✅ vor ihr Thema.

| Knopf | Was er tut |
| --- | --- |
| 🔀 Mergen | Merged einen grünen Release-Pull-Request, was das Release veröffentlicht |
| ✍️ Antwort entwerfen, ✅ Senden, ✏️ Bearbeiten | Eine Antwort in der Stimme des Maintainers aus dem privaten Steuer-Repository, gepostet genau so, wie sie angezeigt wird |
| 🤖 Assistent nochmal | Lässt den Issue-Assistenten ein Issue noch einmal beantworten, über seine Ein-Kommentar-Regel hinaus |
| 🛠 Fix starten | Schickt, was fehlschlägt, an das Steuer-Repository, das einen Fix vorbereitet |
| ✅ Bestätigen | Führt die eine Aktion aus, die eine Antwort auf deinen Text vorschlägt, etwa ein Merge, solange ihre Sache sie noch anbietet |
| ⏰ Später, ✖ Ignorieren | Bringt die Sache nach vier Stunden zurück oder schließt sie |

Der Pager spricht Deutsch oder Englisch, wie `LANGUAGE` in `wrangler.jsonc` sagt: `de` für diesen Pager, Englisch, wenn es leer ist. Die Knöpfe, `/help` und jeder andere Text, den er schickt, folgen ihr, und ebenso die Antworten des Steuer-Repositorys.

- [So arbeitet er](how-it-works.md): die Regeln dessen, was zählt, die Knöpfe, das Steuer-Repository und der Zustand.
- [Einrichten](setup.md): der Bot, der Worker, die GitHub-App, die Geheimnisse und der Webhook, Schritt für Schritt.
- [Releases and Cloudflare](releases.md): wie ein Release live geht.
- [Security design](security.md): die Sicherheit des Repositorys und seiner Releases.

Telegram verschlüsselt Chats mit einem Bot nicht Ende-zu-Ende: Telegram kann die Nachrichten lesen, die Titel von Issues und Antwortentwürfe zeigen. Freier Text und Entwürfe laufen nur im privaten Steuer-Repository, mit Claude Code und dem eigenen Abo des Maintainers.

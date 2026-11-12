# Roadmap

[← README](https://github.com/Dennis-Otto/repo-pager/blob/main/README.de.md) · [So arbeitet er](how-it-works.md) · [Architecture](architecture.md) · [Security design](security.md)

Was der Pager in den nächsten zwölf Monaten vorhat, bis November 2027, und was er nicht tun wird. Das ist eine Richtung, kein Versprechen: Was seinem Maintainer im Alltag fehlt, bestimmt die Reihenfolge. Ideen sind als [Feature Requests](https://github.com/Dennis-Otto/repo-pager/issues/new?template=feature_request.yml) oder in den [Diskussionen](https://github.com/Dennis-Otto/repo-pager/discussions) willkommen.

## Die nächsten zwölf Monate

Der Pager tut, wofür er gebaut ist: Er meldet seinem Maintainer nur, was ihn braucht, mit einer Nachricht und ihren Knöpfen je Sache. Im kommenden Jahr geht es darum, dass das so bleibt und jede Nachricht ihre Benachrichtigung wert ist:

- **Was meldet und was nicht.** Der Pager kümmert sich um die Repositorys, in denen sein Maintainer seine GitHub-App installiert hat, den [Repository-Blueprint](https://github.com/Dennis-Otto/repo-blueprint) und die Projekte daraus. Ein Ereignis, das melden sollte und es nicht tut, oder eines, das meldet und es nicht sollte, kommt zuerst, mit einem Test in `test/rules.test.ts`, der es richtig hält.
- **Weniger Schritte für das, was sich wiederholt.** Ein nächster Schritt, den die Antworten des Steuer-Repositorys immer wieder vorschlagen, kann ein eigener Knopf der Positivliste werden, wie 🔁 **Neu starten** einer wurde. Ein Knopf handelt weiterhin nur, solange seine Sache ihn anbietet, und Claude schlägt weiterhin nur vor ([Entscheidung 0002](decisions/0002-buttons-of-an-allowlist-act-and-claude-only-proposes.md)).
- **Änderungen von Telegram, GitHub und Cloudflare.** Neue Versionen der Bot API von Telegram, der Webhooks und APIs von GitHub und der Laufzeit von Cloudflare, mit ihrem Kompatibilitätsdatum, übernimmt der Pager, sobald die Tests in workerd mit ihnen bestehen.
- **Die kostenlosen Tarife.** Der Pager bleibt in den kostenlosen Tarifen von Cloudflare und Telegram: ein Schreibvorgang in Workers KV je Änderung einer Sache und ein Lauf des Zeitplans alle 15 Minuten.
- **Fehlerbehebungen und Sicherheit** gehen allem Neuen vor; [SECURITY.md](https://github.com/Dennis-Otto/repo-pager/blob/main/SECURITY.md) nennt die Fristen. Die Update-Bots und der [Repository-Blueprint](https://github.com/Dennis-Otto/repo-blueprint) halten die Werkzeuge, die Workflows und die Prüfungen aktuell.

## Ideen

Noch ohne Termin; eine Diskussion ist der Ort, um zu sagen, dass dir eine wichtig ist.

- **Die Steuerung eines Laufs deiner Agenten.** Ein Agent fragt seine Entscheidungen heute über den Pager und liest die Antwort aus einem Branch des Steuer-Repositorys ([Entscheidung 0008](decisions/0008-an-agent-reads-its-answer-from-a-branch-of-the-control-repository.md)), und ein Lauf schickt seinen Bericht. Der Pager könnte einen langen Lauf auch zeigen, während er läuft, und ihn mit einem Knopf anhalten oder beenden.
- **Claude Code Channels.** Ein Channel schickt Nachrichten in eine laufende Sitzung von Claude Code. Der Pager könnte einer werden, sodass ein Text im Thema einer Sache eine Sitzung auf dem Rechner des Maintainers direkt erreicht und nicht nur den Workflow des Steuer-Repositorys.
- **Ein Team einer Organisation.** Der Pager beobachtet die Repositorys einer Organisation mit `OWNERS`, doch nur `MAINTAINER_LOGIN` ist sein Maintainer, also meldet er, was die anderen Mitglieder eröffnen, als Beitrag. Er könnte die Mitglieder eines Teams als seine eigenen nehmen und ein Token je Besitzer halten, damit ✅ **Senden** in den Repositorys von jedem handelt.
- **Mehr Sprachen.** Der Pager spricht Englisch und Deutsch, aus einem Katalog je Sprache in `src/texts.ts`. Eine weitere Sprache ist ein Katalog mit denselben Schlüsseln, Platzhaltern und Emojis, die der Compiler und `test/texts.test.ts` prüfen ([Entscheidung 0004](decisions/0004-one-language-per-pager-from-a-catalog.md)).

## Erledigt

Die größeren Arbeiten der bisherigen Releases; der [Changelog](https://github.com/Dennis-Otto/repo-pager/blob/main/CHANGELOG.md) nennt jede Änderung.

- **Eine Nachricht je Sache, mit Knöpfen** (0.1.0): ein Beitrag von außen, eine Prüfung oder ein Release, die auf `main` fehlschlagen, eine Warnung des Code Scannings, ein grüner Release-Pull-Request und das Token von Claude, bevor es abläuft, jeweils mit einem Knopf der Positivliste erledigt.
- **Entwürfe, Fixes und freier Text im privaten Steuer-Repository** (0.1.0), mit Claude Code und dem eigenen Abo des Maintainers, und die Zeile unter jeder Antwort, die ihr Modell, ihren Aufwand und ihre Tokens nennt (0.2.0).
- **Ein Thema je Sache** (0.3.0), sobald der Threaded Mode für den Bot an ist, das mit ✅ bleibt, wenn die Sache erledigt ist.
- **🔁 Neu starten** (0.4.0) für einen Lauf, der auf `main` fehlschlug, den auch 🛠 **Fix starten** vorschlägt, wenn die Logs einen Ausfall von GitHub zeigen (0.5.0).
- **Diskussionen** (0.5.0), mit einem Antwortentwurf sofort, gepostet als die App.
- **Die Bilder einer sichtbaren Änderung** (0.5.0), vorher und nachher, als ein Album im Thema des Pull Requests.
- **Entscheidungen deiner Agenten als Knöpfe** (0.5.0), und der Bericht eines Laufs.

## Nicht geplant

- **Mehr als eine Person.** Der Pager bedient den privaten Chat seines Maintainers und nur dessen Nutzer; jedes andere Update verwirft er ohne Antwort. Ein anderer Maintainer betreibt einen eigenen Pager, wie [Einrichten](setup.md) beschreibt.
- **Befehle, die handeln.** Ein Text führt auf GitHub nie etwas von selbst aus: Eine Aktion braucht einen Knopf der Positivliste, den eine Antwort von Claude nur vorschlagen kann.
- **Claude im öffentlichen Repository, oder ein Schlüssel der API.** Entwürfe, Fixes und freier Text laufen nur im privaten Steuer-Repository, mit dem Abo des Maintainers, weil die Logs von Actions in einem öffentlichen Repository öffentlich sind.
- **Nachrichten, dass alles gut ist.** Der Pager schreibt nur, wenn etwas seinen Maintainer braucht; das [Dashboard des Blueprints](https://dennis-otto.github.io/repo-blueprint/dashboard/) zeigt den Stand jedes Repositorys.
- **Ein anderer Messenger.** Der Pager ist ein Bot von Telegram, dessen Bot API kostenlos ist und die Knöpfe, die Themen und die Reaktionen bietet, die er braucht.

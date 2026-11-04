# So arbeitet er

Der Pager ist ein Cloudflare Worker mit drei Türen und einem Zeitplan: `/github` für die Ereignisse der GitHub-App, `/telegram` für die Updates des Bots, `/control` für die Antworten des privaten Steuer-Repositorys, und ein Lauf alle 15 Minuten. Jede Anfrage beweist, woher sie kommt, bevor irgendetwas anderes läuft.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/how-the-pager-works.de.dark.svg">
  <img src="images/diagrams/how-the-pager-works.de.svg" alt="So arbeitet der Pager: GitHub schickt die Ereignisse der GitHub-App an den Worker auf Cloudflare, signiert mit dem Geheimnis ihres Webhooks. Die Regeln entscheiden, was Dennis braucht; alles andere endet dort. Was zählt, wird eine Nachricht in Telegram, die sich an Ort und Stelle ändert, mit Knöpfen. Ein Knopf führt eine Aktion der Positivliste auf GitHub aus, etwa das Mergen eines grünen Releases. Entwürfe, Fixes und freier Text gehen an den Workflow des privaten Steuer-Repositorys, der Claude Code mit Dennis' Abo ausführt und seine Antwort signiert zurückschickt, als Entwurf, Notiz oder Vorschlag, die ein Knopf freigeben muss.">
</picture>

## Was zählt

`src/rules.ts` ist die eine Stelle, die entscheidet; ihre Tests gehen jede Regel durch. Ein Ereignis aus einem Repository eines anderen Besitzers oder einer Art, die hier nicht steht, endet ohne Nachricht.

| Ereignis | Zählt, wenn | Wird zu |
| --- | --- | --- |
| `issues` opened, `pull_request` opened | Der Autor ist weder der Maintainer (`MAINTAINER_LOGIN`) noch ein Bot | Ein Beitrag, je eine Nachricht |
| `check_run` completed auf dem Standard-Branch | Die Rulesets des Branches verlangen den Check, und er ist fehlgeschlagen, abgelaufen oder nicht gestartet | Ein Eintrag im Alarm des Repositorys; ein Erfolg desselben Checks nimmt ihn heraus |
| `workflow_run` completed | `release.yml`, `build-release.yml` oder `verify-release.yml` ist gescheitert, außerhalb eines Pull Requests | Ein Eintrag im Alarm; ein Erfolg nimmt ihn heraus |
| `issues` opened von einem Bot | Es trägt das Label `bot-failure` des Bot-Health-Bots | Ein Eintrag im Alarm; sein Schließen nimmt ihn heraus |
| `code_scanning_alert` created oder reopened auf dem Standard-Branch | Der Schweregrad ist high oder critical | Ein Eintrag in der Code-Scanning-Nachricht des Repositorys; behoben oder verworfen nimmt ihn heraus |
| `check_suite` completed auf einem Branch von release-please | GitHub nennt den Pull Request clean: offen, kein Entwurf, in den Standard-Branch, jeder Pflicht-Check grün und aktuell | Die Release-Nachricht mit 🔀 **Mergen** |
| `pull_request` synchronize, closed und merged; `release` published | Es ist das Release, das die Nachricht zeigt | Dieselbe Nachricht: *aktualisiert*, *gemergt*, *✅ veröffentlicht* |

Ein Bündel, dessen letzter Eintrag verschwunden ist, wird von selbst grün, und ein neuer Fehler danach öffnet eine neue Nachricht, die benachrichtigt.

## Die Knöpfe

`src/buttons.ts` ist die Positivliste: Jede Art von Sache bietet diese Knöpfe in diesen Zuständen an, und ein Druck wirkt nur, wenn die Sache, so wie sie zur Zeit des Drucks ist, ihn noch anbietet.

| Sache | Zustand | Knöpfe |
| --- | --- | --- |
| Beitrag | new | ✍️ Antwort entwerfen, 🤖 Assistent nochmal (nur Issues), ⏰ Später, ✖ Ignorieren |
| Beitrag | drafting | ⏰ Später, ✖ Ignorieren |
| Beitrag | draft | ✅ Senden, ✏️ Bearbeiten, ⏰ Später, ✖ Ignorieren |
| Alarm, Code Scanning | open | 🛠 Fix starten, ⏰ Später, ✖ Ignorieren |
| Alarm, Code Scanning | fixing | ⏰ Später, ✖ Ignorieren |
| Release | ready | 🔀 Mergen, ⏰ Später, ✖ Ignorieren |
| Erinnerung | open | ✅ Erneuert, ⏰ Später |

- **🔀 Mergen** fragt GitHub erneut nach dem Pull Request und merged ihn per Squash nur an dem Stand, den die Nachricht zeigte, solange er noch clean ist; ein geändertes Release wartet wieder auf seine Checks.
- **✅ Senden** postet den Entwurf, dessen Version sein Knopf trägt, genau so, wie die Nachricht ihn zeigte; ein älterer Knopf derselben Sache lehnt ab. **✏️ Bearbeiten** bittet um den neuen Text als Antwort auf seine Rückfrage und zeigt ihn als nächsten Entwurf.
- **🤖 Assistent nochmal** startet den Workflow `issue-assistant.yml` des Repositorys auf dem Issue mit `override`, im Namen des Maintainers. Ein Repository, dessen Issue-Assistent den Override noch nicht kennt, antwortet mit 422, und der Knopf sagt das.
- **✍️ Antwort entwerfen** und **🛠 Fix starten** schicken die Sache an das Steuer-Repository, dessen Antwort wie unten beschrieben zurückkommt. Jeder ist ein Lauf von Claude mit dem Abo des Maintainers, der auf dessen Wochenlimit zählt, und die Antwort nennt sein Modell, seinen Aufwand und seine Tokens; ein Job, der fehlschlägt, bringt seinen Knopf zurück.
- **⏰ Später** bringt die Sache nach `LATER_HOURS` als neue Nachricht zurück; **✖ Ignorieren** schließt sie.

## Das Steuer-Repository

Der Workflow des privaten Repositorys `Dennis-Otto/dennis-otto-pager-control` führt Claude Code mit dem eigenen Abo des Maintainers aus; seine README beschreibt seine Jobs, seine Sicherheit und seine Einrichtung. Der Pager schickt ihm einen [Repository Dispatch](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event), mit einem Token der App nur für dieses Repository:

| Ereignistyp | Gesendet von | Client Payload |
| --- | --- | --- |
| `pager-draft` | ✍️ Antwort entwerfen | `item`, `repo`, `number`, `pull`, `language` |
| `pager-fix` | 🛠 Fix starten | `item`, `repo`, `kind` (`alarm` oder `alert`), `entries` mit `label` und `url`, `language` |
| `pager-text` | Ein Text, der auf keine Rückfrage antwortet | `text`, `message` (seine ID im Chat) und `reply`: die ersten 1000 Zeichen der Nachricht, auf die der Text antwortet, falls es eine gibt; `language` |

`language` ist `LANGUAGE` des Workers, `en` oder `de`: Darin antwortet das Steuer-Repository dem Maintainer, die Notiz eines Fixes und der Grund eines gescheiterten Jobs eingeschlossen, während ein Antwortentwurf in der Sprache seines Issues oder Pull Requests bleibt.

Ein Text als Antwort auf eine Nachricht des Pagers handelt von ihrer Sache: *merge it*, als Antwort auf die Nachricht eines Releases, meint dieses Release. Der Pager schickt keinen Text eines Issues: Der Workflow liest ihn selbst von GitHub, als Daten. Er antwortet mit einem `POST` an `/control`:

- dem Header `X-Pager-Timestamp`, der Zeit in Sekunden seit 1970, die höchstens fünf Minuten abweichen darf;
- dem Header `X-Pager-Signature`, `sha256=` und das HMAC mit SHA-256, unter `CONTROL_SECRET`, über den Zeitstempel, einen Punkt und den Body;
- einem Body aus JSON, einem der unten genannten.

Der Body ist eines von:

- `{"type": "draft", "item": "<id>", "text": "<Antwort>"}`: der Entwurf einer Antwort auf einen Beitrag, höchstens 3000 Zeichen, gezeigt als neue Nachricht mit ✅ Senden;
- `{"type": "note", "item": "<id>", "text": "<Notiz>"}`: eine Notiz unter einer Sache, etwa der Pull Request eines Fixes;
- `{"type": "note", "text": "<Antwort>"}`: eine eigene Nachricht, etwa die Antwort auf freien Text;
- `{"type": "proposal", "text": "<Antwort>", "action": "<Aktion>", "target": {"kind": "<Art>", "repo": "<owner/name>", "number": <Nummer>}}`: eine Antwort auf freien Text, die eine Aktion vorschlägt, als eigene Nachricht mit einem einzigen Knopf ✅ Bestätigen;
- `{"type": "failed", "item": "<id>", "text": "<Grund>"}`: ein Entwurf oder ein Fix, der nicht zustande kam, etwa weil das Wochenlimit erreicht ist. Die Sache kehrt in den Zustand vor ihrem Knopf zurück, mit dem Grund als Notiz, in einer neuen Nachricht, damit der Knopf erneut laufen kann;
- `{"type": "failed", "text": "<Grund>"}`: freier Text, dessen Antwort nicht zustande kam, gezeigt als eigene Nachricht.

Eine Antwort auf freien Text, also eine Notiz oder ein Fehlschlag ohne `item` oder ein Vorschlag, trägt `"message": <ID>`, die `message` ihres `pager-text`. Der Pager macht dann aus dem 👀 auf diesem Text ein 👍, bei einem Fehlschlag ein 😢; ein Job, der von Hand im Actions-Tab startet, hat keinen Text und lässt sie weg. Die Antwort geht in den Thread dieses Textes, wie [der Thread einer Antwort](#der-thread-einer-antwort) sagt.

Jeder Body kann tragen, was der Lauf von Claude vom Wochenlimit des Abos genommen hat:

```json
"usage": {
  "turns": 4,
  "seconds": 52,
  "effort": "high",
  "models": [{"model": "claude-opus-5-5", "tokens": 48213}]
}
```

`effort` ist das `--effort`, das der Workflow gesetzt hat: `low`, `medium`, `high`, `xhigh` oder `max`. `models` nennt jedes Modell, das gearbeitet hat, höchstens fünf, mit jedem Token, das es gelesen und geschrieben hat, den Cache eingeschlossen, aus dem `modelUsage` des Ergebnisses im Transkript der Claude Code Action. Die Nachricht zeigt es unter der Antwort, in einer Zeile, in der Sprache des Pagers:

| Verbrauch | Englisch | Deutsch |
| --- | --- | --- |
| Ein Modell | *🧮 Opus 5.5 · high · 48,213 tokens* | *🧮 Opus 5.5 · Hoch · 48.213 Tokens* |
| Zwei Modelle | *🧮 Opus 5.5 93%, Haiku 5.5 7% · extra high · 48,213 tokens* | *🧮 Opus 5.5 93 %, Haiku 5.5 7 % · Extra Hoch · 48.213 Tokens* |
| Ohne `models` | *🧮 Claude: 4 turns, 52 s, from your weekly limit* | *🧮 Claude: 4 Runden, 52 s, von deinem Wochenlimit* |

Ein Modell heißt mit seinem kurzen Namen, etwa *Opus 5.5* für `claude-opus-5-5`, *Haiku 3.5* für `claude-3-5-haiku-20241022` und *Fable 5.1* für `claude-fable-5-1`; eine ID anderer Form bleibt, wie sie ist. Der Aufwand heißt auf Deutsch *Niedrig*, *Mittel*, *Hoch*, *Extra Hoch* oder *Max*, und einer, den der Pager noch nicht kennt, bleibt, wie Claude Code ihn nennt.

Ein Vorschlag nennt seine Sache so, wie das Steuer-Repository sie kennt, und der Pager schlägt sie nach:

| Aktion | Art der Sache | `number` |
| --- | --- | --- |
| `merge` | `release` | keine |
| `assistant`, `draft` | `contribution` | das Issue oder der Pull Request |
| `fix` | `alarm`, `alert` | keine |
| `later`, `ignore` | jede der vier | bei einem Beitrag |

✅ Bestätigen trägt die Daten des eigenen Knopfs der Sache, ein Druck führt die Aktion also nur aus, solange die Sache sie noch anbietet, wie jeder Druck, und danach verschwindet der Knopf. Eine Sache, die der Pager nicht zeigt oder die die Aktion gerade nicht anbietet, bekommt die Antwort ohne Knopf. ✅ Senden und ✏️ Bearbeiten lassen sich nicht vorschlagen: Sie bleiben bei der Nachricht des Entwurfs, die den Text zeigt, den sie posten.

```sh
body='{"type":"note","text":"Der Fix ist in #12."}'
stamp=$(date +%s)
signature=$(printf '%s.%s' "$stamp" "$body" | openssl dgst -sha256 -hmac "$PAGER_CONTROL_SECRET" -r | cut -d' ' -f1)
curl -s "$PAGER_URL/control" -H "X-Pager-Timestamp: $stamp" -H "X-Pager-Signature: sha256=$signature" -d "$body"
```

Kein Body lässt den Pager handeln: Was das Steuer-Repository schickt, wird angezeigt, maskiert, und nie ausgeführt, und jede Aktion braucht den Druck auf einen Knopf der Positivliste. Die Antwort geht an den Worker statt direkt an Telegram, wie [Entscheidung 0003](decisions/0003-the-control-repository-answers-the-worker.md) erklärt: Der Token des Bots bleibt bei Cloudflare, und der Worker hält den Zustand, den ein Entwurf, ein fehlgeschlagener Job und ein Vorschlag brauchen.

## Die Reaktion auf einen Text

Ein Text an den Bot zeigt mit einer Reaktion, wo er steht, und der Pager ändert sie, während der Job läuft: Ein Bot darf eine Reaktion pro Nachricht setzen, aus der festen Liste von `ReactionTypeEmoji` in der Bot API von Telegram. Diese Liste hat kein ✅, deshalb steht 👍 für eine Antwort, das ihm am nächsten kommt, und 😢 für keine.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-reaction-on-a-text.de.dark.svg">
  <img src="images/diagrams/the-reaction-on-a-text.de.svg" alt="Die Reaktion auf einen Text: Dennis schreibt dem Bot einen Text, und der Pager schickt ihn an das Steuer-Repository und reagiert mit 👀. Kommt die Antwort oder ein Vorschlag, wird aus dem 👀 ein 👍. Schlägt der Job fehl, wird es ein 😢, und ebenso, wenn binnen einer Stunde keine Antwort kam, was der Zeitplan alle 15 Minuten findet. Eine Antwort, die danach kommt, macht es trotzdem zum 👍.">
</picture>

Die Jobs des Steuer-Repositorys dauern höchstens 40 Minuten, deshalb wartet der Pager eine Stunde auf die Antwort: Der Zeitplan gibt alle 15 Minuten einem Text, der danach noch wartet, sein 😢, 60 bis 75 Minuten nachdem er ging. Eine Antwort, die später kommt, macht es trotzdem zum 👍, im Thread ihres Textes.

## Der Thread einer Antwort

Mit der Bot API 9.3 hat Telegram dem privaten Chat eines Bots Threads gegeben, und ist der Threaded Mode für den Bot an, in der Mini App von @BotFather, kann jeder neue Text des Maintainers einen eigenen Thread beginnen. Eine Antwort auf einen Text geht in den Thread, aus dem der Text kam, gelesen aus seiner `message_thread_id`: die Antwort auf `/help`, ein Fehler, etwa ein fehlendes Steuer-Repository oder ein Entwurf, den es nicht mehr gibt, und die Antwort des Steuer-Repositorys, ob Notiz, Fehlschlag oder Vorschlag mit seinem Knopf ✅ Bestätigen. Die Reaktionen brauchen keinen Thread, denn sie sitzen auf dem Text selbst.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-thread-of-an-answer.de.dark.svg">
  <img src="images/diagrams/the-thread-of-an-answer.de.svg" alt="Der Thread einer Antwort: Dennis schreibt einen Text in einem Thread des Chats. Die Antwort auf /help oder ein Fehler geht sofort in diesen Thread. Freier Text geht an das Steuer-Repository, und der Pager behält seinen Thread, solange er wartet. Die Antwort des Steuer-Repositorys, eine Notiz, ein Fehlschlag oder ein Vorschlag mit seinem Knopf Bestätigen, geht in denselben Thread. General, ein Text von vor den Threads, eine Antwort, die mehr als einen Tag zu spät kommt, und ein Thread, den Telegram nicht findet, bekommen ihre in der Hauptansicht.">
</picture>

Das Steuer-Repository sieht den Thread nie: Der Pager behält ihn beim Text, der auf seine Antwort wartet, und die `message` der Antwort findet ihn wieder, so bleibt der Vertrag, wie er war. Manche Antworten gehen stattdessen in die Hauptansicht:

- ein Text aus General, dem ersten Thread, dessen Nachrichten die Bot API ohne die ID eines Threads nimmt;
- eine Antwort auf keinen Text, etwa die eines Jobs, der von Hand startete;
- eine Antwort auf einen Text, der ging, bevor der Pager Threads kannte, und eine, die mehr als einen Tag nach ihrem Text kommt: Den Thread eines Textes, den er aufgegeben hat, behält der Pager einen Tag, so findet ihn auch eine späte Antwort;
- eine Antwort, deren Thread Telegram nicht findet, mit `message thread not found`, etwa einen, den der Maintainer gelöscht hat: Der Pager schickt sie ohne den Thread noch einmal und schreibt das ins Log, ohne ihren Text.

Die Nachrichten der Sachen, etwa eines Releases oder eines fehlschlagenden Checks, bleiben in der Hauptansicht, wo sie sind.

## Texte und Sprachen

Jeder Text, den der Pager schickt, kommt aus `src/texts.ts`, ein Katalog pro Sprache, Englisch und Deutsch, und `LANGUAGE` in `wrangler.jsonc` wählt einen: die Nachrichten und ihre Zustände, die Knöpfe, `/help`, die Antworten der Knöpfe, die Fehler, die er zeigt, und die Erinnerung an das Token. Ein Text nennt seine Teile in geschweiften Klammern, etwa `{repo}`, und was sie füllt, etwa der Titel eines Issues oder der Name eines Checks, geht so hinein, wie GitHub es sagt. Die Regeln geben weiter, was sie meinen, etwa warum ein Release noch nicht mergen darf, als Schlüssel des Katalogs mit seinen Werten, und der Pager formuliert es; die Logs bleiben auf Englisch. Beide Kataloge haben dieselben Schlüssel, was der Compiler prüft, und dieselben Platzhalter, Tags und Emojis, was `test/texts.test.ts` prüft: Ein neuer Text braucht einen Eintrag in beiden.

Nach einer Änderung von `LANGUAGE` spricht eine Nachricht die neue Sprache, sobald sich ihre Sache ändert; was ihr Eintrag als Text hält, etwa ihre Notiz, die Einträge eines Bündels und die Erinnerung, behält die Worte, mit denen es geschrieben wurde.

## Zustand

Workers KV hält einen Eintrag pro Sache: ihre Art, ihren Zustand, das Repository, die ID ihrer Nachricht und, bei einem Beitrag, den Entwurf; eine geschlossene Sache verfällt nach 30 Tagen. Die Zeit eines „Später“ steht in den Metadaten seines Eintrags, sodass der Zeitplan mit einer Liste findet, was fällig ist, die Rückfrage einer Bearbeitung lebt einen Tag, und ein Eintrag hält die Texte, die auf ihre Antwort warten, mit der Zeit, zu der jeder ging, und dem Thread, aus dem er kam, sodass der Zeitplan ihn einmal pro Lauf liest und nur schreibt, wenn ein Text kommt oder geht. Jede Änderung einer Sache ist ein Schreibvorgang, wie es der kostenlose Tarif von Workers KV verlangt. Nichts Geheimes wird gespeichert, und die Logs nennen nur die Antworten der APIs, nie ein Token oder den Text eines Issues.

Workers KV kennt kein Compare-and-Swap, und ein Schreibvorgang zeigt sich an anderen Orten des Netzes erst nach einer Weile. Darum gibt der Worker jede Anfrage, die seine Prüfung von Route und Methode bestanden hat, an ein einziges Durable Object, `Serial` in `src/serial.ts`, das die Änderungen nacheinander ausführt, an einem Ort: Zwei Pflicht-Checks, die im selben Moment scheitern, enden in einer Nachricht mit beiden, und ein zweimal gedrücktes ✅ Senden postet einmal. Das Objekt hält selbst nichts; es ist eines mit SQLite, das der kostenlose Tarif von Workers bietet.

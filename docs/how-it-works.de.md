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
| `check_suite` completed auf einem Branch von release-please | GitHub nennt den Pull Request clean: offen, kein Entwurf, in den Standard-Branch, jeder Pflicht-Check grün und aktuell | Die Release-Nachricht mit 🔀 **Merge** |
| `pull_request` synchronize, closed und merged; `release` published | Es ist das Release, das die Nachricht zeigt | Dieselbe Nachricht: *aktualisiert*, *gemergt*, *✅ veröffentlicht* |

Ein Bündel, dessen letzter Eintrag verschwunden ist, wird von selbst grün, und ein neuer Fehler danach öffnet eine neue Nachricht, die benachrichtigt.

## Die Knöpfe

`src/buttons.ts` ist die Positivliste: Jede Art von Sache bietet diese Knöpfe in diesen Zuständen an, und ein Druck wirkt nur, wenn die Sache, so wie sie zur Zeit des Drucks ist, ihn noch anbietet.

| Sache | Zustand | Knöpfe |
| --- | --- | --- |
| Beitrag | new | ✍️ Draft a reply, 🤖 Assistant again (nur Issues), ⏰ Later, ✖ Ignore |
| Beitrag | drafting | ⏰ Later, ✖ Ignore |
| Beitrag | draft | ✅ Send, ✏️ Edit, ⏰ Later, ✖ Ignore |
| Alarm, Code Scanning | open | 🛠 Start fix, ⏰ Later, ✖ Ignore |
| Alarm, Code Scanning | fixing | ⏰ Later, ✖ Ignore |
| Release | ready | 🔀 Merge, ⏰ Later, ✖ Ignore |
| Erinnerung | open | ✅ Renewed, ⏰ Later |

- **🔀 Merge** fragt GitHub erneut nach dem Pull Request und merged ihn per Squash nur an dem Stand, den die Nachricht zeigte, solange er noch clean ist; ein geändertes Release wartet wieder auf seine Checks.
- **✅ Send** postet den Entwurf, dessen Version sein Knopf trägt, genau so, wie die Nachricht ihn zeigte; ein älterer Knopf derselben Sache lehnt ab. **✏️ Edit** bittet um den neuen Text als Antwort auf seine Rückfrage und zeigt ihn als nächsten Entwurf.
- **🤖 Assistant again** startet den Workflow `issue-assistant.yml` des Repositorys auf dem Issue mit `override`, im Namen des Maintainers. Ein Repository, dessen Issue-Assistent den Override noch nicht kennt, antwortet mit 422, und der Knopf sagt das.
- **✍️ Draft a reply** und **🛠 Start fix** schicken die Sache an das Steuer-Repository, dessen Antwort wie unten beschrieben zurückkommt. Jeder ist ein Lauf von Claude mit dem Abo des Maintainers, der auf dessen Wochenlimit zählt, und die Antwort sagt, wie viel er genommen hat; ein Job, der fehlschlägt, bringt seinen Knopf zurück.
- **⏰ Later** bringt die Sache nach `LATER_HOURS` als neue Nachricht zurück; **✖ Ignore** schließt sie.

## Das Steuer-Repository

Der Workflow des privaten Repositorys `Dennis-Otto/dennis-otto-pager-control` führt Claude Code mit dem eigenen Abo des Maintainers aus; seine README beschreibt seine Jobs, seine Sicherheit und seine Einrichtung. Der Pager schickt ihm einen [Repository Dispatch](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event), mit einem Token der App nur für dieses Repository:

| Ereignistyp | Gesendet von | Client Payload |
| --- | --- | --- |
| `pager-draft` | ✍️ Draft a reply | `item`, `repo`, `number`, `pull` |
| `pager-fix` | 🛠 Start fix | `item`, `repo`, `kind` (`alarm` oder `alert`), `entries` mit `label` und `url` |
| `pager-text` | Ein Text, der auf keine Rückfrage antwortet | `text`, `message` (seine ID im Chat) und `reply`: die ersten 1000 Zeichen der Nachricht, auf die der Text antwortet, falls es eine gibt |

Ein Text als Antwort auf eine Nachricht des Pagers handelt von ihrer Sache: *merge it*, als Antwort auf die Nachricht eines Releases, meint dieses Release. Der Pager schickt keinen Text eines Issues: Der Workflow liest ihn selbst von GitHub, als Daten. Er antwortet mit einem `POST` an `/control`:

- dem Header `X-Pager-Timestamp`, der Zeit in Sekunden seit 1970, die höchstens fünf Minuten abweichen darf;
- dem Header `X-Pager-Signature`, `sha256=` und das HMAC mit SHA-256, unter `CONTROL_SECRET`, über den Zeitstempel, einen Punkt und den Body;
- einem Body aus JSON, einem der unten genannten.

Der Body ist eines von:

- `{"type": "draft", "item": "<id>", "text": "<Antwort>"}`: der Entwurf einer Antwort auf einen Beitrag, höchstens 3000 Zeichen, gezeigt als neue Nachricht mit ✅ Send;
- `{"type": "note", "item": "<id>", "text": "<Notiz>"}`: eine Notiz unter einer Sache, etwa der Pull Request eines Fixes;
- `{"type": "note", "text": "<Antwort>"}`: eine eigene Nachricht, etwa die Antwort auf freien Text;
- `{"type": "proposal", "text": "<Antwort>", "action": "<Aktion>", "target": {"kind": "<Art>", "repo": "<owner/name>", "number": <Nummer>}}`: eine Antwort auf freien Text, die eine Aktion vorschlägt, als eigene Nachricht mit einem einzigen Knopf ✅ Confirm;
- `{"type": "failed", "item": "<id>", "text": "<Grund>"}`: ein Entwurf oder ein Fix, der nicht zustande kam, etwa weil das Wochenlimit erreicht ist. Die Sache kehrt in den Zustand vor ihrem Knopf zurück, mit dem Grund als Notiz, in einer neuen Nachricht, damit der Knopf erneut laufen kann.

Jeder Body kann `"usage": {"turns": <Zahl>, "seconds": <Zahl>}` tragen: was der Lauf von Claude vom Wochenlimit des Abos genommen hat. Die Nachricht zeigt es als *🧮 Claude: 4 turns, 52 s, from your weekly limit*.

Ein Vorschlag nennt seine Sache so, wie das Steuer-Repository sie kennt, und der Pager schlägt sie nach:

| Aktion | Art der Sache | `number` |
| --- | --- | --- |
| `merge` | `release` | keine |
| `assistant`, `draft` | `contribution` | das Issue oder der Pull Request |
| `fix` | `alarm`, `alert` | keine |
| `later`, `ignore` | jede der vier | bei einem Beitrag |

✅ Confirm trägt die Daten des eigenen Knopfs der Sache, ein Druck führt die Aktion also nur aus, solange die Sache sie noch anbietet, wie jeder Druck, und danach verschwindet der Knopf. Eine Sache, die der Pager nicht zeigt oder die die Aktion gerade nicht anbietet, bekommt die Antwort ohne Knopf. ✅ Send und ✏️ Edit lassen sich nicht vorschlagen: Sie bleiben bei der Nachricht des Entwurfs, die den Text zeigt, den sie posten.

```sh
body='{"type":"note","text":"Der Fix ist in #12."}'
stamp=$(date +%s)
signature=$(printf '%s.%s' "$stamp" "$body" | openssl dgst -sha256 -hmac "$PAGER_CONTROL_SECRET" -r | cut -d' ' -f1)
curl -s "$PAGER_URL/control" -H "X-Pager-Timestamp: $stamp" -H "X-Pager-Signature: sha256=$signature" -d "$body"
```

Kein Body lässt den Pager handeln: Was das Steuer-Repository schickt, wird angezeigt, maskiert, und nie ausgeführt, und jede Aktion braucht den Druck auf einen Knopf der Positivliste. Die Antwort geht an den Worker statt direkt an Telegram, wie [Entscheidung 0003](decisions/0003-the-control-repository-answers-the-worker.md) erklärt: Der Token des Bots bleibt bei Cloudflare, und der Worker hält den Zustand, den ein Entwurf, ein fehlgeschlagener Job und ein Vorschlag brauchen.

## Zustand

Workers KV hält einen Eintrag pro Sache: ihre Art, ihren Zustand, das Repository, die ID ihrer Nachricht und, bei einem Beitrag, den Entwurf; eine geschlossene Sache verfällt nach 30 Tagen. Die Zeit eines „Later“ steht in den Metadaten seines Eintrags, sodass der Zeitplan mit einer Liste findet, was fällig ist, und die Rückfrage einer Bearbeitung lebt einen Tag. Jede Änderung einer Sache ist ein Schreibvorgang, wie es der kostenlose Tarif von Workers KV verlangt. Nichts Geheimes wird gespeichert, und die Logs nennen nur die Antworten der APIs, nie ein Token oder den Text eines Issues.

Workers KV kennt kein Compare-and-Swap, und ein Schreibvorgang zeigt sich an anderen Orten des Netzes erst nach einer Weile. Darum gibt der Worker jede Anfrage, die seine Prüfung von Route und Methode bestanden hat, an ein einziges Durable Object, `Serial` in `src/serial.ts`, das die Änderungen nacheinander ausführt, an einem Ort: Zwei Pflicht-Checks, die im selben Moment scheitern, enden in einer Nachricht mit beiden, und ein zweimal gedrücktes ✅ Send postet einmal. Das Objekt hält selbst nichts; es ist eines mit SQLite, das der kostenlose Tarif von Workers bietet.

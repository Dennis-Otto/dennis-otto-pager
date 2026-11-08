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
| `discussion` created, `discussion_comment` created | Der Autor ist weder der Maintainer noch ein Bot, die Diskussion ist keine des Maintainers, und keine Antwort von Q&A wurde gewählt | Ein Beitrag mit sofortigem Entwurf, einer pro Diskussion; ein neuer Kommentar wird zur Nachricht, auf die die Antwort antwortet ([unten](#eine-diskussion)) |
| `discussion` answered, closed oder deleted; `discussion_comment` created vom Maintainer | Die Diskussion ist keine des Maintainers | Ihre offene Sache ist erledigt, und ihre Nachricht sagt, warum ([unten](#eine-diskussion)) |
| `check_run` completed auf dem Standard-Branch | Die Rulesets des Branches verlangen den Check, und er ist fehlgeschlagen, abgelaufen oder nicht gestartet | Ein Eintrag im Alarm des Repositorys; ein Erfolg desselben Checks nimmt ihn heraus |
| `workflow_run` completed | `release.yml`, `build-release.yml` oder `verify-release.yml` ist gescheitert, außerhalb eines Pull Requests | Ein Eintrag im Alarm; ein Erfolg nimmt ihn heraus |
| `issues` opened von einem Bot | Es trägt das Label `bot-failure` des Bot-Health-Bots | Ein Eintrag im Alarm; eine Änderung des offenen Issues, wie der Bot sie bei jedem neuen Fehlschlag macht, ändert den Eintrag und öffnet nichts; sein Schließen nimmt ihn heraus |
| `code_scanning_alert` created oder reopened auf dem Standard-Branch | Der Schweregrad ist high oder critical | Ein Eintrag in der Code-Scanning-Nachricht des Repositorys; behoben oder verworfen nimmt ihn heraus |
| `check_suite` completed auf einem Branch von release-please | GitHub nennt den Pull Request clean: offen, kein Entwurf, in den Standard-Branch, jeder Pflicht-Check grün und aktuell | Die Release-Nachricht mit 🔀 **Mergen** |
| `pull_request` synchronize, closed und merged; `release` published | Es ist das Release, das die Nachricht zeigt | Dieselbe Nachricht: *aktualisiert*, *gemergt*, *✅ veröffentlicht* |
| `workflow_run` completed | `visual.yml`, der Visual Check, ist auf einem Pull Request des Repositorys an seinem Head grün, der einer des Maintainers oder eines Bots ist, und ein Bild sieht anders aus | Die Bilder vorher und nachher, im Thema des Releases oder einer eigenen Sache ([unten](#die-bilder-einer-sichtbaren-änderung)) |
| `pull_request` closed | Es ist einer des Maintainers oder eines Bots, dessen Bilder der Pager zeigt | Seine Bilder sind erledigt: ✅ vor ihrem Thema |

Ein Bündel, dessen letzter Eintrag verschwunden ist, wird von selbst grün, und ein neuer Fehler danach öffnet eine neue Nachricht, die benachrichtigt. Ein Eintrag im Alarm behält den Lauf von GitHub Actions, der scheiterte, wo er einen nennt: ein Pflicht-Check über die Adresse seines Jobs, etwa `…/actions/runs/31/job/2`, ein Release-Lauf über seine ID und ein Issue des Bot-Health-Bots über den Lauf in der Markierung seines Textes, `<!-- bot-health {"run": 31, …} -->`, die der Bot bei jedem Fehlschlag neu schreibt. Ein solcher Eintrag gibt dem Alarm 🔁 **Neu starten**.

## Die Knöpfe

`src/buttons.ts` ist die Positivliste: Jede Art von Sache bietet diese Knöpfe in diesen Zuständen an, und ein Druck wirkt nur, wenn die Sache, so wie sie zur Zeit des Drucks ist, ihn noch anbietet.

| Sache | Zustand | Knöpfe |
| --- | --- | --- |
| Beitrag | new | ✍️ Antwort entwerfen, 🤖 Assistent nochmal (nur Issues), ⏰ Später, ✖ Ignorieren |
| Beitrag | drafting | ⏰ Später, ✖ Ignorieren |
| Beitrag | draft | ✅ Senden, ✏️ Bearbeiten, ⏰ Später, ✖ Ignorieren |
| Diskussion | new | ✍️ Antwort entwerfen, ✖ Ignorieren, nur wenn ihr Entwurf nicht angefragt werden konnte oder sein Job fehlschlug oder nicht innerhalb der Stunde antwortete |
| Diskussion | drafting | ✖ Ignorieren |
| Diskussion | draft | ✅ Senden, ✏️ Bearbeiten, ✖ Ignorieren |
| Alarm | open | 🔁 Neu starten (wo ein Eintrag einen Lauf nennt), 🛠 Fix starten, ⏰ Später, ✖ Ignorieren |
| Code Scanning | open | 🛠 Fix starten, ⏰ Später, ✖ Ignorieren |
| Alarm, Code Scanning | fixing | ⏰ Später, ✖ Ignorieren |
| Release | ready | 🔀 Mergen, ⏰ Später, ✖ Ignorieren |
| Bilder | open | ✖ Ignorieren |
| Erinnerung | open | ✅ Erneuert, ⏰ Später |
| Frage eines Agenten | open | Ein Knopf pro Option (kein ⏰ Später, kein ✖ Ignorieren) |

- **🔀 Mergen** fragt GitHub erneut nach dem Pull Request und merged ihn per Squash nur an dem Stand, den die Nachricht zeigte, solange er noch clean ist; ein geändertes Release wartet wieder auf seine Checks.
- **✅ Senden** postet den Entwurf, dessen Version sein Knopf trägt, genau so, wie die Nachricht ihn zeigte, im Namen des Maintainers, und in einer Diskussion als App; ein älterer Knopf derselben Sache lehnt ab. **✏️ Bearbeiten** bittet um den neuen Text als Antwort auf seine Rückfrage und zeigt ihn als nächsten Entwurf, der von da an der eigene des Maintainers ist: Kein Entwurf des Steuer-Repositorys ersetzt ihn, auch nicht der eines Jobs, der noch läuft.
- **🤖 Assistent nochmal** startet den Workflow `issue-assistant.yml` des Repositorys auf dem Issue mit `override`, im Namen des Maintainers. Ein Repository, dessen Issue-Assistent den Override noch nicht kennt, antwortet mit 422, und der Knopf sagt das.
- **🔁 Neu starten** liest jeden Lauf, den die Einträge nennen, mit einem Token der App für `actions: read`, und startet seine gescheiterten Jobs erneut, wie *Re-run failed jobs* auf GitHub, mit einem Token für `actions: write`. Ein Lauf, der noch läuft oder dessen neuerer Versuch läuft, und einer, der bei einem neuen Versuch schon grün wurde, bleiben, wie sie sind, und der Knopf sagt das. Die Einträge eines Laufs, der erneut läuft, zeigen *🔁 läuft erneut …* in der Nachricht, die sich an Ort und Stelle ändert, bis der Lauf wieder scheitert oder grün wird: Ein Erfolg schließt das Issue des Bot-Health-Bots oder beendet den Fehlschlag des Releases, was den Eintrag herausnimmt, und der letzte macht den Alarm ✅. Der Knopf kostet keinen Lauf von Claude, daher steht er vorn, für einen kurzen Ausfall von GitHub, etwa einen Download, der mit 504 antwortete.
- **✍️ Antwort entwerfen** und **🛠 Fix starten** schicken die Sache an das Steuer-Repository, dessen Antwort wie unten beschrieben zurückkommt. Jeder ist ein Lauf von Claude mit dem Abo des Maintainers, der auf dessen Wochenlimit zählt, und die Antwort nennt sein Modell, seinen Aufwand und seine Tokens; ein Fix, der in den Logs einen Ausfall von GitHub oder eines Downloads findet, etwa eine 504, eine Zeitüberschreitung oder `error connecting to api.github.com`, ändert nichts und schlägt 🔁 **Neu starten** mit einem Knopf ✅ **Bestätigen** vor; ein Job, der fehlschlägt, bringt seinen Knopf zurück, und ebenso ein Job, der binnen einer Stunde keine Antwort schickte: Der Zeitplan gibt seiner Sache die Knöpfe einmal zurück, als neue Nachricht mit der Notiz *⌛ Keine Antwort vom Steuer-Repository*.
- **Ein Knopf pro Option** beantwortet die [Frage eines Agenten](#fragen-und-berichte-deiner-agenten) und speichert die Antwort.
- **⏰ Später** bringt die Sache nach `LATER_HOURS` als neue Nachricht zurück; **✖ Ignorieren** schließt sie.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-rerun-of-a-run.de.dark.svg">
  <img src="images/diagrams/the-rerun-of-a-run.de.svg" alt="Der Neustart eines gescheiterten Laufs: Ein Eintrag im Alarm nennt einen Lauf von GitHub Actions, der auf main scheiterte, etwa den eines Pflicht-Checks, eines Releases oder eines Issues des Bot-Health-Bots. Dennis drückt Neu starten, und der Pager liest den Lauf. Solange er noch läuft oder wenn er bei einem neuen Versuch schon grün wurde, sagt der Knopf das, und nichts startet. Sonst laufen seine gescheiterten Jobs erneut, und der Eintrag sagt das in der Nachricht. Scheitern sie wieder, zeigt der Eintrag den Fehlschlag, und Neu starten kann sie noch einmal starten. Werden sie grün, schließt der Bot-Health-Bot sein Issue oder der Release-Lauf gelingt, der Eintrag verschwindet, und der letzte macht den Alarm grün.">
</picture>

## Eine Diskussion

Eine neue Diskussion, oder ein Kommentar zu einer, von jemand anderem als dem Maintainer oder einem Bot ist ebenfalls ein Beitrag, mit einem eigenen Thema, etwa *💬 demo#31 How do I start?*. Der Pager bittet das Steuer-Repository sofort um ihren Entwurf, denn ihre Knöpfe senden, bearbeiten oder ignorieren diesen Entwurf, wie [Entscheidung 0006](decisions/0006-a-discussion-gets-its-draft-at-once-and-the-reply-of-the-app.md) erklärt: Die Nachricht zeigt die Diskussion, oder den Kommentar mit seinem Autor, und *✍️ Das Steuer-Repository entwirft eine Antwort …*, und der Entwurf folgt mit ✅ **Senden**, ✏️ **Bearbeiten** und ✖ **Ignorieren**. ✅ Senden postet genau diesen Entwurf mit `addDiscussionComment` der GraphQL-API von GitHub, mit einem Token der App für `discussions: write` dieses einen Repositorys, also erscheint die Antwort als die der App: an der Diskussion selbst, oder im Thread des Kommentars, auf den sie antwortet, was bei einer Antwort auf eine Antwort der Thread ihres Elternkommentars ist, denn GitHub schachtelt nur eine Ebene. Ein Entwurf, der nicht angefragt werden konnte, etwa weil die App nicht auf dem Steuer-Repository installiert ist, lässt die Nachricht mit ✍️ **Antwort entwerfen** und einer Notiz, die sagt, warum.

Eine Diskussion ist eine Sache, mit ihrer Nummer als Schlüssel, die GitHub mit denen der Issues und Pull Requests zusammen zählt. Ein neuer Kommentar von jemand anderem wird zur Nachricht, auf die die Antwort antwortet, mit einem neuen Entwurf: Solange die Sache offen ist, ersetzt eine neue Nachricht die alte, und sobald ihre Antwort gesendet ist, öffnet die Sache wieder in ihrem Thema, in dem die alte Nachricht als Verlauf bleibt. Eine Diskussion, die der Maintainer ignoriert hat, bleibt ignoriert, bis ihr Eintrag 30 Tage später verfällt. Keine Sache kommt von einer Diskussion des Maintainers, samt ihren Kommentaren, denn GitHub benachrichtigt ihren Autor selbst über jeden Kommentar, von einer aus Q&A mit gewählter Antwort, und von den eigenen Antworten der App, die als Kommentare eines Bots zurückkommen.

Eine Diskussion, um die sich GitHub schon gekümmert hat, braucht keine Antwort des Pagers, so wie Bilder keine mehr brauchen, sobald ihr Pull Request geschlossen ist: Wenn der Maintainer auf GitHub selbst antwortet, auf die Diskussion oder in einem ihrer Threads, wenn jemand eine Antwort markiert, oder wenn die Diskussion geschlossen oder gelöscht wird, ist ihre offene Sache erledigt. Ihre Knöpfe gehen, ihr Thema bekommt ✅, und ihre Nachricht sagt, warum, etwa *💬 Du hast auf GitHub geantwortet, also sendet der Pager nichts.*, an Ort und Stelle bearbeitet, was niemanden benachrichtigt. Ein Job, der noch für sie entwirft, findet die Sache erledigt, und sein Entwurf wird nicht gezeigt. Ein neuer Kommentar von jemand anderem öffnet sie danach wieder, wie nach einer gesendeten Antwort, außer eine Antwort wurde gewählt.

Ein Entwurf, den der Maintainer mit ✏️ Bearbeiten geschrieben hat, bleibt seiner ([Entscheidung 0009](decisions/0009-a-discussion-that-github-dealt-with-is-done-and-an-own-draft-stays.md)). Ein Job, der noch entwarf, als sein Text kam, etwa einer für einen neueren Kommentar, ersetzt ihn nicht mehr: Sein Entwurf kommt als Nachricht zum Lesen ohne Knöpfe in das Thema der Sache, und ✅ Senden postet weiter seinen Text. Auch ein neuer Kommentar von jemand anderem behält ihn: Die neue Nachricht zeigt den Kommentar mit seinem Text als Entwurf, eine Notiz sagt es, und kein Job entwirft einen anderen, sodass er ihn mit ✏️ Bearbeiten für den neuen Kommentar ändert.

Das Steuer-Repository führt die Jobs einer Sache nacheinander aus. Ein Kommentar, der kommt, während der Entwurf zu einem älteren noch geschrieben wird, wartet auf ihn: Der Pager zeigt den neuen Kommentar sofort, verwirft den älteren Entwurf, wenn er kommt, damit keine Antwort auf den älteren Kommentar in den Thread des neueren gehen kann, und fragt dann den Entwurf zum neuesten Kommentar an. ✅ Senden postet an der Diskussion selbst, wenn der Kommentar, auf den die Antwort antwortet, gelöscht ist, wie GitHubs `NOT_FOUND` dafür sagt, damit die freigegebene Antwort nicht verloren geht.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-reply-to-a-discussion.de.dark.svg">
  <img src="images/diagrams/the-reply-to-a-discussion.de.svg" alt="Die Antwort auf eine Diskussion: Jemand anderes als Dennis oder ein Bot eröffnet eine Diskussion oder kommentiert eine. Eine Diskussion von Dennis und eine mit gewählter Antwort enden hier. Sonst zeigt der Pager sie in ihrem Thema und bittet das Steuer-Repository sofort um einen Entwurf, den Claude in Dennis' Stimme schreibt. Der Entwurf kommt mit Senden, Bearbeiten und Ignorieren. Senden postet genau diesen Entwurf als App des Pagers, im Thread des Kommentars, auf den er antwortet, oder an der Diskussion selbst. Ein neuer Kommentar von jemand anderem wird zur Nachricht, auf die geantwortet wird, mit einem neuen Entwurf im selben Thema, während ein Text, den Dennis selbst geschrieben hat, der Entwurf bleibt. Wenn Dennis auf GitHub selbst antwortet, jemand eine Antwort markiert oder die Diskussion geschlossen wird, ist die Sache erledigt: Ihre Knöpfe gehen, und ihr Thema bekommt einen Haken.">
</picture>

## Die Bilder einer sichtbaren Änderung

Ein Repository, dessen Bilder seine App zeigen, etwa paperless-unified-search, lässt auf jedem Pull Request, der ändert, was sie zeigen, einen Visual Check laufen: Sein `visual.yml` rendert die Bilder neu, vergleicht jedes Pixel für Pixel mit dem committeten und behält jedes, das anders aussieht, in einem Artefakt seines Laufs, vorher und nachher, mit `report.json`, ihrer Liste mit dem Anteil der geänderten Pixel. Ist der Check auf einem Pull Request des Maintainers oder eines Bots grün, zeigt der Pager diese Bilder im Chat, wie [Entscheidung 0007](decisions/0007-the-pictures-of-a-visual-change-come-from-the-artifacts-of-its-check.md) erklärt:

- **Wessen:** Der Pager fragt GitHub zuerst nach dem Pull Request. Einer von jemand anderem, einer aus einem Fork, dessen Lauf keinen Pull Request nennt, und einer, der zu einem neueren Head weiterzog, bekommen nichts: Was der Pull Request eines anderen rendert, ist seins, und ein neuerer Head bringt einen eigenen Check.
- **Wohin:** Der Release-Pull-Request, den der Pager zeigt, bekommt sie im Thema des Releases, unter einer eigenen Nachricht, damit seine Nachricht 🔀 **Mergen** behält. Jeder andere bekommt eine eigene Sache, etwa *🖼 demo#8 Make it blue*, deren Nachricht die Bilder aufzählt, die anders aussehen, mit dem Anteil, der sich an jedem geändert hat, und auf den Lauf des Checks verlinkt, dessen Artefakte sie alle haben, jedes geänderte Pixel rot. Ihr einziger Knopf ist ✖ **Ignorieren**, der ihre Bilder stoppt; der Merge oder das Schließen des Pull Requests beendet sie, mit ✅ vor ihrem Thema.
- **Was:** ein Album, mit `sendMediaGroup` der Bot API, der größten Änderungen vorher und nachher: höchstens drei Bilder, PNG- oder WebP-Dateien von höchstens 5 MB, in einer Größe, die Telegram als Foto nimmt. Ein GIF, ein Video und eine größere Datei bleiben hinter dem Link. Das Album direkt nach einer neuen Nachricht kommt leise, damit beide einmal benachrichtigen.
- **Wie oft:** höchstens ein Album pro Head des Pull Requests. Ein Check, der am selben Head noch einmal läuft, schickt nichts, und ein neuerer Head, dessen Bilder anders aussehen, ändert die Nachricht an Ort und Stelle, mit einem Album, das benachrichtigt. Ein neuerer Head, dessen Bilder alle wieder aussehen wie committet, sagt das in der Nachricht, an Ort und Stelle; ein Pull Request, dessen Bilder sich nie geändert haben, schickt gar nichts.
- **Wie:** mit einem Token der App für `actions: read` dieses einen Repositorys, das die App für 🔁 **Neu starten** hat, also ohne neues Secret. Der Pager listet die Artefakte des Laufs, `visual` oder eines pro Sprache, etwa `visual-en`, und fragt GitHub nach dem ZIP jedes einzelnen, zusammen höchstens 32 MB; GitHub antwortet mit der Adresse seines Speichers, für eine Minute signiert. Der Pager folgt ihr ohne das Token, das nur an GitHub geht, liest das ZIP im Speicher und entpackt nur den Bericht und die Bilder des Albums, nie auf mehr als die Größe, die das ZIP ihnen gibt. Er liest die Berichte jedes Repositorys: Ihre Liste heißt `pictures` oder `images`, ein Bild ist new oder added, deleted oder removed, und seine Dateien nennt sein Eintrag, oder es sind sein Pfad in `before/` und `after/`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-pictures-of-a-visual-change.de.dark.svg">
  <img src="images/diagrams/the-pictures-of-a-visual-change.de.svg" alt="Die Bilder einer sichtbaren Änderung: Dennis oder ein Bot pusht auf einen Pull Request, der ändert, wie etwas aussieht, und sein Visual Check rendert die Bilder neu und behält jedes, das anders aussieht, in einem Artefakt, vorher und nachher. Ist der Check grün, fragt der Pager GitHub nach dem Pull Request, mit einem Token seiner App. Einer von jemand anderem, aus einem Fork oder einer, der zu einem neueren Head weiterzog, endet dort, ebenso ein Head, dessen Bilder schon kamen. Sonst liest der Pager das Artefakt mit demselben Token, über die kurzlebige Adresse seines Speichers. Sieht jedes Bild aus wie committet, kommt nichts. Sehen welche anders aus, geht ihre Nachricht in das Thema seines Releases oder einer eigenen Sache, und das Album der größten Änderungen folgt, vorher und nachher, höchstens drei Bilder. Der Merge oder das Ende des Pull Requests hakt das Thema ab.">
</picture>

## Das Steuer-Repository

Der Workflow des privaten Repositorys `Dennis-Otto/dennis-otto-pager-control` führt Claude Code mit dem eigenen Abo des Maintainers aus; seine README beschreibt seine Jobs, seine Sicherheit und seine Einrichtung. Der Pager schickt ihm einen [Repository Dispatch](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event), mit einem Token der App nur für dieses Repository:

| Ereignistyp | Gesendet von | Client Payload |
| --- | --- | --- |
| `pager-draft` | ✍️ Antwort entwerfen, und eine Diskussion oder ein Kommentar zu einer, sobald er kommt | `item`, `repo`, `number`, `pull`, `language`; bei einer Diskussion auch `discussion`: `true` und `comment`, die GraphQL-ID des Kommentars, auf den die Antwort antwortet, falls es einen gibt |
| `pager-fix` | 🛠 Fix starten | `item`, `repo`, `kind` (`alarm` oder `alert`), `entries` mit `label` und `url`, `language`. Die `url` eines gescheiterten Release-Laufs nennt seinen Versuch, etwa `…/actions/runs/3/attempts/2`, damit der Fix die Jobs dieses Versuchs liest und nicht die einer Wiederholung, die noch läuft |
| `pager-text` | Ein Text, der auf keine Rückfrage antwortet | `text`, `message` (seine ID im Chat), `reply`: die ersten 1000 Zeichen der Nachricht, auf die der Text antwortet, falls es eine gibt, und `thing`: die Sache, aus deren Thema der Text kam, falls es eine gibt; `language` |

`language` ist `LANGUAGE` des Workers, `en` oder `de`: Darin antwortet das Steuer-Repository dem Maintainer, die Notiz eines Fixes und der Grund eines gescheiterten Jobs eingeschlossen, während ein Antwortentwurf in der Sprache seines Issues oder Pull Requests bleibt.

Ein Text als Antwort auf eine Nachricht des Pagers handelt von ihrer Sache: *merge it*, als Antwort auf die Nachricht eines Releases, meint dieses Release. Ebenso ein Text im Thema einer Sache, der die Sache als `thing` mitbringt: ihre `id`, `kind`, `repo` und `state`, die `number` eines Beitrags oder Releases und die `version` eines Releases, `links` dorthin, wo GitHub sie zeigt (ihr Issue oder Pull Request, oder die Seite eines Bündels und seine Einträge, höchstens 21), und `text`, ihre Nachricht, wie der Maintainer sie sieht, im HTML von Telegram, in dem escapt ist, was von GitHub kommt, höchstens 1500 Zeichen. Der Schlüssel heißt `thing`, nicht `item`: Der Steuer-Workflow führt die Jobs eines `item` nacheinander aus, und ein Text behält einen eigenen Lauf. Ein Workflow, der `thing` nicht kennt, übergeht es, so darf jede Seite zuerst deployen. Der Pager schickt keinen Text eines Issues: Der Workflow liest ihn selbst von GitHub, als Daten. Er antwortet mit einem `POST` an `/control`:

- dem Header `X-Pager-Timestamp`, der Zeit in Sekunden seit 1970, die höchstens fünf Minuten abweichen darf;
- dem Header `X-Pager-Signature`, `sha256=` und das HMAC mit SHA-256, unter `CONTROL_SECRET`, über den Zeitstempel, einen Punkt und den Body;
- einem Body aus JSON, einem der unten genannten.

Der Body ist eines von:

- `{"type": "draft", "item": "<id>", "text": "<Antwort>"}`: der Entwurf einer Antwort auf einen Beitrag, höchstens 3000 Zeichen, gezeigt als neue Nachricht mit ✅ Senden. Hat der Maintainer den Entwurf selbst geschrieben, kommt der Entwurf eines Jobs als Nachricht zum Lesen in das Thema der Sache, und seiner bleibt;
- `{"type": "note", "item": "<id>", "text": "<Notiz>"}`: eine Notiz unter einer Sache, etwa der Pull Request eines Fixes. Die Notiz, die einen Job beendet, solange die Sache noch *fixing* (oder ein Beitrag *drafting*) ist, kommt in einer neuen Nachricht, die benachrichtigt, wie ein Fehlschlag; jede andere Notiz bearbeitet die Nachricht der Sache an Ort und Stelle;
- `{"type": "note", "text": "<Antwort>"}`: eine eigene Nachricht, etwa die Antwort auf freien Text;
- `{"type": "proposal", "text": "<Antwort>", "action": "<Aktion>", "target": {"kind": "<Art>", "repo": "<owner/name>", "number": <Nummer>}}`: eine Antwort auf freien Text, die eine Aktion vorschlägt, als eigene Nachricht mit einem einzigen Knopf ✅ Bestätigen;
- `{"type": "failed", "item": "<id>", "text": "<Grund>"}`: ein Entwurf oder ein Fix, der nicht zustande kam, etwa weil das Wochenlimit erreicht ist. Die Sache kehrt in den Zustand vor ihrem Knopf zurück, mit dem Grund als Notiz, in einer neuen Nachricht, damit der Knopf erneut laufen kann;
- `{"type": "failed", "item": "<id>", "text": "<Grund>", "action": "rerun"}`: ein Fix ohne Änderung, der eine Aktion seines Alarms oder seiner Warnung vorschlägt, etwa 🔁 Neu starten, wenn die Logs einen Ausfall von GitHub oder eines Downloads zeigen. Die Sache kehrt zurück wie oben, mit dem Grund als Notiz, aber ihre Nachricht bleibt an ihrem Platz, und die Antwort kommt im Thema der Sache als Vorschlag, mit einem einzigen Knopf ✅ Bestätigen, der benachrichtigt. Eine Sache, die die Aktion dann nicht anbietet, etwa ein Alarm, dessen Einträge keinen Lauf nennen, kehrt zurück wie bei jedem gescheiterten Job. Ein älterer Pager übergeht `action`, daher darf jede Seite zuerst deployen;
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
| `assistant`, `draft` | `contribution` | das Issue, der Pull Request oder die Diskussion |
| `fix` | `alarm`, `alert` | keine |
| `rerun` | `alarm` | keine |
| `later`, `ignore` | jede der vier | bei einem Beitrag |

✅ Bestätigen trägt die Daten des eigenen Knopfs der Sache, ein Druck führt die Aktion also nur aus, solange die Sache sie noch anbietet, wie jeder Druck, und danach verschwindet der Knopf. Eine Sache, die der Pager nicht zeigt oder die die Aktion gerade nicht anbietet, bekommt die Antwort ohne Knopf. Die `action` eines gescheiterten Fixes nennt kein `target`: Es ist die Sache des Jobs. ✅ Senden und ✏️ Bearbeiten lassen sich nicht vorschlagen: Sie bleiben bei der Nachricht des Entwurfs, die den Text zeigt, den sie posten.

```sh
body='{"type":"note","text":"Der Fix ist in #12."}'
stamp=$(date +%s)
signature=$(printf '%s.%s' "$stamp" "$body" | openssl dgst -sha256 -hmac "$PAGER_CONTROL_SECRET" -r | cut -d' ' -f1)
curl -s "$PAGER_URL/control" -H "X-Pager-Timestamp: $stamp" -H "X-Pager-Signature: sha256=$signature" -d "$body"
```

Kein Body lässt den Pager handeln: Was das Steuer-Repository schickt, wird angezeigt, maskiert, und nie ausgeführt, und jede Aktion braucht den Druck auf einen Knopf der Positivliste. Die Antwort geht an den Worker statt direkt an Telegram, wie [Entscheidung 0003](decisions/0003-the-control-repository-answers-the-worker.md) erklärt: Der Token des Bots bleibt bei Cloudflare, und der Worker hält den Zustand, den ein Entwurf, ein fehlgeschlagener Job und ein Vorschlag brauchen.

## Fragen und Berichte deiner Agenten

Die eigenen Agenten des Maintainers, etwa ein Orchestrator, der die Nacht über auf seinem PC läuft, mit `gh` in seinem Namen angemeldet, fragen über den Pager, statt eine Zeile in einem Bericht zu hinterlassen: Eine Frage kommt als eigene Sache, in einem eigenen Thema, mit ihren Optionen als Knöpfen, und der Agent liest die Antwort aus dem privaten Steuer-Repository. Kein Geheimnis geht auf den PC: `gh` schickt das Ereignis und liest die Antwort mit der eigenen Anmeldung des Maintainers.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/a-question-of-an-agent.de.dark.svg">
  <img src="images/diagrams/a-question-of-an-agent.de.svg" alt="Die Frage eines Agenten: Ein Agent von Dennis, etwa ein Orchestrator auf seinem PC, schickt das Ereignis pager-ask mit gh an das private Steuer-Repository, mit einer Id, einer Frage und zwei bis vier Optionen. Dessen Workflow nimmt nur ein Ereignis von Dennis selbst, prüft es und schickt es signiert an den Worker. Der Pager öffnet ein Thema für die Frage, mit einem Knopf pro Option. Dennis drückt einen, und die GitHub App speichert seine Antwort als answers/id.json auf dem Branch pager-answers des Steuer-Repositorys. Der Agent liest sie dort mit gh, ohne ein eigenes Geheimnis.">
</picture>

Ein Agent schickt dem Steuer-Repository einen von zwei [Repository Dispatches](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event):

| Ereignistyp | Client Payload | Was der Pager zeigt |
| --- | --- | --- |
| `pager-ask` | `id`, `question`, `options` | Ein Thema *🤔 Entscheidung: …*, mit einem Knopf pro Option |
| `pager-report` | `text`, und `title`, falls es einen gibt | Ein Thema *🧾 Lauf: …*, oder *🧾 Lauf* ohne Titel, mit dem Bericht und ohne Knopf |

```sh
gh api repos/Dennis-Otto/dennis-otto-pager-control/dispatches --input - <<'JSON'
{"event_type": "pager-ask", "client_payload": {"id": "2026-11-08-merge-order", "question": "Welches Release zuerst?", "options": ["Der Blueprint", "Der Pager"]}}
JSON
```

Der Workflow des Steuer-Repositorys nimmt nur ein Ereignis, das der Besitzer des Repositorys geschickt hat, nie eines der GitHub App oder von jemand anderem, prüft es, wie der Pager es tut, und schickt es an `/control` weiter, signiert wie jede Antwort:

- `{"type": "ask", "id": "<id>", "question": "<Frage>", "options": ["<Option>", …]}`: Die `id` benennt die Antwort, aus Buchstaben, Ziffern, Punkten, Bindestrichen und Unterstrichen, höchstens 64 Zeichen, am Anfang ein Buchstabe oder eine Ziffer; die `question` hat höchstens 1000 Zeichen; zwei bis vier `options`, jede anders und höchstens 64 Zeichen lang, werden die Knöpfe, einer pro Reihe. Dieselbe `id` noch einmal fragt nichts Neues: Eine offene Frage bleibt, wie sie ist, und für eine schon beantwortete antwortet der Pager 409. Eine beantwortete `id` behält ihre Datei auf `pager-answers` für immer und lässt sich nicht noch einmal fragen, daher braucht jede Frage eine neue `id`, mit dem Datum oder dem Lauf darin, etwa `2026-11-08-merge-order`: Sonst läse der Agent die alte Antwort als Wahl für seine neue Frage. Ohne die GitHub App im Steuer-Repository antwortet der Pager 503, weil er die Antwort nicht speichern könnte;
- `{"type": "report", "text": "<Bericht>", "title": "<Titel>"}`: der Bericht eines Laufs, seine ersten 3000 Zeichen, mit einem `title` von höchstens 100 Zeichen, den der Pager nicht in seinem Speicher behält.

Ein Druck speichert die Antwort im Steuer-Repository, als GitHub App, mit einem Token nur für dieses Repository und seinem Recht, den Inhalt zu schreiben, das sie für die Dispatches schon hat: die Datei `answers/<id>.json` auf dem Branch `pager-answers`, den ihre erste Antwort mit einem eigenen Commit anlegt, ohne Vorgänger und ohne den Code des Repositorys, damit kein Workflow darauf läuft.

```json
{
  "id": "2026-11-08-merge-order",
  "question": "Welches Release zuerst?",
  "options": ["Der Blueprint", "Der Pager"],
  "choice": 1,
  "answer": "Der Pager",
  "answered": "2026-11-08T07:12:03.000Z"
}
```

Die Nachricht zeigt dann die Antwort, ihre Knöpfe verschwinden, und ihr Thema bekommt ✅. Lehnt GitHub die Antwort ab, sagt der Knopf warum, und die Frage bleibt offen, damit ein Druck sie noch einmal speichert. Eine Frage hat kein ⏰ Später und kein ✖ Ignorieren: Ein Agent wartet auf sie. Der Agent liest die Antwort mit seinem eigenen `gh`, das 404 antwortet, solange es keine gibt, für eine `id`, die noch nie gefragt wurde:

```sh
gh api -H "Accept: application/vnd.github.raw+json" "repos/Dennis-Otto/dennis-otto-pager-control/contents/answers/2026-11-08-merge-order.json?ref=pager-answers"
```

Das Skript `scripts/ask.mjs` des Steuer-Repositorys kann alle drei: Es fragt, berichtet und wartet auf eine Antwort, wie seine README beschreibt.

## Die Reaktion auf einen Text

Ein Text an den Bot zeigt mit einer Reaktion, wo er steht, und der Pager ändert sie, während der Job läuft: Ein Bot darf eine Reaktion pro Nachricht setzen, aus der festen Liste von `ReactionTypeEmoji` in der Bot API von Telegram. Diese Liste hat kein ✅, deshalb steht 👍 für eine Antwort, das ihm am nächsten kommt, und 😢 für keine.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-reaction-on-a-text.de.dark.svg">
  <img src="images/diagrams/the-reaction-on-a-text.de.svg" alt="Die Reaktion auf einen Text: Dennis schreibt dem Bot einen Text, und der Pager schickt ihn an das Steuer-Repository und reagiert mit 👀. Kommt die Antwort oder ein Vorschlag, wird aus dem 👀 ein 👍. Schlägt der Job fehl, wird es ein 😢, und ebenso, wenn binnen einer Stunde keine Antwort kam, was der Zeitplan alle 15 Minuten findet. Eine Antwort, die danach kommt, macht es trotzdem zum 👍.">
</picture>

Die Jobs des Steuer-Repositorys dauern höchstens 40 Minuten, deshalb wartet der Pager eine Stunde auf die Antwort: Der Zeitplan gibt alle 15 Minuten einem Text, der danach noch wartet, sein 😢, 60 bis 75 Minuten nachdem er ging. Eine Antwort, die später kommt, macht es trotzdem zum 👍, im Thread ihres Textes.

## Ein Thema pro Sache

Mit der Bot API 9.4 kann ein Bot in seinem privaten Chat Themen öffnen, mit `createForumTopic`, sobald der Threaded Mode für den Bot in der Mini App von @BotFather an ist ([Einrichten](setup.md#1-der-bot-von-telegram)). Dann öffnet die erste Nachricht jeder Sache ein eigenes Thema, benannt nach ihrem Repository, ohne seinen Besitzer, und dem, was die Sache ist, mit einer Farbe pro Art:

| Sache | Name ihres Themas | Farbe |
| --- | --- | --- |
| Beitrag | 🙋 demo#12 It breaks | Blau |
| Diskussion | 💬 demo#31 How do I start? | Blau |
| Alarm | 🚨 demo braucht dich | Rot |
| Code Scanning | 🛡 Code Scanning in demo | Gelb |
| Release | 📦 demo 1.2.3 | Grün |
| Erinnerung | 🔔 Claude-Token | Violett |
| Frage eines Agenten | 🤔 Entscheidung: Welches Release zuerst? | Violett |
| Bericht eines Laufs | 🧾 Lauf: Nachtlauf | Grün |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/a-topic-per-thing.de.dark.svg">
  <img src="images/diagrams/a-topic-per-thing.de.svg" alt="Ein Thema pro Sache: Eine neue Sache, etwa ein Alarm, ein Beitrag oder ein Release, öffnet ein eigenes Thema im Chat, benannt nach ihrem Repository und dem, was sie ist. Ihre Nachricht mit den Knöpfen kommt zuerst, und ihre Änderungen bearbeiten sie dort. Ihre Entwürfe, die Antwort von Fix, die Rückfrage von Bearbeiten, was Später zurückbringt, und die Antworten auf das, was Dennis im Thema fragt, folgen darin; seine Frage geht zusammen mit der Sache an das Steuer-Repository. Ist die Sache erledigt, bekommt ihr Thema ein Häkchen vor seinen Namen und bleibt. Ohne Threaded Mode, oder wenn Telegram das Thema oder eine Nachricht darin ablehnt, geht es mit der Sache in der Hauptansicht weiter, wie bisher.">
</picture>

- **Alles über die Sache steht in ihrem Thema.** Ihre Nachricht mit den Knöpfen kommt zuerst, und ihre Änderungen bearbeiten sie an Ort und Stelle, wie bisher. Ein Entwurf, die Antwort von 🛠 Fix starten, ein gescheiterter Job, die Nachricht, die ⏰ Später zurückbringt, die Rückfrage von ✏️ Bearbeiten und die Antworten auf Texte im Thema folgen dort.
- **Ein Text im Thema einer Sache handelt von dieser Sache.** Er geht mit der Sache als `thing` an das Steuer-Repository, wie die Tabelle oben sagt, so braucht eine Frage wie *warum?* keine weiteren Worte. Ein Thema, das der Maintainer öffnet, und General haben keine Sache: Ein Text dort beginnt ein eigenes Gespräch, wie bisher.
- **Ein Thema pro Sache, nie eines pro Änderung.** Das Bündel dessen, was in einem Repository fehlschlägt, behält sein Thema, auch wenn es sich wieder öffnet, nachdem es grün wurde, und ebenso sein Code Scanning. Eine neue Version eines Releases, das noch gezeigt wird, behält das Thema der Version, die sie ersetzt, umbenannt; das nächste Release, nachdem eines veröffentlicht oder ignoriert wurde, bekommt ein eigenes.
- **✅, sobald sie erledigt ist.** Eine Sache, die geschlossen ist, oder ein Release, das gemergt ist, bekommt mit `editForumTopic` ein ✅ vor den Namen ihres Themas, und ein Bündel, das sich wieder öffnet, verliert es. Erledigte Themen bleiben, als Geschichte ihrer Sachen, wie [Entscheidung 0005](decisions/0005-one-topic-per-thing-kept-when-done.md) erklärt: Der Maintainer löscht eines von Hand, wenn er es nicht mehr braucht.
- **Themen des Maintainers.** Die Dienstnachricht `forum_topic_created` eines Themas, das der Maintainer öffnet, übergeht der Pager, und jeden Text darin beantwortet er darin. Telegram schickt den ersten Text eines Themas, das auf dem Handy geöffnet wurde, womöglich ohne seinen Thread: Seine Antwort geht dann in die Hauptansicht.

Ohne Themen schreibt der Pager in die Hauptansicht, wie bisher, und die Sache funktioniert, wie sie es tat:

- `getMe` meldet kein `has_topics_enabled`, weil der Threaded Mode aus ist;
- Telegram lehnt `createForumTopic` ab;
- Telegram öffnet das Thema, lehnt aber die Nachricht darin mit `message thread not found` ab, wie es ein Rollout von Telegram in [tdlib/telegram-bot-api#847](https://github.com/tdlib/telegram-bot-api/issues/847) tat: Der Pager löscht das leere Thema wieder;
- das Thema einer Sache gibt es nicht mehr, etwa weil der Maintainer es gelöscht hat: Die nächste Nachricht der Sache geht in die Hauptansicht, und die danach ebenso. Ein Bündel, das sich wieder öffnet, nachdem sein Thema gelöscht wurde, bekommt stattdessen ein neues Thema, damit der neue Vorfall ein eigenes hat.

Die Rückfrage von ✏️ Bearbeiten antwortet dann auf die Nachricht ihrer Sache, sodass klar ist, worum es geht, und eine Sache von vor den Themen bleibt in der Hauptansicht, bis sie sich schließt. Jeder dieser Fälle schreibt eine Warnung mit der Antwort von Telegram ins Log, nie den Namen des Themas oder einen Text.

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

Die Nachrichten der Sachen, etwa eines Releases oder eines fehlschlagenden Checks, gehen in ihre Themen, wie [ein Thema pro Sache](#ein-thema-pro-sache) sagt.

## Texte und Sprachen

Jeder Text, den der Pager schickt, kommt aus `src/texts.ts`, ein Katalog pro Sprache, Englisch und Deutsch, und `LANGUAGE` in `wrangler.jsonc` wählt einen: die Nachrichten und ihre Zustände, die Knöpfe, `/help`, die Antworten der Knöpfe, die Fehler, die er zeigt, und die Erinnerung an das Token. Ein Text nennt seine Teile in geschweiften Klammern, etwa `{repo}`, und was sie füllt, etwa der Titel eines Issues oder der Name eines Checks, geht so hinein, wie GitHub es sagt. Die Regeln geben weiter, was sie meinen, etwa warum ein Release noch nicht mergen darf, als Schlüssel des Katalogs mit seinen Werten, und der Pager formuliert es; die Logs bleiben auf Englisch. Beide Kataloge haben dieselben Schlüssel, was der Compiler prüft, und dieselben Platzhalter, Tags und Emojis, was `test/texts.test.ts` prüft: Ein neuer Text braucht einen Eintrag in beiden.

Nach einer Änderung von `LANGUAGE` spricht eine Nachricht die neue Sprache, sobald sich ihre Sache ändert; was ihr Eintrag als Text hält, etwa ihre Notiz, die Einträge eines Bündels und die Erinnerung, behält die Worte, mit denen es geschrieben wurde.

## Zustand

Workers KV hält einen Eintrag pro Sache: ihre Art, ihren Zustand, das Repository, die ID ihrer Nachricht, den Thread und den Namen ihres Themas und, bei einem Beitrag, den Entwurf, ob er der eigene des Maintainers ist, bei einer Diskussion mit den IDs der Diskussion und des Kommentars, auf den ihre Antwort antwortet; eine geschlossene Sache verfällt nach 30 Tagen. Ein Verweis vom Thread eines Themas auf seine Sache, `topic:<thread>`, lässt einen Text im Thema sie finden: ein Schreibvorgang, wenn sich das Thema öffnet, und einer, wenn es umbenannt wird, und er verfällt 30 Tage, nachdem seine Sache erledigt ist. Die Zeit eines „Später“ und die eines Jobs des Steuer-Repositorys, solange seine Sache auf die Antwort wartet, stehen in den Metadaten ihres Eintrags, sodass der Zeitplan mit einer Liste findet, was fällig ist und was zu lange wartet, die Rückfrage einer Bearbeitung lebt einen Tag, und ein Eintrag hält die Texte, die auf ihre Antwort warten, mit der Zeit, zu der jeder ging, und dem Thread, aus dem er kam, sodass der Zeitplan ihn einmal pro Lauf liest und nur schreibt, wenn ein Text kommt oder geht. Jede Änderung einer Sache ist ein Schreibvorgang, wie es der kostenlose Tarif von Workers KV verlangt. Nichts Geheimes wird gespeichert, und die Logs nennen nur die Antworten der APIs, nie ein Token oder den Text eines Issues.

Workers KV kennt kein Compare-and-Swap, und ein Schreibvorgang zeigt sich an anderen Orten des Netzes erst nach einer Weile. Darum gibt der Worker jede Anfrage, die seine Prüfung von Route und Methode bestanden hat, an ein einziges Durable Object, `Serial` in `src/serial.ts`, das die Änderungen nacheinander ausführt, an einem Ort: Zwei Pflicht-Checks, die im selben Moment scheitern, enden in einer Nachricht mit beiden, und ein zweimal gedrücktes ✅ Senden postet einmal. Das Objekt hält selbst nichts; es ist eines mit SQLite, das der kostenlose Tarif von Workers bietet.

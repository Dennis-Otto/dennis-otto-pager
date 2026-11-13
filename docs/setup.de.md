# Einrichten

Repo Pager betreibst du selbst: Du hast eine eigene Instanz, mit deinem eigenen Bot von Telegram, deinem eigenen Worker auf Cloudflare, deiner eigenen GitHub-App, ein paar Geheimnissen und deinem eigenen privaten Steuer-Repository. Diese Schritte dauern etwa eine halbe Stunde, mit den kostenlosen Tarifen von Cloudflare und Telegram, und nichts davon liegt in GitHub. Geh sie in dieser Reihenfolge durch: Jeder Schritt braucht den davor.

Führe die Befehle in Git Bash oder einer anderen Unix-Shell aus, in einem Checkout deiner Kopie dieses Repositorys, nach `npm ci --ignore-scripts`. Lies ein Geheimnis mit `read -rs` ein, damit es nicht in der Historie der Shell landet.

## Warum es keine gemeinsame App gibt

Es gibt keine App von Repo Pager zum Installieren und keinen Pager, der mehrere Leute bedient, und das mit Absicht:

- **Deine Tokens und deine Ereignisse bleiben deine.** Eine gemeinsame App bekäme die Ereignisse der Repositorys aller Nutzer, auch der privaten, und hielte die Tokens, die in ihrem Namen handeln. Deine eigene App schickt die Ereignisse deiner Repositorys nur an deinen Worker, und ihre Geheimnisse liegen in deinem Konto bei Cloudflare.
- **Ein Pager bedient einen Chat.** Der Worker bedient nur den Chat, den `TELEGRAM_CHAT_ID` nennt, und handelt für ein Konto, `MAINTAINER_LOGIN`; sein Zustand ist der eines Maintainers.
- **Er beobachtet die Repositorys deines Kontos,** und die einer Organisation nur, wenn du sie in `OWNERS` nennst und ihre App dort installiert werden kann, wie [Repositorys einer Organisation](#repositorys-einer-organisation) beschreibt. Auch in der Organisation bist nur du der Maintainer: Was die anderen Mitglieder eröffnen, meldet er als Beitrag.
- **Dein Abo antwortet.** Die Entwürfe, die Fixes und der freie Text laufen mit Claude Code und deinem eigenen Abo, in deinem eigenen privaten Steuer-Repository, nie mit dem Schlüssel eines gemeinsamen Dienstes.

## Deine Kopie

Leg eine Kopie dieses Repositorys an: einen Fork oder ein eigenes Repository. `wrangler.jsonc` ist die Konfiguration einer Instanz, und ihre Werte sind die der eigenen Instanz des Maintainers; setz dort deine und committe sie, vor Schritt 2:

| In `wrangler.jsonc` | Dein Wert |
| --- | --- |
| `name` | Der Name deines Workers, etwa `repo-pager`, den seine Adresse trägt |
| `kv_namespaces` | Ohne `id`: Die dort nennt den Namensraum der Instanz des Maintainers, und dein erstes Deployment legt deinen eigenen an und schreibt seine Id dorthin |
| `MAINTAINER_LOGIN` | Dein Konto auf GitHub |
| `OWNERS` | Leer, oder die Organisationen, deren Repositorys der Pager auch beobachtet, durch Kommas getrennt, etwa `octo-org`: Lies zuerst [Repositorys einer Organisation](#repositorys-einer-organisation) |
| `CONTROL_REPOSITORY` | Dein privates Steuer-Repository, das du unten anlegst und in Schritt 7 einrichtest, etwa `octocat/repo-pager-control` |
| `LANGUAGE` | `de` für Deutsch, `en` oder leer für Englisch |
| `CLAUDE_TOKEN_EXPIRES` | Der Tag, an dem dein Token von Claude abläuft, oder leer |

Die Tests deiner Kopie bestehen mit deinen Werten: Sie nehmen sie aus `wrangler.jsonc`, und `bash scripts/check.sh` lässt sie noch einmal mit denen einer anderen Instanz laufen, damit eine eigene Änderung und ein Update durch einen grünen Pull-Request kommen.

### Repositorys einer Organisation

Der Pager beobachtet die Repositorys von `MAINTAINER_LOGIN` und von jedem Besitzer, den `OWNERS` nennt; die Ereignisse jedes anderen Repositorys verwirft er ohne Nachricht ([Entscheidung 0025](decisions/0025-the-pager-watches-the-repositories-of-owners-beside-its-maintainer.md)). Wer als du gilt, bleibt `MAINTAINER_LOGIN`, auch in den Repositorys der Organisation: Was du dort eröffnest, ist deins, und was jemand anderes eröffnet, auch ein Mitglied der Organisation, ist ein Beitrag, mit seiner Nachricht.

Welche Repositorys ihre Ereignisse schicken, entscheiden die Installationen der GitHub-App, und eine private App, wie `github-app.json` sie anlegt, lässt sich nur auf dem Konto installieren, dem sie gehört. Entscheide also vor Schritt 4:

| Der Pager beobachtet | Die GitHub-App | Das Steuer-Repository |
| --- | --- | --- |
| Die Repositorys deines Kontos | Deine, privat, wie Schritt 4 sie anlegt | In deinem Konto |
| Die Repositorys einer Organisation | Die der Organisation, privat: `node scripts/register-app.mjs "$WORKER" --org ORGANISATION`, das das Recht braucht, die Apps der Organisation zu verwalten | In der Organisation |
| Die deines Kontos und die von Organisationen | Deine oder die einer Organisation, in ihren Einstellungen unter *Advanced* → *Make public* öffentlich gemacht und auf jedem Konto installiert | In deinem Konto |

Eine öffentliche App kann jeder installieren, doch sie hält keins deiner Geheimnisse, und nichts, was ihre anderen Installationen schicken, erreicht deinen Chat: Der Worker bedient nur die Repositorys von `MAINTAINER_LOGIN` und `OWNERS`. Mit einem Steuer-Repository in einer Organisation kommen die Fragen und Berichte deiner eigenen Agenten nicht durch: Sein Workflow *Agents* leitet nur weiter, was der Besitzer des Repositorys geschickt hat, und eine Organisation schickt nichts.

Ein fein granuliertes Token hat einen Besitzer, dein Konto oder eine Organisation, die es vielleicht erst genehmigen muss: `GITHUB_USER_TOKEN` aus Schritt 3 und `PAGER_FIX_TOKEN` aus Schritt 7 handeln nur in den Repositorys des Besitzers, den du für sie wählst. Wähl die Organisation, wenn der Pager nur ihre Repositorys beobachtet.

Die Befehle unten nennen dein Steuer-Repository mit einer Variablen der Shell. Leg es jetzt an, privat, aus [der Vorlage des Steuer-Repositorys](https://github.com/Dennis-Otto/repo-pager-control-template), denn Schritt 3 gibt ihm ein Geheimnis und Schritt 4 installiert die App darauf; Schritt 7 richtet den Rest ein:

```sh
CONTROL=octocat/repo-pager-control   # dein Konto und der Name deines Steuer-Repositorys
gh repo create "$CONTROL" --private --template Dennis-Otto/repo-pager-control-template
```

Die Vorlage enthält die Workflows des Steuer-Repositorys und ihre Skripte, und ihr README ist ihre Anleitung. Deine Kopie bleibt privat, denn die Logs ihrer Läufe zeigen Issues, Entwürfe und was Claude gelesen hat. Bis Schritt 7 schlägt ihre tägliche Prüfung *Health* fehl, worüber GitHub dir eine Mail schickt.

## 1. Der Bot von Telegram

1. Schreib in Telegram `/newbot` an [@BotFather](https://t.me/BotFather) und gib dem Bot einen Namen und einen Benutzernamen, der auf `bot` endet. BotFather antwortet mit dem Token des Bots: Es ist ein Geheimnis.
2. Schreib dem neuen Bot irgendeine Nachricht, damit dein Chat mit ihm existiert.
3. Deine Chat-ID ist deine Nutzer-ID von Telegram, eine Zahl. [@userinfobot](https://t.me/userinfobot) nennt sie, oder der Bot selbst, sobald du ihm geschrieben hast:

    ```sh
    read -rs TOKEN   # das Token des Bots einfügen, dann Enter
    curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | grep -o '"chat":{"id":[0-9]*'
    ```

    Die Chat-ID ist persönlich: Sie gehört nicht ins Repository. Sie kommt in Schritt 3 als Geheimnis zu Cloudflare.

4. Gib dem Chat Themen, eines pro Sache: Öffne die Mini App von @BotFather, wähle den Bot, dann *Bot Settings* → *Threads Settings*, schalte **Threaded Mode** ein und lass **Disallow users to create new threads** aus, damit du eigene Themen öffnen kannst. Der Pager öffnet dann für jede neue Sache ein Thema und benennt es, etwa *🚨 repo-blueprint braucht dich*, und ein Text darin geht mit dieser Sache an das Steuer-Repository; ein Thema, das du öffnest, ist ein eigenes Gespräch. Gruppen bleiben aus: Der Pager bedient nur deinen privaten Chat. Ohne Threaded Mode schreibt der Pager alles in die Hauptansicht und funktioniert wie mit Themen; [So arbeitet er](how-it-works.md#ein-thema-pro-sache) sagt, was geschieht, wenn Telegram ein Thema ablehnt.

## 2. Der Worker auf Cloudflare

Leg den Worker mit seinem ersten Deployment an, wie [Cloudflare einmal einrichten](releases.md#cloudflare-einmal-einrichten) in [Releases und Cloudflare](releases.md) beschreibt, und verbinde dort deine Kopie mit Workers Builds, mit dem Deploy-Befehl `npx wrangler deploy`, damit jeder Push auf den `main` deiner Kopie live geht: Der Deploy-Befehl `npm run deploy` dieses Repositorys stellt nur seine eigenen Releases bereit und ließe jede Änderung deiner Kopie ohne Traffic, wie [In einer Kopie des Pagers](releases.md#in-einer-kopie-des-pagers) erklärt. Ohne Workers Builds führst du nach jeder Änderung selbst `npx wrangler deploy` aus. Das erste Deployment:

```sh
npx wrangler login
npx wrangler deploy
```

Das erste Deployment legt auch den Namensraum von Workers KV an, der den Zustand des Pagers hält, und schreibt seine Id in `wrangler.jsonc`: Committe sie, damit jedes spätere Deployment auf diesem Namensraum bleibt. Es legt auch das Durable Object an, das die Änderungen nacheinander ausführt, und nennt die Adresse des Workers, etwa `https://repo-pager.ACCOUNT.workers.dev`, die die Schritte danach aus einer Variablen der Shell nehmen:

```sh
WORKER=https://repo-pager.ACCOUNT.workers.dev   # die Adresse, die das Deployment nannte
```

Bis Schritt 3 erledigt ist, beantwortet der Worker jeden Webhook mit `503`.

## 3. Die Geheimnisse des Workers

Jedes Geheimnis kommt mit `npx wrangler secret put NAME` zu Cloudflare, das nach seinem Wert fragt:

| Geheimnis | Was es ist |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Das Token des Bots, aus Schritt 1 |
| `TELEGRAM_CHAT_ID` | Deine Chat-ID, aus Schritt 1: der einzige Chat, den der Pager bedient |
| `TELEGRAM_WEBHOOK_SECRET` | Ein zufälliger Text, den Telegram mit jedem Update schickt, unten erzeugt |
| `CONTROL_SECRET` | Ein zufälliger Text, mit dem das Steuer-Repository seine Antworten signiert, unten erzeugt |
| `GITHUB_USER_TOKEN` | Dein fein granuliertes Token, für die zwei Dinge in deinem Namen, unten erzeugt |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | Die GitHub-App: Schritt 4 setzt sie |

Die zwei zufälligen Geheimnisse, jedes in einer Variablen der Shell für die Schritte, die es noch einmal brauchen:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
WEBHOOK_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
printf %s "$WEBHOOK_SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
CONTROL_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
printf %s "$CONTROL_SECRET" | npx wrangler secret put CONTROL_SECRET
printf %s "$CONTROL_SECRET" | gh secret set PAGER_CONTROL_SECRET -R "$CONTROL"
```

**`GITHUB_USER_TOKEN`** handelt nur für zwei Knöpfe in deinem Namen: ✅ **Senden**, das eine Antwort auf ein Issue oder einen Pull Request postet, die du freigegeben hast, und 🤖 **Assistent nochmal**, das den Issue-Assistenten über seine Ein-Kommentar-Regel hinaus startet; der Issue-Assistent fragt GitHub nach der Rolle der Person, die ihn gestartet hat, und eine App hat keine. Leg ein [fein granuliertes Token](https://github.com/settings/personal-access-tokens/new) für dein Konto und deine Repositorys an, mit diesen Rechten und keinen anderen:

| Recht | Zugriff | Für |
| --- | --- | --- |
| Issues | Read and write | ✅ Senden bei einem Issue |
| Pull requests | Read and write | ✅ Senden bei einem Pull Request |
| Actions | Read and write | 🤖 Assistent nochmal |

```sh
npx wrangler secret put GITHUB_USER_TOKEN
```

Ohne es arbeitet der Pager auch, und diese zwei Knöpfe sagen, was fehlt. Ein feingranulares Token läuft ab, nach 30 Tagen, wenn du keinen anderen Tag wählst: Der Pager liest seinen Tag einmal am Tag bei GitHub und erinnert dich drei Wochen vorher, wie [Später](#später) sagt.

## 4. Die GitHub-App

Die App schickt die Ereignisse deiner Repositorys an den Worker und merged ein Release und startet die gescheiterten Jobs eines Laufs erneut, mit ihren eigenen, eingeschränkten Tokens. `github-app.json` ist ihr Manifest, mit den geringsten Rechten, die der Pager braucht. Registriere sie mit der Adresse deines Workers:

```sh
node scripts/register-app.mjs "$WORKER"
```

Für die App einer Organisation häng `--org ORGANISATION` an, wie [Repositorys einer Organisation](#repositorys-einer-organisation) sagt.

Öffne die Adresse, die es ausgibt, in dem Browser, der bei GitHub angemeldet ist, und bestätige die App. GitHub zeigt ihren Namen, *Repo Pager*, in einem Feld über dem Knopf: Der Name einer App ist auf GitHub einmalig, also gib deiner dort einen eigenen, mit höchstens 34 Zeichen, etwa *Repo Pager of octocat*. Das Skript legt ihre App-ID, ihren privaten Schlüssel und das Geheimnis ihres Webhooks in die Geheimnisse des Workers, ohne Datei, und nennt die Seite, die sie installiert. GitHub gibt den Schlüssel und das Geheimnis nur einmal heraus, darum lässt das Skript, bevor es das Manifest schickt, Wrangler die Geheimnisse des Workers auflisten und hält mit dem, was zu tun ist, an, wenn Wrangler nicht angemeldet ist oder der Worker noch nicht bereitgestellt ist. Scheitert Wrangler danach doch an einem, nennt das Skript die Geheimnisse, die gespeichert sind, und die, die fehlen, und die Seite der Einstellungen der App, auf der du einen neuen privaten Schlüssel erzeugst und ein neues Geheimnis des Webhooks setzt, oder auf der du die App löschst, um das Skript noch einmal zu starten. **Installiere die App** auf den Repositorys, die der Pager beobachtet, **und auf deinem Steuer-Repository**, wohin er die Entwürfe, die Fixes und den freien Text schickt. Welche Nachrichten in einem beobachteten Repository mehr als die App brauchen, sagt [Was ein beobachtetes Repository braucht](#was-ein-beobachtetes-repository-braucht).

Die App ist privat, nur das Konto, dem sie gehört, kann sie installieren: deins oder die Organisation von `--org`. Um sie auf mehr als einem Konto zu installieren, mach sie öffentlich, wie [Repositorys einer Organisation](#repositorys-einer-organisation) beschreibt. Ihre Rechte:

| Recht | Zugriff | Für |
| --- | --- | --- |
| Actions | Read and write | Ein Workflow, der auf `main` scheitert, und die Jobs, die in ihm scheiterten; 🔁 Neu starten, das einen gescheiterten Lauf liest und seine gescheiterten Jobs erneut startet; die Bilder eines Visual Checks |
| Checks | Read | Ein Pflicht-Check einer anderen App als GitHub Actions, der auf `main` scheitert; ein Release, dessen Checks fertig sind |
| Code scanning alerts | Read | Ein Alarm mit Schweregrad high oder critical |
| Contents | Read and write | 🔀 Mergen eines Releases; die Ereignisse an das Steuer-Repository; ob ein Release nach einem gescheiterten Release noch ein Entwurf ist, was GitHub nur einem Token zeigt, das die Inhalte schreiben darf |
| Discussions | Read and write | Eine neue Diskussion oder ein Kommentar zu einer; ✅ Senden einer Antwort in einer Diskussion, als App |
| Issues | Read | Ein neues Issue, ein Kommentar dazu oder zu einem Pull Request, ein erneutes Öffnen, und sein Ende; ein Issue mit `bot-failure` |
| Metadata | Read | Verlangt GitHub; die Pflicht-Checks von `main` |
| Pull requests | Read | Ein neuer Pull Request, seine Reviews, die Kommentare in seinem Code, seine neuen Commits, ein erneutes Öffnen und die Freigabe zum Review; der Zustand eines Release-Pull-Requests; wer einen Pull Request eröffnet hat, dessen Bilder sich geändert haben, und sein Head |
| Repository security advisories | Read | Eine vertrauliche Meldung einer Sicherheitslücke und ihr veröffentlichtes Advisory; an Tag 6, ob eine Meldung noch in der Triage wartet, das einzige Feld, das der Pager von ihr liest |
| Secret scanning alerts | Read | Eine Warnung des Secret Scannings und die Datei ihres Secrets, nie das Secret |

Eine App, die du vor 🔁 **Neu starten** registriert hast, hat *Actions: Read*: Setz es in den Einstellungen der App unter *Permissions & events* auf *Read and write* und nimm die neue Berechtigung für jede Installation an, wie GitHub dich per Mail bittet. Bis dahin sagt der Knopf, dass GitHub ihn ablehnte.

Eine App, die du registriert hast, bevor es Diskussionen gab, hat weder *Discussions* noch ihre Ereignisse: Gib ihr in den Einstellungen der App unter *Permissions & events* *Discussions: Read and write*, abonniere die Ereignisse *Discussion* und *Discussion comment* und nimm die neue Berechtigung für jede Installation an. Bis dahin erreicht keine Diskussion den Pager.

Einer App, die du registriert hast, bevor es die Kommentare zu Issues und Pull Requests gab, fehlt ihr Ereignis: Abonniere in den Einstellungen der App unter *Permissions & events* *Issue comment*. Ihre Berechtigungen *Issues* und *Pull requests* decken es ab, also muss keine Installation etwas annehmen. Bis dahin erreicht kein Kommentar zu einem Issue oder Pull Request den Pager, und eine Sache schließt trotzdem mit ihrem Issue oder Pull Request.

Einer App, die du registriert hast, bevor es die Reviews gab, fehlen ihre Ereignisse: Abonniere in den Einstellungen der App unter *Permissions & events* *Pull request review* und *Pull request review comment*. Ihre Berechtigung *Pull requests* deckt sie ab, also muss keine Installation etwas annehmen. Bis dahin erreicht weder ein Review noch eine Antwort im Thread eines Reviews den Pager, während neue Commits, ein erneutes Öffnen und die Freigabe zum Review mit den Ereignissen kommen, die die App hat.

Einer App, die du registriert hast, bevor es die Meldungen von Sicherheitslücken und die Secrets gab, fehlt beides: Gib ihr in den Einstellungen der App unter *Permissions & events* *Repository security advisories: Read* und *Secret scanning alerts: Read*, abonniere die Ereignisse *Repository advisory* und *Secret scanning alert* und nimm die neuen Berechtigungen für jede Installation an. Bis dahin meldet GitHub eine Meldung und ein Secret nur per Mail, wie bisher.

### Was ein beobachtetes Repository braucht

Der Pager arbeitet in jedem Repository, in dem seine App installiert ist, aber ein paar seiner Nachrichten und ein Knopf folgen den Konventionen von [repo-blueprint](https://github.com/Dennis-Otto/repo-blueprint), der Vorlage der Repositorys seines Maintainers: seinen Release-Workflows, seinen Bots und dem Workflow seines [Issue-Assistenten](https://github.com/Dennis-Otto/issue-assistant). In einem Repository ohne sie kommen diese Nachrichten nicht, und alles andere arbeitet wie immer:

| Was der Pager tut | Was das beobachtete Repository braucht |
| --- | --- |
| Ein Beitrag, seine Kommentare, Reviews und neuen Commits; eine Diskussion; ein Workflow oder ein erforderlicher Check, der auf `main` scheitert; ✍️ **Antwort entwerfen**, ✅ **Senden**, 🔁 **Neu starten**, 🛠 **Fix starten**, ✅ **Bestätigen**, ⏰ **Später** und ✖ **Ignorieren** | Nichts als die App |
| Ein Code-Scanning-Alarm, ein Secret, das das Secret Scanning fand, eine vertrauliche Meldung einer Sicherheitslücke | Die Funktionen von GitHub, die sie finden: Code Scanning, Secret Scanning und Private Vulnerability Reporting, eingeschaltet in den Einstellungen des Repositorys |
| Die Release-Nachricht mit 🔀 **Mergen** | [release-please](https://github.com/googleapis/release-please), dessen Release-Pull-Request von einem Branch `release-please--…` des Repositorys selbst kommt, mit einem Titel wie `chore: release 1.2.3` |
| Ein scheiterndes Release, als Eintrag des Alarms | Die Release-Workflows des Blueprints, `.github/workflows/release.yml`, `build-release.yml` und `verify-release.yml`; ein Release-Workflow anderen Namens meldet sich nur, wenn er auf `main` scheitert |
| Die Bilder eines Pull Requests, der ändert, wie etwas aussieht | Der visuelle Check des Blueprints, `.github/workflows/visual.yml`, dessen Artefakt jedes Bild hält, das anders aussieht, vorher und nachher |
| Ein Fehlschlag eines Bots, den der Pager verpasst hat, und *🖼 Lade die neue Social Preview hoch* | Der Bot-Health-Bot des Blueprints, dessen Issues das Label `bot-failure` tragen; ohne ihn meldet sich ein Bot, der auf `main` scheitert, trotzdem als Workflow, der dort scheitert |
| 🤖 **Assistent nochmal** bei einem Issue | Der Workflow `.github/workflows/issue-assistant.yml` des Issue-Assistenten, der die Eingabe `override` nimmt; ohne ihn antwortet der Knopf, dass das Repository keinen Issue-Assistenten hat, und nichts startet |

## 5. Der Webhook von Telegram

Sag Telegram, wohin es die Updates schicken soll, mit dem Geheimnis aus Schritt 3:

```sh
curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d url="$WORKER/telegram" \
  -d secret_token="$WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","callback_query"]' \
  -d max_connections=1
curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
```

`max_connections=1` lässt Telegram ein Update nach dem anderen schicken, damit ein zweimal gedrückter Knopf nur einmal wirkt. `getWebhookInfo` nennt die Adresse und, nach einer gescheiterten Zustellung, den Fehler.

## 6. Ausprobieren

- Schreib dem Bot `/help`: Er antwortet mit dem, was er tut.
- In den Einstellungen der GitHub-App, unter *Advanced*, ist die erste Zustellung ein `ping`, den der Worker mit `pong` beantwortet.
- Eröffne von einem anderen Konto ein Issue in einem beobachteten Repository: Die Nachricht kommt mit ihren Knöpfen.

## 7. Das Steuer-Repository

Dein privates Steuer-Repository, das `CONTROL_REPOSITORY` nennt, entwirft die Antworten, startet die Fixes und beantwortet den freien Text, mit Claude Code und deinem eigenen Abo. Du hast es am Anfang aus der Vorlage angelegt, also sind seine Workflows da, und [das README der Vorlage](https://github.com/Dennis-Otto/repo-pager-control-template#readme) beschreibt jeden seiner Jobs, jedes Geheimnis und jede Variable; [So arbeitet er](how-it-works.md#das-steuer-repository) beschreibt den Vertrag zwischen beiden: die Ereignisse, die der Pager ihm schickt, und die signierten Antworten, die der Pager annimmt. Neben `PAGER_CONTROL_SECRET` aus Schritt 3 braucht es das Token deines Abos von Claude aus `claude setup-token`, die Adresse des Workers, den Namen deiner App in ihrer Adresse, `github.com/apps/NAME`, des einzigen Bots, dessen Ereignisse Claude starten, und für 🛠 **Fix starten** einen fein granulierten Token von dir für die beobachteten Repositorys und für das Steuer-Repository selbst, mit *Contents*, *Pull requests* und *Workflows* zum Lesen und Schreiben, der den Pull Request eines Fixes eröffnet und den einer Änderung der Vorlage:

```sh
claude setup-token                                   # gibt das Token deines Abos aus
gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$CONTROL"  # füge es ein
gh variable set PAGER_URL -R "$CONTROL" --body "$WORKER"
gh variable set PAGER_APP -R "$CONTROL" --body repo-pager-of-octocat   # der Name deiner App in ihrer Adresse
gh secret set PAGER_FIX_TOKEN -R "$CONTROL"
```

Schreib dann in `pager/voice.md` deines Steuer-Repositorys, wie du schreibst: Ein Entwurf einer Antwort in deinem Namen folgt dem, und die Kopie der Vorlage ist nur ein Beispiel. Für einen Pager auf Deutsch lässt `gh variable set PAGER_LANGUAGE -R "$CONTROL" --body de` auch den Bericht einer Änderung der Vorlage Deutsch sprechen. Einmal pro Woche bringt der Workflow *Template* deines Steuer-Repositorys, was sich in der Vorlage geändert hat, als Pull Request, und der Pager sagt es dir; dein README und deine Stimme bleiben, wie sie sind ([Entscheidung 0019](decisions/0019-the-control-repository-comes-from-a-public-template-which-every-copy-follows.md)).

Schreib dem Bot dann eine Frage, etwa *What fails on main?*: Das 👀 sagt, dass sie an das Steuer-Repository ging, und seine Antwort kommt in ein, zwei Minuten und macht ein 👍 daraus. Ein 😢 sagt, dass keine Antwort zustande kam: Der Job schlug fehl oder antwortete nicht binnen einer Stunde, und der Lauf des Workflows im Actions-Tab des Steuer-Repositorys sagt, warum. Bis das Steuer-Repository eingerichtet ist, schicken seine Knöpfe ihre Ereignisse, und die Zusammenfassung seines Laufs zeigt die Antwort statt des Chats.

## Später

- **Deine Tokens laufen ab,** und der Pager erinnert dich drei Wochen vor jedem, in einem eigenen Thema, mit dem Weg, es zu erneuern, und noch einmal an dem Tag, an dem es abläuft; ✅ **Erneuert** schließt die Erinnerung:
  - **Das Token von Claude** im Steuer-Repository: `CLAUDE_TOKEN_EXPIRES` in `wrangler.jsonc` nennt den Tag. Erneuere es mit `claude setup-token` und `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$CONTROL"` und ändere dann den Tag in einem Pull Request.
  - **`GITHUB_USER_TOKEN`** des Workers: GitHub nennt seinen Tag in den Antworten seiner API, die der Pager einmal am Tag liest. Erzeug es auf der Seite deiner [feingranularen Tokens](https://github.com/settings/personal-access-tokens) neu, mit einem neuen Tag, und setz es mit `npx wrangler secret put GITHUB_USER_TOKEN`; nach einem neuen Token fragt der Pager GitHub sofort. Lehnt GitHub das Token ab, weil es abgelaufen ist oder widerrufen wurde, sagt die Erinnerung das, und ✅ **Senden** und 🤖 **Assistent nochmal** auch.
  - **`PAGER_FIX_TOKEN`** des Steuer-Repositorys: Seine tägliche Prüfung *Health* liest den Tag bei GitHub und schickt ihn mit. Erzeug es genauso neu und setz es mit `gh secret set PAGER_FIX_TOKEN -R "$CONTROL"`.
- **Der Zustand des Pagers:** Der Workflow *Health* des Steuer-Repositorys fragt den Pager einmal am Tag, wie es ihm geht, wie [So arbeitet er](how-it-works.md#wenn-der-pager-kaputtgeht) beschreibt, was etwa eine Minute seiner Actions-Minuten kostet. Sein Lauf scheitert, wenn der Zeitplan steht, Telegram den Bot ablehnt oder sein Webhook am letzten Tag einen Fehler gemeldet hat, GitHub die App ablehnt oder ein Token innerhalb einer Woche abläuft; GitHub benachrichtigt dich dann von sich aus über den gescheiterten Lauf, auch wenn Telegram oder der Worker kaputt ist. Starte ihn von Hand im Actions-Tab, um den Pager nach einer Änderung zu prüfen.
- **Ein Geheimnis ist durchgesickert:** Setz ein neues mit `npx wrangler secret put NAME`; für die App erzeuge in ihren Einstellungen einen neuen privaten Schlüssel und setz `GITHUB_APP_PRIVATE_KEY`; für den Bot `/revoke` bei @BotFather, dann `TELEGRAM_BOT_TOKEN` und Schritt 5 noch einmal.
- **Wie lange „Später“ wartet**, steht in `LATER_HOURS` in `wrangler.jsonc`. Eine Änderung von `wrangler.jsonc` geht live, sobald sie auf dem `main` deiner Kopie ist, wie [Deine Kopie aktuell halten](#deine-kopie-aktuell-halten) sagt.
- **Die Mails von GitHub Actions** können aus sein, sobald der Pager jeden [Workflow meldet, der auf `main` scheitert](how-it-works.md#ein-workflow-der-auf-main-scheitert): In den Einstellungen deines Kontos auf GitHub, unter *Notifications*, *System*, *Actions*, nimm den Haken bei *Email* heraus, aber lass *Web and Mobile* an und schau in deine Benachrichtigungen auf github.com oder in der GitHub-App: Der Pager kann ein Scheitern seiner selbst nicht melden, also erreicht dich der gescheiterte Lauf von *Health* des Steuer-Repositorys nur noch so, sobald *Email* aus ist. Willst du ihn lieber weiter als Mail, lass *Email* an und filtere stattdessen deine Mails: Behalte die Mails von Actions aus deinem Steuer-Repository und verwirf die anderen. Ein Lauf eines Pull Requests zeigt sich weiter im Pull Request.
- **Die Sprache** des Pagers steht in `LANGUAGE` in `wrangler.jsonc`: `de` für Deutsch, `en` oder leer für Englisch. Sie bestimmt jeden Text, den der Pager schickt, und der Worker gibt sie jedem Job an das Steuer-Repository mit, dessen Antworten ihr folgen. In jeder Sprache außer Englisch übersetzt das Steuer-Repository auch die Versionshinweise jedes Release, mit einem Job für `pager-translate`, sobald die Vorlage des Steuer-Repositorys ihn bringt; bis deine Kopie ihn hat, kommen die Überschriften der Versionshinweise in deiner Sprache, und ihre Punkte bleiben Englisch ([So arbeitet er](how-it-works.md#die-versionshinweise-in-deiner-sprache)). Eine Nachricht, die der Pager schon gezeigt hat, nimmt die neuen Worte, sobald sich ihre Sache ändert. Eine Änderung geht live, sobald sie auf dem `main` deiner Kopie ist, wie [Deine Kopie aktuell halten](#deine-kopie-aktuell-halten) sagt.

## Deine Kopie aktuell halten

Jedes Release von Repo Pager ist ein Tag `vX.Y.Z` dieses Repositorys, mit seinen Versionshinweisen auf der [Seite der Releases](https://github.com/Dennis-Otto/repo-pager/releases); *Watch*, *Custom* und *Releases* auf dieser Seite von GitHub sagen dir jedes an. Hol ein Release über sein Tag in den `main` deiner Kopie, in einem Checkout deiner Kopie:

```sh
git remote add upstream https://github.com/Dennis-Otto/repo-pager.git   # einmal
git switch main && git pull
git fetch upstream --tags
git merge --no-edit vX.Y.Z   # das Tag des Release
```

- **Das Tag, nie `main`:** Der `main` dieses Repositorys hält Änderungen, die noch kein Release hat. *Sync fork* auf GitHub mergt diesen `main`, also hol auch in einen Fork die Releases über ihre Tags.
- **Dein `wrangler.jsonc` bleibt deins:** Wo ein Release `wrangler.jsonc` neben einem deiner Werte ändert, hält der Merge dort mit einem Konflikt an. Behalte deine Werte aus [der Tabelle oben](#deine-kopie), den Namen deines Workers, die ID deines Namespace und deine Einstellungen, und übernimm alles andere, was das Release ändert, etwa eine neue Einstellung oder Bindung; dann `git add wrangler.jsonc` und `git commit --no-edit`.
- **Prüf es:** `npm ci --ignore-scripts && npm test` führt die Tests mit deinen Werten aus.
- **Was das Release von dir verlangt:** Seine Versionshinweise nennen jeden Schritt über den Code hinaus, etwa ein neues Recht oder Ereignis der GitHub-App, das du in den Einstellungen deiner App annimmst, oder ein neues Geheimnis des Workers.

Dann `git push`: Der Push auf `main` geht von selbst live, wenn Workers Builds deine Kopie mit `npx wrangler deploy` bereitstellt; ohne es führ jetzt `npx wrangler deploy` aus, wie [In einer Kopie des Pagers](releases.md#in-einer-kopie-des-pagers) in Releases und Cloudflare beschreibt. Eine Änderung deiner eigenen Werte in `wrangler.jsonc`, etwa `LANGUAGE` oder `LATER_HOURS`, geht genauso live, und `npx wrangler rollback` nimmt eine Version zurück, die sich danebenbenimmt. Dein Steuer-Repository folgt seiner Vorlage von selbst, mit den Pull Requests seines Workflows *Template* (Schritt 7).

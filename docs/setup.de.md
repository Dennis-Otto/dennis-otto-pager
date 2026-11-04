# Einrichten

Der Pager braucht einen Bot von Telegram, den Worker auf Cloudflare, eine GitHub-App und ein paar Geheimnisse. Diese Schritte dauern etwa eine halbe Stunde, mit den kostenlosen Tarifen von Cloudflare und Telegram, und nichts davon liegt in GitHub. Geh sie in dieser Reihenfolge durch: Jeder Schritt braucht den davor.

Führe die Befehle in Git Bash oder einer anderen Unix-Shell aus, in einem Checkout dieses Repositorys, nach `npm ci --ignore-scripts`. Lies ein Geheimnis mit `read -rs` ein, damit es nicht in der Historie der Shell landet.

## 1. Der Bot von Telegram

1. Schreib in Telegram `/newbot` an [@BotFather](https://t.me/BotFather) und gib dem Bot einen Namen und einen Benutzernamen, der auf `bot` endet. BotFather antwortet mit dem Token des Bots: Es ist ein Geheimnis.
2. Schreib dem neuen Bot irgendeine Nachricht, damit dein Chat mit ihm existiert.
3. Deine Chat-ID ist deine Nutzer-ID von Telegram, eine Zahl. [@userinfobot](https://t.me/userinfobot) nennt sie, oder der Bot selbst, sobald du ihm geschrieben hast:

    ```sh
    read -rs TOKEN   # das Token des Bots einfügen, dann Enter
    curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | grep -o '"chat":{"id":[0-9]*'
    ```

    Die Chat-ID ist persönlich: Sie gehört nicht ins Repository. Sie kommt in Schritt 3 als Geheimnis zu Cloudflare.

## 2. Der Worker auf Cloudflare

Leg den Worker mit seinem ersten Deployment an, wie [Releases and Cloudflare](releases.md#set-up-cloudflare-once) beschreibt, und verbinde dort das Repository mit Workers Builds:

```sh
npx wrangler login
npx wrangler deploy
```

Das erste Deployment legt auch den Namensraum von Workers KV an, der den Zustand des Pagers hält, und das Durable Object, das seine Änderungen nacheinander ausführt, und nennt die Adresse des Workers, etwa `https://dennis-otto-pager.ACCOUNT.workers.dev`. Bis Schritt 3 erledigt ist, beantwortet der Worker jeden Webhook mit `503`.

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
printf %s "$CONTROL_SECRET" | gh secret set PAGER_CONTROL_SECRET -R Dennis-Otto/dennis-otto-pager-control
```

**`GITHUB_USER_TOKEN`** handelt nur für zwei Knöpfe in deinem Namen: ✅ **Senden**, das eine Antwort postet, die du freigegeben hast, und 🤖 **Assistent nochmal**, das den Issue-Assistenten über seine Ein-Kommentar-Regel hinaus startet; der Issue-Assistent fragt GitHub nach der Rolle der Person, die ihn gestartet hat, und eine App hat keine. Leg ein [fein granuliertes Token](https://github.com/settings/personal-access-tokens/new) für dein Konto und deine Repositorys an, mit diesen Rechten und keinen anderen:

| Recht | Zugriff | Für |
| --- | --- | --- |
| Issues | Read and write | ✅ Senden bei einem Issue |
| Pull requests | Read and write | ✅ Senden bei einem Pull Request |
| Actions | Read and write | 🤖 Assistent nochmal |

```sh
npx wrangler secret put GITHUB_USER_TOKEN
```

Ohne es arbeitet der Pager auch, und diese zwei Knöpfe sagen, was fehlt.

## 4. Die GitHub-App

Die App schickt die Ereignisse deiner Repositorys an den Worker und merged ein Release mit ihren eigenen, eingeschränkten Tokens. `github-app.json` ist ihr Manifest, mit den geringsten Rechten, die der Pager braucht. Registriere sie mit der Adresse deines Workers:

```sh
node scripts/register-app.mjs https://dennis-otto-pager.ACCOUNT.workers.dev
```

Öffne die Adresse, die es ausgibt, in dem Browser, der bei GitHub angemeldet ist, und bestätige die App. Das Skript legt ihre App-ID, ihren privaten Schlüssel und das Geheimnis ihres Webhooks in die Geheimnisse des Workers, ohne Datei, und nennt die Seite, die sie installiert. **Installiere die App** auf den Repositorys, die der Pager beobachtet, **und auf `Dennis-Otto/dennis-otto-pager-control`**, wohin er die Entwürfe, die Fixes und den freien Text schickt.

Die App ist privat, nur dein Konto kann sie installieren. Ihre Rechte:

| Recht | Zugriff | Für |
| --- | --- | --- |
| Actions | Read | Ein Release-Workflow, der scheitert |
| Checks | Read | Ein Pflicht-Check, der auf `main` scheitert; ein Release, dessen Checks fertig sind |
| Code scanning alerts | Read | Ein Alarm mit Schweregrad high oder critical |
| Contents | Read and write | 🔀 Mergen eines Releases; die Ereignisse an das Steuer-Repository |
| Issues | Read | Ein neues Issue; ein Issue mit `bot-failure` |
| Metadata | Read | Verlangt GitHub; die Pflicht-Checks von `main` |
| Pull requests | Read | Ein neuer Pull Request; der Zustand eines Release-Pull-Requests |

## 5. Der Webhook von Telegram

Sag Telegram, wohin es die Updates schicken soll, mit dem Geheimnis aus Schritt 3:

```sh
curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d url=https://dennis-otto-pager.ACCOUNT.workers.dev/telegram \
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

Das private Repository `Dennis-Otto/dennis-otto-pager-control` entwirft die Antworten, startet die Fixes und beantwortet den freien Text, mit Claude Code und `CLAUDE_CODE_OAUTH_TOKEN` aus `claude setup-token`; seine README nennt jeden Schritt. Neben dem Token von Claude und `PAGER_CONTROL_SECRET` aus Schritt 3 braucht es die Adresse des Workers und für 🛠 **Fix starten** einen fein granulierten Token von dir für die beobachteten Repositorys, mit *Contents*, *Pull requests* und *Workflows* zum Lesen und Schreiben, der den Pull Request eines Fixes eröffnet:

```sh
gh variable set PAGER_URL -R Dennis-Otto/dennis-otto-pager-control --body https://dennis-otto-pager.ACCOUNT.workers.dev
gh secret set PAGER_FIX_TOKEN -R Dennis-Otto/dennis-otto-pager-control
```

Schreib dem Bot dann eine Frage, etwa *What fails on main?*: Das 👀 sagt, dass sie an das Steuer-Repository ging, und seine Antwort kommt in ein, zwei Minuten. Bis das Steuer-Repository eingerichtet ist, schicken seine Knöpfe ihre Ereignisse, und die Zusammenfassung seines Laufs zeigt die Antwort statt des Chats.

## Später

- **Das Token von Claude** im Steuer-Repository läuft ab; `CLAUDE_TOKEN_EXPIRES` in `wrangler.jsonc` nennt den Tag, und der Pager erinnert drei Wochen vorher. Erneuere es mit `claude setup-token` und `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R Dennis-Otto/dennis-otto-pager-control` und ändere dann den Tag in einem Pull Request.
- **Ein Geheimnis ist durchgesickert:** Setz ein neues mit `npx wrangler secret put NAME`; für die App erzeuge in ihren Einstellungen einen neuen privaten Schlüssel und setz `GITHUB_APP_PRIVATE_KEY`; für den Bot `/revoke` bei @BotFather, dann `TELEGRAM_BOT_TOKEN` und Schritt 5 noch einmal.
- **Wie lange „Später“ wartet**, steht in `LATER_HOURS` in `wrangler.jsonc`.
- **Die Sprache** des Pagers steht in `LANGUAGE` in `wrangler.jsonc`: `de` für Deutsch, `en` oder leer für Englisch. Sie bestimmt jeden Text, den der Pager schickt, und der Worker gibt sie jedem Job an das Steuer-Repository mit, dessen Antworten ihr folgen. Eine Nachricht, die der Pager schon gezeigt hat, nimmt die neuen Worte, sobald sich ihre Sache ändert. Nach einer Änderung stell den Worker neu bereit, wie [Releases and Cloudflare](releases.md) beschreibt.

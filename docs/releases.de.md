# Releases und Cloudflare

<!-- Each section keeps the anchor of its English heading as well, so that a link of a page that has no German version, such as a decision, leads here. -->

**Repo Pager** läuft auf [Cloudflare Workers](https://developers.cloudflare.com/workers/). Cloudflare baut ihn aus diesem Repository mit [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), und nur ein Release geht live: Kein Schlüssel von Cloudflare liegt in GitHub. Eine Kopie des Pagers, die eine eigene Instanz betreibt, geht stattdessen mit jedem Push auf ihren `main` live, wie [In einer Kopie des Pagers](#in-einer-kopie-des-pagers) beschreibt.

<a id="how-a-change-goes-live"></a>

## Wie eine Änderung live geht

| Was auf `main` geschieht | Was Cloudflare tut |
| --- | --- |
| Ein Pull Request wird gemergt | Workers Builds baut den Commit, und `npm run deploy` lädt ihn als Version ohne Traffic hoch, die das Dashboard mit ihrem Commit auflistet |
| Der Release-Pull-Request `chore: release X.Y.Z` wird gemergt | Workers Builds baut den Commit, und `npm run deploy` stellt ihn bereit: Version X.Y.Z geht live, getaggt als `vX.Y.Z` |
| Ein Push auf den `main` einer Kopie des Pagers, etwa der Merge eines Release dieses Repositorys oder eine Änderung ihrer `wrangler.jsonc` | Workers Builds baut den Commit, und sein Deploy-Befehl `npx wrangler deploy` stellt ihn bereit: Er geht live |

Ein Vorab-Release, etwa `chore: release 2.0.0-beta.1`, wird ebenfalls eine Version ohne Traffic, getaggt als `v2.0.0-beta.1`: Probier es aus oder roll es unter *Deployments* schrittweise aus, bevor das Release bereitgestellt wird.

Der Release-Workflow taggt denselben Commit als `vX.Y.Z` und veröffentlicht das Release auf GitHub, mit seinem Changelog, seinen SBOMs und der signierten Provenienz seines Builds, wie [SECURITY.md](https://github.com/Dennis-Otto/repo-pager/blob/main/SECURITY.md#verify-a-release) zeigt. So ist der Worker, der läuft, immer der Code des neuesten Release, und das Dashboard von Cloudflare nennt seine Version beim Tag dieses Release. `scripts/deploy-worker.sh`, das `npm run deploy` ausführt, entscheidet zwischen beiden: Es stellt nur einen Commit von `main` bereit, dessen Betreff das Release der Version in `package.json` nennt, und lädt jeden anderen nur hoch.

<a id="set-up-cloudflare-once"></a>

## Cloudflare einmal einrichten

Du brauchst ein Konto bei Cloudflare; der kostenlose Tarif betreibt einen Worker. Diese Schritte dauern etwa zehn Minuten, und nichts davon liegt in GitHub.

1. **Leg den Worker an,** mit seinem ersten Deployment, von deinem Rechner aus, der sich im Browser bei Cloudflare anmeldet und die Anmeldung dort behält:

    ```sh
    npm ci --ignore-scripts
    npx wrangler login
    npx wrangler deploy
    ```

    Der Worker bekommt den Namen aus `wrangler.jsonc`, den auch Workers Builds braucht: den, den du für deine Kopie gewählt hast, wie [Einrichten](setup.md) beschreibt, etwa `repo-pager`. Der eigene Worker des Maintainers behält den Namen, mit dem er angelegt wurde, `dennis-otto-pager`, da seine Geheimnisse und sein Zustand an ihm hängen.
2. **Verbinde das Repository:** Öffne im Dashboard von Cloudflare *Workers & Pages*, deinen Worker, *Settings* und *Builds*, und wähle *Connect*. Installiere die App *Cloudflare Workers and Pages* auf GitHub nur für dieses Repository, und wähle deine Kopie des Repositorys.
3. **Stell den Build so ein:**

    | Einstellung | Wert |
    | --- | --- |
    | Branch | `main` |
    | Build command | `npm ci --ignore-scripts` |
    | Build-Variable, unter *Variables and secrets* | `SKIP_DEPENDENCY_INSTALL` = `1`: Sonst installiert Cloudflare die Abhängigkeiten zuerst selbst, mit den Install-Skripten jedes Pakets, in dem einen Build, der bereitstellen kann; der Build command installiert sie ohne |
    | Deploy command | `npm run deploy`; in einer Kopie des Pagers `npx wrangler deploy`, warum, sagt [In einer Kopie des Pagers](#in-einer-kopie-des-pagers) |
    | Builds for non-production branches | aus: Die Checks jedes Pull Requests laufen in GitHub |
    | Root directory | leer, die Wurzel des Repositorys |

4. **Leg jedes Geheimnis des Workers in Cloudflare ab,** nie in das Repository:

    ```sh
    npx wrangler secret put NAME
    ```

    Das Dashboard hat sie auch unter *Settings* und *Variables and Secrets*. Für `npm run dev` auf deinem Rechner schreib sie in `.dev.vars`, das git ignoriert.

Von da an erreicht jeder Merge Cloudflare von selbst, und das Dashboard zeigt das Protokoll jedes Builds: Hier geht jedes Release live, und in einer Kopie jeder Push auf ihren `main`.

<a id="in-a-copy-of-the-pager"></a>

## In einer Kopie des Pagers

Jeder betreibt den Pager als eigene Instanz ([Entscheidung 0018](decisions/0018-the-pager-is-repo-pager-which-everyone-runs-as-an-instance-of-their-own.md), englisch), aus einer Kopie dieses Repositorys: einem Fork oder einem eigenen Repository, mit deinen Werten in `wrangler.jsonc`, wie *Deine Kopie* in [Einrichten](setup.md) beschreibt. `npm run deploy` stellt eine Kopie nicht bereit: Es stellt nur einen Commit bereit, dessen Betreff ein Release ist, `chore: release X.Y.Z`, und der Kopf des `main` einer Kopie ist nie einer. Deine Werte in `wrangler.jsonc` sind ein eigener Commit, ebenso der Merge jedes Release, das du hereinholst, während der Release-Workflow in einer Kopie kein Release veröffentlicht, da er die Release-App dieses Repositorys braucht. Mit `npm run deploy` lüde jeder Build einer Kopie nur eine Version ohne Traffic hoch, ohne einen Fehler.

Darum stellt eine Kopie jeden Push auf ihren `main` bereit, der sich nur ändert, wenn du ihn änderst ([Entscheidung 0024](decisions/0024-a-copy-of-the-pager-deploys-every-push-to-its-main.md), englisch):

- **Mit Workers Builds:** Verbinde deine Kopie wie in [Cloudflare einmal einrichten](#cloudflare-einmal-einrichten), mit dem Deploy command `npx wrangler deploy` in Schritt 3 und jeder anderen Einstellung wie dort. Dann gehen der Merge eines Release und eine Änderung von `wrangler.jsonc`, etwa ein neues `LANGUAGE` oder `LATER_HOURS`, von selbst live, eine Minute nach dem Push.
- **Von Hand:** Ohne Workers Builds führ nach jedem solchen Push `npx wrangler deploy` in einem Checkout deines `main` aus, angemeldet mit `npx wrangler login`.

So oder so stellt der Worker bereit, was dein `main` hat, mit deiner `wrangler.jsonc`, und jeder Merge dorthin geht live, auch der Pull Request eines Bots, der sich selbst merged, etwa einer von Renovate oder des Blueprints, wenn du sie in deiner Kopie einschaltest: Lass ihr Automerge dort aus, oder nimm hin, dass live geht, was sie mergen. Hol jedes Release über sein Tag herein, nie den `main` dieses Repositorys, der Änderungen hält, die noch kein Release hat: *Deine Kopie aktuell halten* in [Einrichten](setup.md) zeigt, wie. Eine Kopie lädt keine Versionen ohne Traffic hoch: Probier eine Änderung mit `npm run dev` aus, bevor du sie pushst, und roll zurück wie unten.

<a id="roll-back"></a>

## Zurückrollen

Ein Release, das sich danebenbenimmt, geht im Dashboard unter *Deployments* auf die Version davor zurück, oder mit:

```sh
npx wrangler rollback
```

Dann behebe die Ursache in einem Pull Request; das nächste Release stellt ihn bereit.

<a id="when-a-build-fails"></a>

## Wenn ein Build scheitert

Der Pager bemerkt ein Release, das nicht live ging, selbst: Sobald das Ereignis eines Releases seines eigenen Repositorys kam, vergleicht sein Zeitplan das Release mit der Version, die läuft, und nach 30 Minuten ohne es sagt er das einmal in einer eigenen Nachricht. Sein eigenes Repository ist das, das `repository.url` in `package.json` nennt, und die App des Pagers muss dort installiert sein: Eine Kopie nennt dort ihr eigenes Repository, sonst hört sie nie von ihren Releases, und `release` in ihrem Zustand bleibt `null`, was sich wie aktuell liest. `/status` zeigt die Version, die läuft, und der Zustand, nach dem das Steuer-Repository jeden Tag fragt, nennt sie mit dem Release, auf das er wartet ([Der Zustand des Pagers](how-it-works.md#der-zustand-des-pagers)). Das Protokoll des Builds im Dashboard von Cloudflare sagt, warum; die Ursachen sind diese:

- **Der Name passt nicht:** Workers Builds baut nur den Worker, dessen Namen `wrangler.jsonc` nennt. Setz den Namen in `wrangler.jsonc` auf den des Workers zurück: Ein Worker mit neuem Namen wäre ein neuer Worker, ohne die Geheimnisse und den Zustand des alten.
- **Kein Build, nachdem das Repository umbenannt oder verschoben wurde:** Das Dashboard listet keinen Build der Merges seither. Öffne *Workers & Pages*, den Worker, *Settings* und *Builds*, trenne das Repository und verbinde es unter seinem neuen Namen neu, mit den Einstellungen aus Schritt 3; die laufende Version dient solange weiter.
- **Ein anderes Node:** Der Build nimmt das Node aus `.nvmrc`; zeigt sein Protokoll ein anderes, setz unter *Settings* und *Builds* die Build-Variable `NODE_VERSION` auf die Version aus `.nvmrc`.
- **Ein Release, das nicht bereitgestellt wurde:** Das Protokoll seines Builds sagt, warum `npm run deploy` es nur hochgeladen hat, etwa eine `package.json` mit einer anderen Version als der Titel des Release oder ein Branch mit einem anderen Namen als `main`. *Retry build* baut denselben Commit noch einmal, sobald eine Einstellung von Cloudflare die Ursache war; `npx wrangler deploy` aus einem Checkout seines Tags stellt ihn von Hand bereit. In einer Kopie des Pagers führ `npx wrangler deploy` aus einem Checkout ihres eigenen `main` aus, nie aus einem Tag dieses Repositorys, dessen `wrangler.jsonc` den Worker des Maintainers und seinen Namensraum von Workers KV nennt.
- **Eine Änderung einer Kopie, die nicht live ging:** Das Protokoll ihres Builds zeigt `npm run deploy`, das in einer Kopie eine Version ohne Traffic hochlädt: Setz den Deploy command auf `npx wrangler deploy`, wie [In einer Kopie des Pagers](#in-einer-kopie-des-pagers) sagt, und wähle *Retry build*.
- **Eine Warnung zu `SKIP_DEPENDENCY_INSTALL`:** Die Build-Variable aus Schritt 3 fehlt, und Cloudflares eigene Installation hat die Install-Skripte der Pakete ausgeführt. Setz sie auf `1`.
- **`npm run deploy` auf deinem Rechner** verweigert: Es läuft nur in Workers Builds. `npx wrangler deploy` stellt von Hand bereit, am Release vorbei, für einen Notfall.

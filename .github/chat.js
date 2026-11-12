// Written by test/chat.test.ts from the texts of the pager; .github/chat.html draws it.
window.CHAT = {
  "en": {
    "alarm": {
      "title": "🚨 repo-blueprint needs you",
      "subtitle": "Repo Pager",
      "messages": [
        {
          "text": "🚨 <b>Dennis-Otto/repo-blueprint needs you</b>\n• <a>The release fails: Release</a>\n• <a>Socket Security fails on main</a>",
          "buttons": [
            [
              "🔁 Rerun",
              "🛠 Start fix"
            ],
            [
              "⏰ Later",
              "✖ Ignore"
            ]
          ],
          "time": "10:42"
        }
      ]
    },
    "contribution": {
      "title": "🙋 paperless-sync#316 Sync stops when a tag has a slash",
      "subtitle": "Repo Pager",
      "messages": [
        {
          "text": "🙋 <b>New issue</b> in <a>Dennis-Otto/paperless-sync</a> by <b>sam-lee</b>\n<a>#316 Sync stops when a tag has a slash</a>\n<blockquote expandable>Since 1.6.2 the sync stops at the first document with a tag like Tax/2026. The log says: invalid path.</blockquote>",
          "buttons": [
            [
              "✍️ Draft a reply",
              "🤖 Assistant again"
            ],
            [
              "⏰ Later",
              "✖ Ignore"
            ]
          ],
          "time": "08:31"
        },
        {
          "service": "The same message, a minute after ✍️ Draft a reply"
        },
        {
          "text": "🙋 <b>New issue</b> in <a>Dennis-Otto/paperless-sync</a> by <b>sam-lee</b>\n<a>#316 Sync stops when a tag has a slash</a>\n<blockquote expandable>Since 1.6.2 the sync stops at the first document with a tag like Tax/2026. The log says: invalid path.</blockquote>\n\n<b>Draft of a reply</b>, which \"Send\" posts in your name as it stands here:\n<blockquote>Thanks for the clear report, @sam-lee! A slash in a tag became a folder in the path; the fix is in #318 and comes with 1.7.1.</blockquote>",
          "buttons": [
            [
              "✅ Send",
              "✏️ Edit"
            ],
            [
              "⏰ Later",
              "✖ Ignore"
            ]
          ],
          "time": "edited 08:31"
        }
      ]
    },
    "release": {
      "title": "📦 paperless-sync 1.7.0",
      "subtitle": "Repo Pager",
      "messages": [
        {
          "text": "📦 <b>Release 1.7.0</b> of <a>Dennis-Otto/paperless-sync</a>: <a>#312</a>\n\n<b>Features</b>\n• Tags renamed in Paperless follow in Nextcloud (<a>#305</a>)\n• A share link for every synced document (<a>#309</a>)\n\nEvery check is green, and \"Merge\" publishes it.",
          "buttons": [
            [
              "🔀 Merge",
              "⏰ Later"
            ],
            [
              "✖ Ignore"
            ]
          ],
          "time": "09:15"
        }
      ]
    },
    "topics": {
      "title": "Repo Pager",
      "subtitle": "bot",
      "topics": [
        {
          "name": "🚨 repo-blueprint needs you",
          "color": "#fb6f5f",
          "last": "• Socket Security fails on main",
          "time": "10:42"
        },
        {
          "name": "📦 paperless-sync 1.7.0",
          "color": "#8eee98",
          "last": "Every check is green, and \"Merge\" publishes it.",
          "time": "09:15"
        },
        {
          "name": "🙋 paperless-sync#316 Sync stops when a tag has a slash",
          "color": "#6fb9f0",
          "last": "Since 1.6.2 the sync stops at the first document with a tag like Tax/2026. The log says: invalid path.",
          "time": "08:31"
        },
        {
          "name": "🤔 Decision: Which release goes first?",
          "color": "#cb86db",
          "last": "Which release goes first?",
          "time": "08:05"
        },
        {
          "name": "✅ 🔴 Links in issue-assistant",
          "color": "#fb6f5f",
          "last": "✅ Green again.",
          "time": "07:58"
        }
      ]
    }
  },
  "de": {
    "alarm": {
      "title": "🚨 repo-blueprint braucht dich",
      "subtitle": "Repo Pager",
      "messages": [
        {
          "text": "🚨 <b>Dennis-Otto/repo-blueprint braucht dich</b>\n• <a>Das Release scheitert: Release</a>\n• <a>Socket Security scheitert auf main</a>",
          "buttons": [
            [
              "🔁 Neu starten",
              "🛠 Fix starten"
            ],
            [
              "⏰ Später",
              "✖ Ignorieren"
            ]
          ],
          "time": "10:42"
        }
      ]
    },
    "contribution": {
      "title": "🙋 paperless-sync#316 Sync bricht bei einem Tag mit Schrägstrich ab",
      "subtitle": "Repo Pager",
      "messages": [
        {
          "text": "🙋 <b>Neues Issue</b> in <a>Dennis-Otto/paperless-sync</a> von <b>sam-lee</b>\n<a>#316 Sync bricht bei einem Tag mit Schrägstrich ab</a>\n<blockquote expandable>Seit 1.6.2 bricht der Sync beim ersten Dokument mit einem Tag wie Steuer/2026 ab. Im Log steht: invalid path.</blockquote>",
          "buttons": [
            [
              "✍️ Antwort entwerfen",
              "🤖 Assistent nochmal"
            ],
            [
              "⏰ Später",
              "✖ Ignorieren"
            ]
          ],
          "time": "08:31"
        },
        {
          "service": "Dieselbe Nachricht, eine Minute nach ✍️ Antwort entwerfen"
        },
        {
          "text": "🙋 <b>Neues Issue</b> in <a>Dennis-Otto/paperless-sync</a> von <b>sam-lee</b>\n<a>#316 Sync bricht bei einem Tag mit Schrägstrich ab</a>\n<blockquote expandable>Seit 1.6.2 bricht der Sync beim ersten Dokument mit einem Tag wie Steuer/2026 ab. Im Log steht: invalid path.</blockquote>\n\n<b>Entwurf einer Antwort</b>, den „Senden“ genau so in deinem Namen postet:\n<blockquote>Danke für den genauen Bericht, @sam-lee! Ein Schrägstrich im Tag wurde zum Ordner im Pfad; der Fix ist in #318 und kommt mit 1.7.1.</blockquote>",
          "buttons": [
            [
              "✅ Senden",
              "✏️ Bearbeiten"
            ],
            [
              "⏰ Später",
              "✖ Ignorieren"
            ]
          ],
          "time": "bearbeitet 08:31"
        }
      ]
    },
    "release": {
      "title": "📦 paperless-sync 1.7.0",
      "subtitle": "Repo Pager",
      "messages": [
        {
          "text": "📦 <b>Release 1.7.0</b> von <a>Dennis-Otto/paperless-sync</a>: <a>#312</a>\n\n<b>Neue Funktionen</b>\n• In Paperless umbenannte Tags folgen in Nextcloud (<a>#305</a>)\n• Ein Freigabelink für jedes synchronisierte Dokument (<a>#309</a>)\n\nAlle Checks sind grün, und „Mergen“ veröffentlicht es.",
          "buttons": [
            [
              "🔀 Mergen",
              "⏰ Später"
            ],
            [
              "✖ Ignorieren"
            ]
          ],
          "time": "09:15"
        }
      ]
    },
    "topics": {
      "title": "Repo Pager",
      "subtitle": "Bot",
      "topics": [
        {
          "name": "🚨 repo-blueprint braucht dich",
          "color": "#fb6f5f",
          "last": "• Socket Security scheitert auf main",
          "time": "10:42"
        },
        {
          "name": "📦 paperless-sync 1.7.0",
          "color": "#8eee98",
          "last": "Alle Checks sind grün, und „Mergen“ veröffentlicht es.",
          "time": "09:15"
        },
        {
          "name": "🙋 paperless-sync#316 Sync bricht bei einem Tag mit Schrägstrich ab",
          "color": "#6fb9f0",
          "last": "Seit 1.6.2 bricht der Sync beim ersten Dokument mit einem Tag wie Steuer/2026 ab. Im Log steht: invalid path.",
          "time": "08:31"
        },
        {
          "name": "🤔 Entscheidung: Welches Release geht zuerst?",
          "color": "#cb86db",
          "last": "Welches Release geht zuerst?",
          "time": "08:05"
        },
        {
          "name": "✅ 🔴 Links in issue-assistant",
          "color": "#fb6f5f",
          "last": "✅ Wieder grün.",
          "time": "07:58"
        }
      ]
    }
  }
};

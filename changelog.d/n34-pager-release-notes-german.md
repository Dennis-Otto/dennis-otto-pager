### Features

- A pager in German shows the notes of a release in German: the headings of the kinds of change at once, such as *Neue Funktionen* for *Features*, and the items once the control repository translated them with your Claude subscription, which edits the message in place without a second notification. Links such as #791, scopes such as `deps:` and names of code stay as they are, and a failed or slow translation leaves the English. The control repository needs the job for `pager-translate` from its template for the items.

### Bug fixes

- The topic of a release follows its version and gets its ✅ even when Telegram refused the rename at the moment: the schedule tries a refused rename again for a day, so a topic no longer keeps the name of an older version, such as *📦 repo-blueprint 1.15.1* above the message of 1.16.0.

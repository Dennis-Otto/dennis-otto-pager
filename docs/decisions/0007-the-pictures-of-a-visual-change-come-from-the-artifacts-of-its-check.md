# The pictures of a visual change come from the artifacts of its check

- Status: accepted
- Date: 2026-11-08

## Context

The repositories of the maintainer whose pictures show their app run a visual check on each pull request that changes what the pictures show: their `visual.yml` renders every picture again and keeps each one that looks different in an artifact of its run, before and after, with a report of how much each changed; a second workflow comments the list on the pull request. Most of these pull requests come from agents and bots under the maintainer's account, and he reads them on his phone, where the comment is a click, the artifact a ZIP and the pictures another app. In his Q&A of 2026-11-07 he decided that the pager shows the before and after pictures of such a change, few and small, with a link to the pull request, at most one album per head, without new secrets and without flooding him.

The pictures exist in two places: the artifact of the check, which holds both sides, and the repository, which holds only the committed side. The comment of the check holds no picture. GitHub hands out an artifact as a ZIP behind a redirect to its storage, signed for a minute, to a token with `actions: read`, which the app of the pager already has for 🔁 Rerun. The reports of the repositories differ a little: one artifact `visual` or one per language, the list `pictures` or `images`, a picture new or added, its files named in its entry or found by its path.

## Options

1. **Pictures by address,** which Telegram fetches itself, such as those of `raw.githubusercontent.com`. No download, but only the committed side has an address, and a private repository has none.
2. **A step in each visual check** that sends the album, or uploads its pictures one by one. Each repository would need the token of the bot as a secret, and a workflow that runs the code of a pull request would hold it.
3. **The Worker reads the artifacts** with a token of its app: it lists the artifacts of the run whose check passed, follows the redirect to the storage without its token, reads each ZIP in memory and inflates only its report and the pictures of the album, natively with `DecompressionStream`.

## Decision

Option 3. A small reader of ZIP files in `src/zip.ts` checks every length against the file, refuses ZIP64 and encryption, and never inflates a file to more than the size that its directory gives it; the artifacts of a run are read up to 32 MB together, and the rest stays unread. The pager reads every report form of the fleet, takes the largest changes first and sends at most three pictures, before and after, as one album: PNG or WebP files of at most 5 MB, of a size that Telegram takes as a photo, so that a GIF, a video and a larger file stay behind the link to the run of the check.

Only a pull request of the maintainer or of a bot gets its pictures, at the head that the check rendered, from a branch of the repository itself: what someone else's pull request renders is theirs, and it never reaches the chat. The pictures go into the topic of the thing of the pull request: the release that the pager shows, below a message of their own so that its message keeps 🔀 Merge, or a thing of their own, with ✖ Ignore, which the merge or the close of the pull request ticks off. The thing keeps the head whose album went, so a check that runs again at the same head sends nothing, and a pull request whose pictures never changed sends nothing at all.

## Consequences

The maintainer sees a visual change in the topic of its pull request, without a click, and a text that he writes there goes to the control repository with the pull request as its thing. Each visual check that passes on a pull request of his costs one call for the pull request, one for the list of artifacts and a download per artifact, a few MB at most, held in memory for the one request; only the list that the message shows goes into Workers KV, with one write per head that changed pictures and one when the pull request closes. A repository whose visual check keeps its artifact under another name, or a report in another form, gets no pictures until the pager reads it: `ARTIFACT` and `readReport` of `src/pictures.ts` are the places to teach it.

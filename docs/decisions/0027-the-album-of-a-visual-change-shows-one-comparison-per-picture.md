# The album of a visual change shows one comparison per picture, of one frame

- Status: accepted
- Date: 2026-11-13

## Context

[Decision 0016](0016-the-album-of-a-visual-change-shows-the-changed-pixels-first.md) gave each changed picture of the album three photos: the picture of its difference first, then before and after. On 2026-11-13 the maintainer sent screenshots of the album of homedarts-for-autodarts#716, of `de/setup.webp`, an animation that changed in 0.66 % of its pixels, and wrote that the comparison was of no use to him: the changed picture looked like another one, with step 4 in its corner, while before and after showed step 1. The visual check draws the difference of the pair of frames with the most changed pixels, and the artifact holds the whole animation for each side, of which Telegram shows the first frame as a photo. Nothing in the captions said which frame the difference was of. Even for a picture that isn't an animation, a change of a few pixels can't be found between two whole pictures on a phone.

## Options

1. **Captions only:** say in the caption of the difference which frame it shows. The sides still show another frame, so the three photos still don't fit together.
2. **The pager cuts the frame out of the sides:** decode the WebP in the Worker, pick the frame and crop it. A decoder of WebP, APNG and GIF in a Worker is large, slow and a new surface for the files of a pull request.
3. **The check draws one comparison, the pager shows it:** the visual check of the blueprint (Dennis-Otto/repo-blueprint#882) writes for each changed picture a PNG of the place of the change before and after in one picture, of the same frame, the changes framed in red, and names it in the report as `comparison`, with `frame` (from 1) and `frames`. The pager sends it alone, with a caption that names the picture, how much of it changed and, for an animation, the frame.

## Decision

Option 3. A changed picture whose entry names a `comparison` that goes as a photo shows that one photo, with the caption *🔍 Before and after, frame 4 of 7: `de/setup.webp`, changed, 0.66 % of its pixels*, or without the frame for a picture of one frame. `frame` counts only as a whole number from 1 up to `frames`.

A report without a comparison, as an older blueprint writes it, keeps the order of decision 0016, but an animation shows its difference alone, with the caption *🔴 Changed pixels, frame 4 of 7* when the report names the frame, or *🔴 Changed pixels of one frame of the animation* when it doesn't, instead of the first frame of each side beside it. The pager knows an animation by the `frames` of the report, or else by the headers of the file after: a WebP with the flag of an animation, an APNG with `acTL` before its first `IDAT`, or a GIF of more than one image, read only within the size of a photo. A comparison that is missing, broken or too large leaves the picture to the difference and its sides.

The album no longer counts pictures but photos: it takes the largest changes in their order as long as their photos fit into the ten of an album of Telegram, so it holds up to ten pictures with a comparison each, still three with a difference, before and after, and stops at the first that no longer fits, so that it always shows the largest changes.

## Consequences

On a phone one look at one photo tells where a picture changed and how it looked before and after, of the same frame, and the caption says which frame and how much. More changed pictures fit into one album. How the comparison looks is the visual check's: the pager shows what the report gives, so a better picture reaches the album with the next release of the blueprint and needs no release of the pager. Until a repository has that release, its album shows the difference of an animation alone, which no longer contradicts the photos beside it.

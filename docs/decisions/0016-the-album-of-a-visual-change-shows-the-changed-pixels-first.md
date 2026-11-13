# The album of a visual change shows the changed pixels first, and promises red only when it has them

- Status: accepted, amended by [0027](0027-the-album-of-a-visual-change-shows-one-comparison-per-picture.md): a picture with a comparison shows it alone, and an animation shows its difference without the first frame of each side
- Date: 2026-11-08

## Context

The album of a visual change ([decision 0007](0007-the-pictures-of-a-visual-change-come-from-the-artifacts-of-its-check.md)) sent each picture before and after, and its message linked the run of the check as *All of them before and after, each changed pixel in red*. On 2026-11-08 the maintainer sent a screenshot of such a message, of three pictures of paperless-unified-search that changed 8.16 %, 0.11 % and the size or the frames of their pixels, and wrote that he saw no red pixel, and that it wasn't the first time. Both halves of the promise failed:

- The album never held a picture of the difference: it sent the sides of each picture and nothing else.
- The visual checks of the fleet drew a difference only for a PNG, at `diff/<path>`, and paperless-unified-search has no PNG among its pictures, so its artifacts never held a red pixel. homedarts-for-autodarts draws one for PNG and WebP as well, and names it as `difference` in its report.

With a coming release of the blueprint, its `keep` draws the difference of every picture whose size and frames stayed, for WebP and GIF as well, as a PNG at `diff/<path>`, `.png` added unless the path ends in it, names it as `diff` in its entry, and marks a small change so that it stays visible scaled down to the width of a phone. The checks of the repositories take it over in packages of their own.

## Options

1. **The link alone:** keep the album as it is and say in the link where the differences are. The maintainer still opens a ZIP in another app to see what changed, which is what the album is for, and a change of a few pixels hides between two pictures that look the same.
2. **The difference instead of before and after:** one photo per picture, so up to ten pictures fit into an album. The red shows where something changed, but not what it looked like, and the album would no longer answer whether the new picture is right.
3. **The difference first, then before and after:** up to three photos per picture, three pictures at most, nine photos within the ten of an album of Telegram; a picture whose own files can't be a photo, such as a GIF, shows its difference alone, which is a PNG.

## Decision

Option 3. For each picture that changed, the pager takes the file of its difference that its entry names, as `diff` or as `difference`, each checked as a plain path as `before` and `after` are, or for a PNG whose share is a number its path in `diff/`, where the checks of PNG files wrote it before they named it. When the artifact holds it as a photo that Telegram takes, it comes first, with the caption *🔴 Changed pixels*, then before and after; a difference that is missing, broken or too large leaves the picture with its sides, and a GIF with a difference is one of the pictures that the album shows, ordered by how much it changed, instead of one behind every photo. `MAX_ALBUM` stays three, so an album holds nine photos at most, which a test keeps within `MAX_MEDIA`, the ten of `sendMediaGroup`.

The link promises red only when the artifacts hold the difference of at least one picture, *All of them before and after, each changed pixel in red*; otherwise it says *All of them before and after*. The thing of the pictures keeps how many differences there were, so that its message, edited later, says the same; a record from before has none and promises no red.

## Consequences

The maintainer sees in the album where a picture changed and how it looked before and after, without opening the artifact, and a message never again promises red that isn't there. An album of a repository whose check draws no difference yet looks as before, with the plain link. Each difference costs one more photo of at most 5 MB in the memory of the request and in the upload to Telegram, three at most per album. A check that keeps its difference under another key gets none until `differenceOf()` of `src/pictures.ts` reads it.

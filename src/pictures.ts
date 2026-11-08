/**
 * The pictures of a visual change: what the artifacts of the visual check of a pull
 * request hold, and the few that go to the chat as an album: the changed pixels in
 * red, before and after.
 *
 * The visual check of a repository (its visual.yml) renders its pictures again and
 * keeps each one that looks different in an artifact, `visual` or one per language
 * such as `visual-en`: as committed and as rendered, and their list in report.json,
 * with the share of the pixels that changed, and for a picture that changed, the
 * picture of its difference, each changed pixel in red. The reports of the
 * repositories differ a little: the list is `pictures` or `images`, a picture is new
 * or added, deleted or removed, its files are before/ and after/ with its path, or
 * named in its entry, and its difference is named as `diff` or `difference`, or is
 * diff/ with the path of a PNG. The pager reads them all, checks each entry as the
 * comments of the checks do, and takes the largest changes that Telegram shows as
 * photos.
 */
import { html } from "./render.ts";
import type { Changed } from "./store.ts";
import type { Photo } from "./telegram.ts";
import type { Texts } from "./texts.ts";
import { Zip } from "./zip.ts";

/** The names of the artifacts of a visual check: one, or one per language. */
export const ARTIFACT = /^visual(?:-[a-z]{2})?$/;
/** The artifacts of one run that the pager reads at most. */
export const MAX_ARTIFACTS = 4;
/** The bytes of the artifacts of a run that the pager reads at most, together: those of the visual checks take a few MB. */
export const MAX_ARTIFACT = 32 * 1024 * 1024;
/** The largest report of a visual check that the pager reads. */
export const MAX_REPORT = 256 * 1024;
/**
 * The pictures of an album at most, each with its difference, before and after: few,
 * as the chat wants them, and with three photos each within the MAX_MEDIA of Telegram.
 */
export const MAX_ALBUM = 3;
/** The largest file that goes as a photo; Telegram takes 10 MB. */
export const MAX_PHOTO = 5 * 1024 * 1024;
/** The pictures that a message lists at most; the artifacts have them all. */
export const MAX_LISTED = 10;

/** The words of the reports for how a picture changed. */
const STATUSES: Readonly<Record<string, Changed["status"]>> = {
  changed: "changed",
  new: "new",
  added: "new",
  deleted: "deleted",
  removed: "deleted",
};
/** A path of plain names inside the repository or the artifact, as the checks let through. */
const PATH = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9_.][A-Za-z0-9._/-]*$/;
const LONGEST_PATH = 300;

/** A picture of a report, with the files of the artifact that hold it, before and after. */
export interface Reported extends Changed {
  before: string | null;
  after: string | null;
  /** The file of its difference, each changed pixel in red, if the artifact has it. */
  diff: string | null;
}

function plainPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= LONGEST_PATH &&
    PATH.test(value)
  );
}

/**
 * The file of a side of a picture: the one that its entry names, or that of its
 * path in before/ or after/; none for the side before a new picture or after a
 * deleted one.
 */
function fileOf(
  side: "before" | "after",
  status: Changed["status"],
  named: unknown,
  path: string,
): string | null {
  if (status === (side === "before" ? "new" : "deleted")) {
    return null;
  }
  return plainPath(named) ? named : `${side}/${path}`;
}

/**
 * The file of the difference of a picture that changed: the one that its entry names,
 * as `diff` or as `difference`, or for a PNG whose share is a number, its path in
 * diff/, where the checks of PNG files wrote it before they named it. None for a new
 * picture and a deleted one, which have one side only.
 */
function differenceOf(
  entry: Record<string, unknown>,
  status: Changed["status"],
  share: number | null,
  path: string,
): string | null {
  if (status !== "changed") {
    return null;
  }
  const named = [entry.diff, entry.difference].find(plainPath);
  if (named !== undefined) {
    return named;
  }
  return share !== null && path.endsWith(".png") ? `diff/${path}` : null;
}

/**
 * The pictures that a report of a visual check names, each checked as the comments
 * of the checks do: a path of plain names, a known status and a share between 0
 * and 1 or none. An entry that doesn't check out is left out; null for a text that
 * is no report.
 */
export function readReport(text: string): Reported[] | null {
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return null;
  }
  const { pictures, images } = (report ?? {}) as Record<string, unknown>;
  const list = pictures ?? images;
  if (!Array.isArray(list)) {
    return null;
  }
  return list.flatMap((picture: unknown): Reported[] => {
    const entry = (picture ?? {}) as Record<string, unknown>;
    const { path, share } = entry;
    const status = STATUSES[String(entry.status)];
    const known =
      share === null || (typeof share === "number" && share >= 0 && share <= 1);
    if (!plainPath(path) || status === undefined || !known) {
      return [];
    }
    return [
      {
        path,
        status,
        share,
        before: fileOf("before", status, entry.before, path),
        after: fileOf("after", status, entry.after, path),
        diff: differenceOf(entry, status, share, path),
      },
    ];
  });
}

/** A file that may be a photo, by its name: one of another kind is never read. */
const PHOTO_FILE = /\.(?:png|webp)$/i;

/** A picture to put in order: how it changed, and the file of its difference, if any. */
type Ordered = Changed & { diff?: string | null };

/**
 * How much a picture changed, for the order of the album: the share of its pixels,
 * all of it for a new one and one of another size or frames, and nothing for one
 * that is gone, which shows only what was. A picture that can't be a photo, neither
 * its file nor its difference, such as a video, comes after all of them, so that
 * the list starts with what the album shows; a GIF with its difference doesn't.
 */
function weight(picture: Ordered): number {
  const photos = [picture.path, picture.diff ?? ""];
  if (!photos.some((name) => PHOTO_FILE.test(name))) {
    return -1;
  }
  return picture.status === "deleted" ? 0 : (picture.share ?? 1);
}

/** The pictures, the largest change first; the same changes keep their order. */
export function largestFirst<T extends Ordered>(pictures: readonly T[]): T[] {
  return [...pictures].sort((one, other) => weight(other) - weight(one));
}

/** The first bytes of a PNG: its signature, and the length and type of its header IHDR. */
const PNG_START = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52,
];
/** Telegram's limits of a photo: width and height together, and how much longer than wide. */
const MAX_SIDES = 10000;
const MAX_RATIO = 20;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * The width and height of a WebP, from the header of its first chunk: VP8X of an
 * extended one, VP8L of a lossless one and "VP8 " of a lossy one.
 */
function webpSize(bytes: Uint8Array, view: DataView): [number, number] | null {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") {
    return null;
  }
  const u24 = (at: number) =>
    view.getUint16(at, true) + view.getUint8(at + 2) * 65536;
  switch (ascii(bytes, 12, 16)) {
    case "VP8X":
      return [1 + u24(24), 1 + u24(27)];
    case "VP8L": {
      const bits = view.getUint32(21, true);
      return bytes[20] === 0x2f
        ? [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)]
        : null;
    }
    case "VP8 ":
      return [
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      ];
    default:
      return null;
  }
}

/**
 * The type of the bytes as a photo, if Telegram takes them as one: a PNG or a WebP
 * of at most MAX_PHOTO bytes, whose width and height make at most 10000 pixels
 * together, the one at most 20 times the other.
 */
export function photoType(bytes: Uint8Array): Photo["type"] | null {
  if (bytes.length < 30 || bytes.length > MAX_PHOTO) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = PNG_START.every((byte, index) => bytes[index] === byte);
  const size: [number, number] | null = png
    ? [view.getUint32(16), view.getUint32(20)]
    : webpSize(bytes, view);
  if (size === null) {
    return null;
  }
  const [width, height] = size;
  const fits =
    width > 0 &&
    height > 0 &&
    width + height <= MAX_SIDES &&
    Math.max(width, height) <= MAX_RATIO * Math.min(width, height);
  if (!fits) {
    return null;
  }
  return png ? "image/png" : "image/webp";
}

/** The sides of a picture that its album shows, with the caption of each. */
const SIDES = {
  changed: [
    ["before", "caption.before"],
    ["after", "caption.after"],
  ],
  new: [["after", "caption.new"]],
  deleted: [["before", "caption.deleted"]],
} as const;

/** The pictures of one artifact: each that looks different, and the ZIP that holds them. */
export interface Artifact {
  zip: Zip;
  changed: Reported[];
}

/**
 * Read the ZIP of an artifact of a visual check: its report. Null when it holds
 * no report that the pager reads, such as a ZIP that is broken.
 */
export async function readArtifact(
  bytes: Uint8Array,
): Promise<Artifact | null> {
  try {
    const zip = new Zip(bytes);
    const entry = zip.get("report.json");
    if (entry === undefined || entry.size > MAX_REPORT) {
      return null;
    }
    const changed = readReport(new TextDecoder().decode(await zip.read(entry)));
    return changed === null ? null : { zip, changed };
  } catch (error) {
    // Such as a ZipError of a broken ZIP: no pictures then, and the log says why.
    console.warn(`An artifact of the visual check: ${String(error)}`);
    return null;
  }
}

/** A file of the ZIP as a photo with its caption, or null when it can't go as one. */
async function photo(
  zip: Zip,
  name: string,
  caption: string,
): Promise<Photo | null> {
  const entry = PHOTO_FILE.test(name) ? zip.get(name) : undefined;
  if (entry === undefined || entry.size > MAX_PHOTO) {
    return null;
  }
  const bytes = await zip.read(entry).catch(() => null);
  const type = bytes === null ? null : photoType(bytes);
  return bytes === null || type === null ? null : { bytes, type, caption };
}

/** The path of a picture in its caption. */
function captioned(picture: Changed): { path: string } {
  return { path: `<code>${html(picture.path)}</code>` };
}

/** The photos of the sides of a picture, or none when one of them can't go. */
async function sidesOf(
  zip: Zip,
  picture: Reported,
  t: Texts,
): Promise<Photo[]> {
  const photos: Photo[] = [];
  for (const [side, caption] of SIDES[picture.status]) {
    // The sides that SIDES lists for a status are those that have a file.
    const name = picture[side] as string;
    const one = await photo(zip, name, t(caption, captioned(picture)));
    if (one === null) {
      return [];
    }
    photos.push(one);
  }
  return photos;
}

/**
 * The photos of a picture: the picture of its difference first, each changed pixel
 * in red, when the artifact has one that goes as a photo, then its sides when each
 * of them goes. A GIF, whose sides can't, shows its difference alone, and a
 * difference that is broken or too large leaves the sides alone.
 */
async function photosOf(
  zip: Zip,
  picture: Reported,
  t: Texts,
): Promise<Photo[]> {
  const difference =
    picture.diff === null
      ? null
      : await photo(zip, picture.diff, t("caption.diff", captioned(picture)));
  const sides = await sidesOf(zip, picture, t);
  return difference === null ? sides : [difference, ...sides];
}

/** What the artifacts of a visual check show. */
export interface Album {
  /** Every picture that looks different, the largest change first. */
  changed: Changed[];
  /**
   * The photos of the album: the largest changes that Telegram shows, each with the
   * picture of its difference first, then before and after.
   */
  photos: Photo[];
  /** How many pictures the album shows. */
  shown: number;
  /** How many pictures the artifacts hold the difference of, each changed pixel in red. */
  differences: number;
}

/**
 * The pictures of the artifacts of a visual check, the largest change first, and
 * the album of the largest changes that Telegram shows, at most MAX_ALBUM.
 */
export async function album(
  artifacts: readonly Artifact[],
  t: Texts,
): Promise<Album> {
  const all = largestFirst(
    artifacts.flatMap(({ zip, changed }) =>
      changed.map((picture) => ({ ...picture, zip })),
    ),
  );
  const photos: Photo[] = [];
  let shown = 0;
  for (const picture of all) {
    if (shown === MAX_ALBUM) {
      break;
    }
    const its = await photosOf(picture.zip, picture, t);
    if (its.length > 0) {
      photos.push(...its);
      shown += 1;
    }
  }
  return {
    changed: all.map(({ path, status, share }) => ({ path, status, share })),
    photos,
    shown,
    differences: all.filter(
      ({ zip, diff }) => diff !== null && zip.get(diff) !== undefined,
    ).length,
  };
}

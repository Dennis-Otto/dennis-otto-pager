/**
 * The pictures of a visual change: what the artifacts of the visual check of a pull
 * request hold, and the few that go to the chat as an album, before and after.
 *
 * The visual check of a repository (its visual.yml) renders its pictures again and
 * keeps each one that looks different in an artifact, `visual` or one per language
 * such as `visual-en`: as committed and as rendered, and their list in report.json,
 * with the share of the pixels that changed. The reports of the repositories differ
 * a little: the list is `pictures` or `images`, a picture is new or added, deleted
 * or removed, and its files are before/ and after/ with its path, or named in its
 * entry. The pager reads them all, checks each entry as the comments of the checks
 * do, and takes the largest changes that Telegram shows as photos.
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
/** The pictures of an album at most, each before and after: few, as the chat wants them. */
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
      },
    ];
  });
}

/**
 * How much a picture changed, for the order of the album: the share of its pixels,
 * all of it for a new one and one whose size changed, and nothing for one that is
 * gone, which shows only what was.
 */
function weight(picture: Changed): number {
  return picture.status === "deleted" ? 0 : (picture.share ?? 1);
}

/** The pictures, the largest change first; the same changes keep their order. */
export function largestFirst<T extends Changed>(pictures: readonly T[]): T[] {
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

/** A file that may be a photo, by its name: one of another kind is never read. */
const PHOTO_FILE = /\.(?:png|webp)$/i;

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

/** The photos of a picture, each side of it, or null when one of them can't go. */
async function photosOf(
  zip: Zip,
  picture: Reported,
  t: Texts,
): Promise<Photo[] | null> {
  const photos: Photo[] = [];
  for (const [side, caption] of SIDES[picture.status]) {
    // The sides that SIDES lists for a status are those that have a file.
    const name = picture[side] as string;
    const entry = PHOTO_FILE.test(name) ? zip.get(name) : undefined;
    if (entry === undefined || entry.size > MAX_PHOTO) {
      return null;
    }
    const bytes = await zip.read(entry).catch(() => null);
    const type = bytes === null ? null : photoType(bytes);
    if (bytes === null || type === null) {
      return null;
    }
    photos.push({
      bytes,
      type,
      caption: t(caption, { path: `<code>${html(picture.path)}</code>` }),
    });
  }
  return photos;
}

/** What the artifacts of a visual check show. */
export interface Album {
  /** Every picture that looks different, the largest change first. */
  changed: Changed[];
  /** The photos of the album: the largest changes that Telegram shows, before and after. */
  photos: Photo[];
  /** How many pictures the album shows. */
  shown: number;
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
    const sides = await photosOf(picture.zip, picture, t);
    if (sides !== null) {
      photos.push(...sides);
      shown += 1;
    }
  }
  return {
    changed: all.map(({ path, status, share }) => ({ path, status, share })),
    photos,
    shown,
  };
}

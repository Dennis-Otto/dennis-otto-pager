// The pictures of a visual change: what the pager reads of the artifact of the
// visual check, the album that it sends, and the thing of the pull request, from
// its first head to its end.
import { describe, expect, it, vi } from "vitest";

import { press } from "../src/actions.ts";
import { allowed } from "../src/buttons.ts";
import { GitHubError } from "../src/github.ts";
import { apply } from "../src/pager.ts";
import {
  album,
  largestFirst,
  MAX_ALBUM,
  MAX_PHOTO,
  photoType,
  readArtifact,
  readReport,
} from "../src/pictures.ts";
import { picturesText } from "../src/render.ts";
import type { Signal } from "../src/rules.ts";
import {
  type Changed,
  type Item,
  itemId,
  keys,
  type Pictures,
  type Release,
} from "../src/store.ts";
import {
  MAX_MEDIA,
  type Photo,
  Telegram,
  TelegramError,
} from "../src/telegram.ts";
import { type Texts, texts } from "../src/texts.ts";
import { about, topicName } from "../src/topics.ts";
import {
  json,
  REPO,
  START,
  type World,
  withDeletedTopic,
  withTopics,
  world,
} from "./helpers.ts";
import { artifact, png, report, webp, zip } from "./zips.ts";

const en = texts("en");
const de = texts("de");
const SHA = "a1b2c3d4e5f60718293a";
const STORAGE = "https://storage.example/artifact.zip?sig=x";
const ARTIFACTS = `/repos/${REPO}/actions/runs/31/artifacts?per_page=100`;
const CHECK = `https://github.com/${REPO}/actions/runs/31`;

/** The pictures of artifacts as the pager shows them: what changed, and the album. */
async function read(bytes: Uint8Array[], t: Texts = en) {
  const found = await Promise.all(bytes.map((each) => readArtifact(each)));
  return album(
    found.flatMap((each) => (each === null ? [] : [each])),
    t,
  );
}

const signal = (sha = SHA): Signal => ({
  repo: REPO,
  installation: 9,
  type: "pictures",
  number: 8,
  sha,
  run: 31,
});

const changes = [
  { path: "screenshots/small.png", status: "changed", share: 0.0002 },
  { path: "docs/images/demo.gif", status: "changed", share: 0.5 },
  { path: "screenshots/large.png", status: "changed", share: 0.25 },
  { path: "screenshots/added.png", status: "new", share: null },
];

interface Pull {
  sha?: string;
  user?: object;
}

/**
 * A world in which the pull request #8 of the maintainer is open at a head, and
 * the visual check of run 31 kept this artifact.
 */
async function withArtifact(
  bytes: Uint8Array,
  { sha = SHA, user = { login: "Dennis-Otto", type: "User" } }: Pull = {},
  topics = true,
): Promise<World> {
  const w = await world();
  if (topics) {
    withTopics(w.net);
  }
  w.net
    .on("GET", `/repos/${REPO}/pulls/8`, () =>
      json({
        number: 8,
        state: "open",
        title: "Make the <button> blue",
        html_url: `https://github.com/${REPO}/pull/8`,
        user,
        head: { sha, repo: { full_name: REPO } },
      }),
    )
    .on("GET", ARTIFACTS, () =>
      json({
        artifacts: [
          { id: 54, name: "visual", size_in_bytes: 10, expired: true },
          { id: 53, name: "visual-failure-en-1", size_in_bytes: 10 },
          { id: 55, name: "visual", size_in_bytes: bytes.length },
        ],
      }),
    )
    .on(
      "GET",
      `/repos/${REPO}/actions/artifacts/55/zip`,
      () => new Response(null, { status: 302, headers: { location: STORAGE } }),
    )
    .on("GET", STORAGE, () => new Response(bytes as Uint8Array<ArrayBuffer>));
  return w;
}

async function stored(w: World, key: string): Promise<Item | null> {
  return w.context.store.get(await itemId(key));
}

/** The media of the one album that went, as its form names them. */
function media(w: World): { media: string; caption: string }[] {
  const [album] = w.net.telegram("sendMediaGroup");
  return JSON.parse(album?.body.media);
}

describe("the report of a visual check", () => {
  it("names each picture that looks different, checked as the comments of the checks do", () => {
    expect(
      readReport(
        report([
          { path: "screenshots/a.png", status: "changed", share: 0.5 },
          { path: "screenshots/b.png", status: "new", share: null },
          { path: "screenshots/c.png", status: "deleted", share: null },
          null,
          { path: 7, status: "changed", share: 0 },
          { path: "x".repeat(301), status: "new", share: null },
          { path: "../secret.png", status: "new", share: null },
          { path: "a.png", status: 1, share: 0 },
          { path: "a.png", status: "renamed", share: 0 },
          { path: "a.png", status: "changed", share: 2 },
          { path: "a.png", status: "changed", share: -1 },
          { path: "a.png", status: "changed", share: "half" },
          { path: "a.png", status: "changed" },
        ]),
      ),
    ).toEqual([
      {
        path: "screenshots/a.png",
        status: "changed",
        share: 0.5,
        before: "before/screenshots/a.png",
        after: "after/screenshots/a.png",
        diff: "diff/screenshots/a.png",
      },
      {
        path: "screenshots/b.png",
        status: "new",
        share: null,
        before: null,
        after: "after/screenshots/b.png",
        diff: null,
      },
      {
        path: "screenshots/c.png",
        status: "deleted",
        share: null,
        before: "before/screenshots/c.png",
        after: null,
        diff: null,
      },
    ]);
  });

  it("reads the images of a report per language, with the files that they name", () => {
    expect(
      readReport(
        JSON.stringify({
          languages: ["en"],
          images: [
            {
              path: "en/voice.webp",
              status: "changed",
              share: 0.06,
              before: "en/voice.before.webp",
              after: "en/voice.after.webp",
            },
            { path: "en/new.webp", status: "added", share: 1, after: "../x" },
            { path: "en/old.webp", status: "removed", share: 1 },
          ],
          unchanged: 209,
        }),
      ),
    ).toEqual([
      {
        path: "en/voice.webp",
        status: "changed",
        share: 0.06,
        before: "en/voice.before.webp",
        after: "en/voice.after.webp",
        diff: null,
      },
      {
        path: "en/new.webp",
        status: "new",
        share: 1,
        before: null,
        after: "after/en/new.webp",
        diff: null,
      },
      {
        path: "en/old.webp",
        status: "deleted",
        share: 1,
        before: "before/en/old.webp",
        after: null,
        diff: null,
      },
    ]);
  });

  it("names the difference of a picture that changed, as each check keeps it", () => {
    const found = readReport(
      report([
        // The blueprint's keep, and the checks that take it, name it as diff.
        {
          path: "docs/a.webp",
          status: "changed",
          share: 0.08,
          diff: "diff/docs/a.webp.png",
        },
        {
          path: "docs/b.gif",
          status: "changed",
          share: 0.001,
          diff: "diff/docs/b.gif.png",
        },
        // The visual check of homedarts-for-autodarts names it as difference.
        {
          path: "en/c.webp",
          status: "changed",
          share: 0.2,
          difference: "en/c.difference.png",
        },
        // A name that isn't a plain path counts as none, as for before and after.
        {
          path: "docs/d.png",
          status: "changed",
          share: 0.1,
          diff: "../x.png",
          difference: 7,
        },
        // A check that writes the difference of a PNG by its path, without its name.
        { path: "docs/e.png", status: "changed", share: 0.3 },
        // Its end in capitals is a PNG all the same, as the checks see it.
        { path: "docs/E.PNG", status: "changed", share: 0.3 },
        { path: "docs/e.xpng", status: "changed", share: 0.3 },
        { path: "docs/f.png", status: "changed", share: null },
        { path: "docs/g.webp", status: "changed", share: 0.3 },
        {
          path: "docs/h.png",
          status: "new",
          share: null,
          diff: "diff/docs/h.png",
        },
        {
          path: "docs/i.png",
          status: "deleted",
          share: null,
          diff: "diff/docs/i.png",
        },
      ]),
    );
    expect(found?.map(({ path, diff }) => [path, diff])).toEqual([
      ["docs/a.webp", "diff/docs/a.webp.png"],
      ["docs/b.gif", "diff/docs/b.gif.png"],
      ["en/c.webp", "en/c.difference.png"],
      ["docs/d.png", "diff/docs/d.png"],
      ["docs/e.png", "diff/docs/e.png"],
      ["docs/E.PNG", "diff/docs/E.PNG"],
      ["docs/e.xpng", null],
      ["docs/f.png", null],
      ["docs/g.webp", null],
      ["docs/h.png", null],
      ["docs/i.png", null],
    ]);
  });

  it("is no report without its list of pictures", () => {
    expect(readReport("not json")).toBeNull();
    expect(readReport("null")).toBeNull();
    expect(readReport('{"pictures": {}}')).toBeNull();
    expect(readReport('{"images": "none"}')).toBeNull();
  });

  it("puts the largest change first, a picture that is gone after it, and a video last", () => {
    const pictures: (Changed & { diff?: string | null })[] = [
      { path: "gone.png", status: "deleted", share: null },
      { path: "small.png", status: "changed", share: 0.01 },
      { path: "resized.png", status: "changed", share: null },
      { path: "added.png", status: "new", share: null },
      { path: "docs/images/demo.mp4", status: "changed", share: null },
      {
        path: "docs/images/plain.gif",
        status: "changed",
        share: 0.9,
        diff: null,
      },
      { path: "half.png", status: "changed", share: 0.5 },
      // A GIF with its difference, which the album shows, is one of the photos.
      {
        path: "docs/images/demo.gif",
        status: "changed",
        share: 0.3,
        diff: "diff/docs/images/demo.gif.png",
      },
      { path: "shot.WEBP", status: "changed", share: 0.2 },
    ];
    expect(largestFirst(pictures).map(({ path }) => path)).toEqual([
      "resized.png",
      "added.png",
      "half.png",
      "docs/images/demo.gif",
      "shot.WEBP",
      "small.png",
      "gone.png",
      "docs/images/demo.mp4",
      "docs/images/plain.gif",
    ]);
  });
});

describe("a photo for Telegram", () => {
  it("is a PNG of a size that Telegram takes", () => {
    expect(photoType(png(1280, 800))).toBe("image/png");
    expect(photoType(png(100, 2000))).toBe("image/png");
    expect(photoType(png(100, 2001))).toBeNull();
    expect(photoType(png(6000, 4001))).toBeNull();
    expect(photoType(png(0, 800))).toBeNull();
    expect(photoType(png(800, 0))).toBeNull();
    expect(photoType(png(800, 600).subarray(0, 29))).toBeNull();
    const gif = png(800, 600);
    gif[1] = 0x47;
    expect(photoType(gif)).toBeNull();
    const large = new Uint8Array(MAX_PHOTO + 1);
    large.set(png(800, 600));
    expect(photoType(large)).toBeNull();
  });

  it("is a WebP of a size that Telegram takes, of each kind", () => {
    for (const kind of ["VP8X", "VP8L", "VP8 "] as const) {
      expect(photoType(webp(kind, 1280, 720))).toBe("image/webp");
      expect(photoType(webp(kind, 100, 3000))).toBeNull();
    }
    expect(photoType(webp("VP8X", 70000, 1))).toBeNull();
    const signless = webp("VP8L", 800, 600);
    signless[20] = 0;
    expect(photoType(signless)).toBeNull();
    const unknown = webp("VP8X", 800, 600);
    unknown.set(new TextEncoder().encode("ALPH"), 12);
    expect(photoType(unknown)).toBeNull();
    const riff = webp("VP8X", 800, 600);
    riff.set(new TextEncoder().encode("WAVE"), 8);
    expect(photoType(riff)).toBeNull();
  });
});

describe("the artifact of a visual check", () => {
  it("gives the album of the largest changes that Telegram shows, before and after", async () => {
    const found = await read([await artifact(changes)]);
    expect(found.changed.map(({ path }) => path)).toEqual([
      "screenshots/added.png",
      "screenshots/large.png",
      "screenshots/small.png",
      "docs/images/demo.gif",
    ]);
    expect(found.shown).toBe(MAX_ALBUM);
    expect(found.photos.map(({ caption }) => caption)).toEqual([
      "🆕 New: <code>screenshots/added.png</code>",
      "◀️ Before: <code>screenshots/large.png</code>",
      "▶️ After: <code>screenshots/large.png</code>",
      "◀️ Before: <code>screenshots/small.png</code>",
      "▶️ After: <code>screenshots/small.png</code>",
    ]);
    // The new picture is the one after, the eleventh byte of the last row of each.
    expect(found.photos.map(({ bytes }) => bytes[39])).toEqual([
      103, 2, 102, 0, 100,
    ]);
    // No picture of the artifact has its difference: none of the PNGs has one in diff/.
    expect(found.differences).toBe(0);
  });

  it("shows the changed pixels in red first, then before and after, from each kind of report", async () => {
    const found = await read([
      await artifact(
        [
          {
            path: "docs/a.webp",
            status: "changed",
            share: 0.4,
            diff: "diff/docs/a.webp.png",
          },
          {
            path: "en/b.webp",
            status: "changed",
            share: 0.3,
            difference: "en/b.difference.png",
          },
          // Its check wrote the difference of the PNG by its path, without its name.
          { path: "docs/c.png", status: "changed", share: 0.2 },
          {
            path: "docs/d.png",
            status: "changed",
            share: 0.1,
            diff: "diff/docs/d.png",
          },
        ],
        [{ name: "diff/docs/c.png", data: png(800, 600, 222), deflate: true }],
      ),
    ]);
    expect(found.shown).toBe(MAX_ALBUM);
    expect(found.differences).toBe(4);
    expect(found.photos.map(({ caption }) => caption)).toEqual([
      "🔴 Changed pixels: <code>docs/a.webp</code>",
      "◀️ Before: <code>docs/a.webp</code>",
      "▶️ After: <code>docs/a.webp</code>",
      "🔴 Changed pixels: <code>en/b.webp</code>",
      "◀️ Before: <code>en/b.webp</code>",
      "▶️ After: <code>en/b.webp</code>",
      "🔴 Changed pixels: <code>docs/c.png</code>",
      "◀️ Before: <code>docs/c.png</code>",
      "▶️ After: <code>docs/c.png</code>",
    ]);
    // The difference of each is its own file: the 201st byte of the first, and so on.
    expect(found.photos.map(({ bytes }) => bytes[39])).toEqual([
      200, 0, 100, 201, 1, 101, 222, 2, 102,
    ]);
    // Three pictures of three photos each stay within the ten of an album of Telegram.
    expect(found.photos.length).toBeLessThanOrEqual(MAX_MEDIA);
    expect(3 * MAX_ALBUM).toBeLessThanOrEqual(MAX_MEDIA);
    const german = await read(
      [
        await artifact([
          {
            path: "docs/a.png",
            status: "changed",
            share: 0.4,
            diff: "diff/docs/a.png",
          },
        ]),
      ],
      de,
    );
    expect(german.photos[0]?.caption).toBe(
      "🔴 Geänderte Pixel: <code>docs/a.png</code>",
    );
  });

  it("shows the difference of a GIF alone, among the photos, and a GIF without one last", async () => {
    const found = await read([
      await artifact([
        { path: "docs/plain.gif", status: "changed", share: 0.9 },
        { path: "screenshots/small.png", status: "changed", share: 0.1 },
        {
          path: "docs/demo.gif",
          status: "changed",
          share: 0.5,
          diff: "diff/docs/demo.gif.png",
        },
      ]),
    ]);
    expect(found.changed.map(({ path }) => path)).toEqual([
      "docs/demo.gif",
      "screenshots/small.png",
      "docs/plain.gif",
    ]);
    expect(found.shown).toBe(2);
    expect(found.differences).toBe(1);
    expect(found.photos.map(({ caption }) => caption)).toEqual([
      "🔴 Changed pixels: <code>docs/demo.gif</code>",
      "◀️ Before: <code>screenshots/small.png</code>",
      "▶️ After: <code>screenshots/small.png</code>",
    ]);
  });

  it("shows a picture without its difference when that is missing, broken or too large", async () => {
    const pictures = [
      {
        path: "docs/a.png",
        status: "changed",
        share: 0.5,
        diff: "diff/docs/a.png",
      },
      {
        path: "docs/b.png",
        status: "changed",
        share: 0.4,
        diff: "diff/docs/b.png",
      },
      {
        path: "docs/c.png",
        status: "changed",
        share: 0.3,
        diff: "diff/docs/c.png",
      },
    ];
    const found = await read([
      await zip([
        { name: "report.json", data: report(pictures) },
        ...pictures.flatMap(({ path }) => [
          { name: `before/${path}`, data: png(800, 600) },
          { name: `after/${path}`, data: png(800, 600) },
        ]),
        // The difference of a.png is missing, that of b.png no picture, and that of
        // c.png larger than Telegram takes as a photo.
        { name: "diff/docs/b.png", data: "no picture" },
        { name: "diff/docs/c.png", data: png(6000, 4001) },
      ]),
    ]);
    expect(found.differences).toBe(2);
    expect(found.shown).toBe(MAX_ALBUM);
    expect(found.photos.map(({ caption }) => caption)).toEqual([
      "◀️ Before: <code>docs/a.png</code>",
      "▶️ After: <code>docs/a.png</code>",
      "◀️ Before: <code>docs/b.png</code>",
      "▶️ After: <code>docs/b.png</code>",
      "◀️ Before: <code>docs/c.png</code>",
      "▶️ After: <code>docs/c.png</code>",
    ]);
  });

  it("shows no more than its limit, and what was of a deleted picture", async () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      path: `screenshots/${index}.png`,
      status: "changed",
      share: 0.1,
    }));
    const found = await read(
      [
        await artifact([
          ...many,
          { path: "screenshots/gone.png", status: "deleted", share: null },
        ]),
      ],
      de,
    );
    expect(found.changed).toHaveLength(6);
    expect(found.shown).toBe(MAX_ALBUM);
    expect(found.photos).toHaveLength(2 * MAX_ALBUM);
    const gone = await read(
      [
        await artifact([
          { path: "screenshots/gone.png", status: "deleted", share: null },
        ]),
      ],
      de,
    );
    expect(gone.photos.map(({ caption }) => caption)).toEqual([
      "🗑 Gelöscht: <code>screenshots/gone.png</code>",
    ]);
  });

  it("leaves out a picture that misses a side, is too large, or isn't a photo", async () => {
    const pictures = [
      { path: "screenshots/one.png", status: "changed", share: 0.5 },
      { path: "screenshots/tall.png", status: "changed", share: 0.4 },
      { path: "screenshots/huge.png", status: "changed", share: 0.3 },
    ];
    const bytes = await zip([
      { name: "report.json", data: report(pictures) },
      { name: "after/screenshots/one.png", data: png(800, 600) },
      { name: "before/screenshots/tall.png", data: png(100, 5000) },
      { name: "after/screenshots/tall.png", data: png(100, 5000) },
      { name: "before/screenshots/huge.png", data: png(800, 600) },
      { name: "after/screenshots/huge.png", data: png(800, 600) },
    ]);
    // The directory says that the last picture is larger than a photo may be.
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    let at = view.getUint32(end + 16, true);
    for (let index = 0; index < 5; index += 1) {
      at += 46 + view.getUint16(at + 28, true);
    }
    view.setUint32(at + 24, MAX_PHOTO + 1, true);
    const found = await read([bytes]);
    expect(found.changed).toHaveLength(3);
    expect(found.shown).toBe(0);
    expect(found.photos).toEqual([]);
  });

  it("leaves out a picture whose file isn't a photo by its name, or doesn't inflate", async () => {
    const pictures = [
      { path: "docs/a.gif", status: "changed", share: 0.5 },
      { path: "docs/b.png", status: "new", share: 0.4 },
    ];
    const bytes = await zip([
      { name: "report.json", data: report(pictures) },
      { name: "before/docs/a.gif", data: png(800, 600) },
      { name: "after/docs/a.gif", data: png(800, 600) },
      { name: "after/docs/b.png", data: "x".repeat(100), deflate: true },
    ]);
    // A deflated block of a type that deflate doesn't have.
    const broken = bytes.slice();
    const at = broken.length - 22;
    const view = new DataView(broken.buffer);
    let entry = view.getUint32(at + 16, true);
    for (let index = 0; index < 3; index += 1) {
      entry += 46 + view.getUint16(entry + 28, true);
    }
    const local = view.getUint32(entry + 42, true);
    broken[local + 30 + "after/docs/b.png".length] = 0xff;
    const found = await read([broken]);
    expect(found.changed).toHaveLength(2);
    expect(found.photos).toEqual([]);
  });

  it("takes the largest changes of every artifact of the check, such as one per language", async () => {
    const english = await zip([
      {
        name: "report.json",
        data: JSON.stringify({
          images: [
            {
              path: "en/a.webp",
              status: "changed",
              share: 0.1,
              before: "en/a.before.webp",
              after: "en/a.after.webp",
            },
          ],
        }),
      },
      { name: "en/a.before.webp", data: webp("VP8 ", 800, 600) },
      { name: "en/a.after.webp", data: webp("VP8 ", 800, 600) },
    ]);
    const german = await artifact([
      { path: "de/b.png", status: "changed", share: 0.2 },
    ]);
    const found = await read([english, new Uint8Array(30), german]);
    expect(found.changed.map(({ path }) => path)).toEqual([
      "de/b.png",
      "en/a.webp",
    ]);
    expect(found.photos.map(({ type }) => type)).toEqual([
      "image/png",
      "image/png",
      "image/webp",
      "image/webp",
    ]);
  });

  it("is nothing without a report that the pager reads, or as a broken ZIP", async () => {
    expect(await readArtifact(await zip([]))).toBeNull();
    expect(
      await readArtifact(await zip([{ name: "report.json", data: "{}" }])),
    ).toBeNull();
    expect(
      await readArtifact(
        await zip([{ name: "report.json", data: " ".repeat(300 * 1024) }]),
      ),
    ).toBeNull();
    expect(await readArtifact(new Uint8Array(64))).toBeNull();
  });
});

describe("the text of the pictures", () => {
  const view = {
    repo: REPO,
    number: 8,
    title: "Make it <b>",
    url: `https://github.com/${REPO}/pull/8`,
    sha: SHA,
    changed: [
      { path: "a.png", status: "changed", share: 0.0231 },
      { path: "b.png", status: "changed", share: null },
      { path: "c.png", status: "new", share: null },
      { path: "d.png", status: "deleted", share: null },
      { path: "e.png", status: "changed", share: 0.00001 },
      { path: "f.png", status: "changed", share: 1 },
    ] as Changed[],
    count: 6,
    shown: 2,
    check: CHECK,
  };

  it("lists each picture with how it changed, and links the artifact", () => {
    expect(picturesText({ ...view, differences: 2 }, en)).toBe(
      [
        `🖼 <b>6 pictures look different</b> in <a href="https://github.com/${REPO}">${REPO}</a> at <code>a1b2c3d</code>: <a href="https://github.com/${REPO}/pull/8">#8 Make it &lt;b&gt;</a>`,
        "• <code>a.png</code>: changed, 2.31 % of its pixels",
        "• <code>b.png</code>: another size or frames",
        "• <code>c.png</code>: new",
        "• <code>d.png</code>: deleted",
        "• <code>e.png</code>: changed, < 0.01 % of its pixels",
        "• <code>f.png</code>: changed, 100 % of its pixels",
        "📸 The album below: 2 of 6.",
        `<a href="${CHECK}">All of them before and after, each changed pixel in red</a>`,
      ].join("\n"),
    );
  });

  it("says when there are more, one, none for the album, or none at all", () => {
    const one = picturesText(
      { ...view, changed: view.changed.slice(0, 1), count: 1, shown: 0 },
      de,
    );
    expect(one).toContain("<b>1 Bild sieht anders aus</b>");
    expect(one).toContain("geändert, 2,31 % seiner Pixel");
    expect(one).toContain("Kein Album");
    expect(picturesText({ ...view, count: 9 }, en)).toContain("… and 3 more");
    expect(picturesText({ ...view, changed: [], count: 0 }, en)).toBe(
      `🖼 <b>Every picture looks as committed again</b> in <a href="https://github.com/${REPO}">${REPO}</a> at <code>a1b2c3d</code>: <a href="https://github.com/${REPO}/pull/8">#8 Make it &lt;b&gt;</a>`,
    );
    expect(de.percent(0.00001)).toBe("< 0,01 %");
  });

  it("promises the changed pixels in red only when the artifacts hold the difference of one", () => {
    const last = (text: string) => text.split("\n").at(-1);
    const plain = `<a href="${CHECK}">All of them before and after</a>`;
    expect(last(picturesText({ ...view, differences: 0 }, en))).toBe(plain);
    // A record from before the pager read the differences promises no red either.
    expect(last(picturesText(view, en))).toBe(plain);
    expect(last(picturesText(view, de))).toBe(
      `<a href="${CHECK}">Alle vorher und nachher</a>`,
    );
    expect(last(picturesText({ ...view, differences: 1 }, de))).toBe(
      `<a href="${CHECK}">Alle vorher und nachher, jedes geänderte Pixel rot</a>`,
    );
  });
});

describe("the album", () => {
  const photos: Photo[] = [
    { bytes: png(800, 600), type: "image/png", caption: "◀️ Before" },
    { bytes: webp("VP8X", 800, 600), type: "image/webp", caption: "▶️ After" },
  ];

  it("goes as one album into its thread, or as one photo", async () => {
    const w = await world();
    await w.context.telegram.album(photos, 900, 7, true);
    const [album] = w.net.telegram("sendMediaGroup");
    expect(album?.body).toMatchObject({
      chat_id: "4242",
      message_thread_id: "900",
      disable_notification: "true",
      p0: { file: "p0.png", type: "image/png", size: 40 },
      p1: { file: "p1.webp", type: "image/webp" },
    });
    expect(album?.body.reply_parameters).toBeUndefined();
    expect(JSON.parse(album?.body.media)).toEqual([
      {
        type: "photo",
        media: "attach://p0",
        caption: "◀️ Before",
        parse_mode: "HTML",
      },
      {
        type: "photo",
        media: "attach://p1",
        caption: "▶️ After",
        parse_mode: "HTML",
      },
    ]);
    await w.context.telegram.album(photos.slice(1), null, null, false);
    const [photo] = w.net.telegram("sendPhoto");
    expect(photo?.body).toEqual({
      chat_id: "4242",
      disable_notification: "false",
      photo: { file: "photo.webp", type: "image/webp", size: 40 },
      caption: "▶️ After",
      parse_mode: "HTML",
    });
  });

  it("goes into the main view, in reply to its message, without its thread", async () => {
    const w = await world();
    w.net.on("POST", /\/sendMediaGroup$/, () =>
      json({ ok: false, description: "Bad Request: message thread not found" }),
    );
    let tries = 0;
    w.net.on("POST", /\/sendMediaGroup$/, () => {
      tries += 1;
      return tries === 1
        ? json({
            ok: false,
            description: "Bad Request: message thread not found",
          })
        : json({ ok: true, result: [] });
    });
    await w.context.telegram.album(photos, 900, 7, false);
    const [first, second] = w.net.telegram("sendMediaGroup");
    expect(first?.body.message_thread_id).toBe("900");
    expect(second?.body.message_thread_id).toBeUndefined();
    expect(JSON.parse(second?.body.reply_parameters)).toEqual({
      message_id: 7,
      allow_sending_without_reply: true,
    });
  });

  it("fails when Telegram refuses it for another reason", async () => {
    const w = await world();
    w.net.on("POST", /\/sendMediaGroup$/, () =>
      json({ ok: false, description: "Bad Request: PHOTO_INVALID_DIMENSIONS" }),
    );
    await expect(
      w.context.telegram.album(photos, 900, 7, false),
    ).rejects.toThrow(TelegramError);
    const telegram = new Telegram("123:test", 1, async () =>
      json({ ok: false, description: "Bad Request: PHOTO_INVALID_DIMENSIONS" }),
    );
    await expect(telegram.album(photos, null, null, false)).rejects.toThrow(
      "Telegram sendMediaGroup: Bad Request: PHOTO_INVALID_DIMENSIONS",
    );
  });
});

describe("the artifact on GitHub", () => {
  it("is listed with the run, unless it expired", async () => {
    const w = await withArtifact(await artifact(changes));
    w.net.on("GET", ARTIFACTS, () =>
      json({
        artifacts: [
          { id: 55, name: "visual", size_in_bytes: 10 },
          { id: 56, name: "visual-en", size_in_bytes: 10, expired: false },
          { id: 57, name: "visual", size_in_bytes: 10, expired: true },
          { id: "58", name: "visual", size_in_bytes: 10 },
          { id: 59, name: 7, size_in_bytes: 10 },
          { id: 60, name: "visual" },
        ],
      }),
    );
    expect(await w.context.github.artifacts(9, REPO, 31)).toEqual([
      { id: 55, name: "visual", size: 10 },
      { id: 56, name: "visual-en", size: 10 },
    ]);
    w.net.on("GET", ARTIFACTS, () => json({}));
    expect(await w.context.github.artifacts(9, REPO, 31)).toEqual([]);
    const [token] = w.net.github("/access_tokens");
    expect(token?.body).toEqual({
      repositories: ["demo"],
      permissions: { actions: "read" },
    });
  });

  it("comes from its storage, without the token", async () => {
    const bytes = await artifact(changes);
    const w = await withArtifact(bytes);
    const got = await w.context.github.artifactZip(9, REPO, 55, bytes.length);
    expect(got).toEqual(bytes);
    const [link] = w.net.github("/actions/artifacts/55/zip");
    expect(link?.headers.authorization).toMatch(/^Bearer ghs_test_/);
    const storage = w.net.calls.find((call) => call.url === STORAGE);
    expect(storage?.headers).toEqual({ "user-agent": "dennis-otto-pager" });
  });

  it("is refused when GitHub names no storage, or the storage refuses, or it is too large", async () => {
    const bytes = await artifact(changes);
    const w = await withArtifact(bytes);
    await expect(
      w.context.github.artifactZip(9, REPO, 55, bytes.length - 1),
    ).rejects.toMatchObject({ status: 413 });
    w.net.on("GET", STORAGE, () => new Response("no", { status: 403 }));
    await expect(
      w.context.github.artifactZip(9, REPO, 55, bytes.length),
    ).rejects.toThrow(
      "GitHub answered 403: the storage of the artifact refused",
    );
    for (const answer of [
      () => new Response(null, { status: 302 }),
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://storage.example/a.zip" },
        }),
      () => json({}),
    ]) {
      w.net.on("GET", `/repos/${REPO}/actions/artifacts/55/zip`, answer);
      await expect(
        w.context.github.artifactZip(9, REPO, 55, bytes.length),
      ).rejects.toThrow("no address of the artifact");
    }
    w.net.on("GET", `/repos/${REPO}/actions/artifacts/55/zip`, () =>
      json({ message: "Artifact has expired" }, 410),
    );
    const expired = w.context.github.artifactZip(9, REPO, 55, bytes.length);
    await expect(expired).rejects.toThrow(GitHubError);
    await expect(expired).rejects.toThrow("Artifact has expired");
  });
});

describe("the pictures of a pull request", () => {
  it("open a thing of their own, with its message first and the album below", async () => {
    const w = await withArtifact(await artifact(changes));
    expect(await apply(w.context, signal())).toBe("pictures shown");
    const [topic] = w.net.telegram("createForumTopic");
    expect(topic?.body).toMatchObject({
      name: "🖼 demo#8 Make the <button> blue",
    });
    const [message] = w.net.telegram("sendMessage");
    expect(message?.body.message_thread_id).toBe(900);
    expect(message?.body.text).toContain("<b>4 pictures look different</b>");
    expect(message?.body.text).toContain("📸 The album below: 3 of 4.");
    // The artifact holds no difference, so the link promises no red.
    expect(message?.body.text).toContain(
      `<a href="${CHECK}">All of them before and after</a>`,
    );
    expect(message?.body.reply_markup.inline_keyboard).toEqual([
      [
        {
          text: "✖ Ignore",
          callback_data: `ignore:${await itemId(keys.pictures(REPO, 8))}`,
        },
      ],
    ]);
    const [album] = w.net.telegram("sendMediaGroup");
    // The new message notified; the album below it comes quietly, in the topic.
    expect(album?.body).toMatchObject({
      message_thread_id: "900",
      disable_notification: "true",
    });
    expect(media(w)).toHaveLength(5);
    expect(await stored(w, keys.pictures(REPO, 8))).toMatchObject({
      kind: "pictures",
      state: "open",
      number: 8,
      title: "Make the <button> blue",
      sha: SHA,
      count: 4,
      shown: 3,
      differences: 0,
      messageId: 100,
      check: CHECK,
      topic: { thread: 900 },
    });
  });

  it("show the changed pixels in red first, as their message promises", async () => {
    const w = await withArtifact(
      await artifact([
        ...changes,
        {
          path: "docs/images/b.webp",
          status: "changed",
          share: 0.1,
          diff: "diff/docs/images/b.webp.png",
        },
      ]),
    );
    expect(await apply(w.context, signal())).toBe("pictures shown");
    const [message] = w.net.telegram("sendMessage");
    expect(message?.body.text).toContain(
      `<a href="${CHECK}">All of them before and after, each changed pixel in red</a>`,
    );
    expect(media(w).map(({ caption }) => caption)).toEqual([
      "🆕 New: <code>screenshots/added.png</code>",
      "◀️ Before: <code>screenshots/large.png</code>",
      "▶️ After: <code>screenshots/large.png</code>",
      "🔴 Changed pixels: <code>docs/images/b.webp</code>",
      "◀️ Before: <code>docs/images/b.webp</code>",
      "▶️ After: <code>docs/images/b.webp</code>",
    ]);
    expect(await stored(w, keys.pictures(REPO, 8))).toMatchObject({
      count: 5,
      shown: 3,
      differences: 1,
    });
  });

  it("go at most once per head, and again in place for a newer one", async () => {
    const w = await withArtifact(await artifact(changes));
    await apply(w.context, signal());
    const calls = w.net.calls.length;
    expect(await apply(w.context, signal())).toBe("pictures shown already");
    expect(w.net.calls).toHaveLength(calls);
    w.net.on("GET", `/repos/${REPO}/pulls/8`, () =>
      json({
        number: 8,
        state: "open",
        title: "Make it blue",
        html_url: `https://github.com/${REPO}/pull/8`,
        user: { login: "Dennis-Otto" },
        head: { sha: "newer", repo: { full_name: REPO } },
      }),
    );
    expect(await apply(w.context, signal("newer"))).toBe("pictures shown anew");
    const [edit] = w.net.telegram("editMessageText");
    expect(edit?.body).toMatchObject({ message_id: 100 });
    expect(edit?.body.text).toContain("<code>newer</code>");
    // Its message changed in place, so the album notifies.
    const [, album] = w.net.telegram("sendMediaGroup");
    expect(album?.body.disable_notification).toBe("false");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
  });

  it("go with their album into a new topic when the maintainer deleted theirs", async () => {
    const w = await withArtifact(await artifact(changes));
    await apply(w.context, signal());
    withDeletedTopic(w.net, 900, [100]);
    w.net.on("GET", `/repos/${REPO}/pulls/8`, () =>
      json({
        number: 8,
        state: "open",
        title: "Make it blue",
        html_url: `https://github.com/${REPO}/pull/8`,
        user: { login: "Dennis-Otto" },
        head: { sha: "newer", repo: { full_name: REPO } },
      }),
    );
    expect(await apply(w.context, signal("newer"))).toBe("pictures shown anew");
    expect(
      w.net.telegram("createForumTopic").map((call) => call.body.name),
    ).toEqual(["🖼 demo#8 Make the <button> blue", "🖼 demo#8 Make it blue"]);
    const [, , message] = w.net.telegram("sendMessage");
    expect(message?.body.message_thread_id).toBe(901);
    // The new message notified already, so its album below it comes quietly.
    const [, album] = w.net.telegram("sendMediaGroup");
    expect(album?.body).toMatchObject({
      message_thread_id: "901",
      disable_notification: "true",
    });
    expect(await stored(w, keys.pictures(REPO, 8))).toMatchObject({
      messageId: 101,
      topic: { thread: 901, name: "🖼 demo#8 Make it blue" },
    });
  });

  it("say in place when the newest head looks as committed again, and nothing for a new one", async () => {
    const w = await withArtifact(await artifact(changes));
    await apply(w.context, signal());
    const empty = await artifact([]);
    w.net.on(
      "GET",
      STORAGE,
      () => new Response(empty as Uint8Array<ArrayBuffer>),
    );
    w.net.on("GET", ARTIFACTS, () =>
      json({ artifacts: [{ id: 55, name: "visual", size_in_bytes: 1 }] }),
    );
    w.net.on("GET", `/repos/${REPO}/pulls/8`, () =>
      json({
        state: "open",
        user: { login: "Dennis-Otto" },
        head: { sha: "newer", repo: { full_name: REPO } },
      }),
    );
    expect(await apply(w.context, signal("newer"))).toBe(
      "pictures look as committed again",
    );
    const [edit] = w.net.telegram("editMessageText");
    expect(edit?.body.text).toContain(
      "<b>Every picture looks as committed again</b>",
    );
    // A pull request whose title and address GitHub didn't send shows its number alone.
    expect(edit?.body.text).toMatch(/<\/code>: #8 $/);
    expect(w.net.telegram("sendMediaGroup")).toHaveLength(1);
    expect(await stored(w, keys.pictures(REPO, 8))).toMatchObject({
      sha: "newer",
      count: 0,
      title: "",
      url: "",
    });

    const fresh = await withArtifact(empty);
    expect(await apply(fresh.context, signal())).toBe(
      "every picture looks as committed",
    );
    expect(fresh.net.telegram("sendMessage")).toHaveLength(0);
    expect(await stored(fresh, keys.pictures(REPO, 8))).toBeNull();
  });

  it("go only to a pull request of the maintainer or a bot, at the head that was checked", async () => {
    const stranger = await withArtifact(await artifact(changes), {
      user: { login: "octocat", type: "User" },
    });
    expect(await apply(stranger.context, signal())).toBe(
      "no pictures: someone else opened it",
    );
    const moved = await withArtifact(await artifact(changes), { sha: "newer" });
    expect(await apply(moved.context, signal())).toBe(
      "no pictures: it moved on to another head",
    );
    expect(moved.net.github(ARTIFACTS)).toHaveLength(0);
    const bot = await withArtifact(await artifact(changes), {
      user: { login: "renovate[bot]", type: "Bot" },
    });
    expect(await apply(bot.context, signal())).toBe("pictures shown");
  });

  it("come from every artifact of the check, such as one per language", async () => {
    const w = await withArtifact(
      await artifact([{ path: "en/a.png", status: "changed", share: 0.1 }]),
    );
    const german = await artifact([
      { path: "de/a.png", status: "changed", share: 0.2 },
    ]);
    const other = "https://storage.example/other.zip";
    w.net
      .on("GET", ARTIFACTS, () =>
        json({
          artifacts: [
            { id: 55, name: "visual-en", size_in_bytes: 1000 },
            { id: 56, name: "visual-de", size_in_bytes: 1000 },
            { id: 57, name: "screenshots", size_in_bytes: 1000 },
            // More than fits with the two before it.
            { id: 58, name: "visual-fr", size_in_bytes: 32 * 1024 * 1024 },
          ],
        }),
      )
      .on(
        "GET",
        `/repos/${REPO}/actions/artifacts/56/zip`,
        () => new Response(null, { status: 302, headers: { location: other } }),
      )
      .on("GET", other, () => new Response(german as Uint8Array<ArrayBuffer>));
    expect(await apply(w.context, signal())).toBe("pictures shown");
    expect(w.net.github("/artifacts/57/zip")).toHaveLength(0);
    expect(w.net.github("/artifacts/58/zip")).toHaveLength(0);
    const text = w.net.telegram("sendMessage")[0]?.body.text;
    expect(text).toContain("<b>2 pictures look different</b>");
    expect(text.indexOf("de/a.png")).toBeLessThan(text.indexOf("en/a.png"));
    expect(media(w)).toHaveLength(4);
  });

  it("leave out an artifact that GitHub refuses, and read each within what is left", async () => {
    const w = await withArtifact(
      await artifact([{ path: "en/a.png", status: "changed", share: 0.1 }]),
    );
    w.net
      .on("GET", ARTIFACTS, () =>
        json({
          artifacts: [
            { id: 56, name: "visual-de", size_in_bytes: 1000 },
            { id: 55, name: "visual-en", size_in_bytes: 1000 },
          ],
        }),
      )
      .on("GET", `/repos/${REPO}/actions/artifacts/56/zip`, () =>
        json({ message: "Artifact has expired" }, 410),
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await apply(w.context, signal())).toBe("pictures shown");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("artifact 56 of"),
    );
    warn.mockRestore();
    const text = w.net.telegram("sendMessage")[0]?.body.text;
    expect(text).toContain("en/a.png");
    expect(media(w)).toHaveLength(2);
  });

  it("read the next artifact only within what the first left of the limit", async () => {
    const first = await artifact([
      { path: "en/a.png", status: "changed", share: 0.1 },
    ]);
    const w = await withArtifact(first);
    const spy = vi.spyOn(w.context.github, "artifactZip");
    w.net.on("GET", ARTIFACTS, () =>
      json({
        artifacts: [
          { id: 55, name: "visual-en", size_in_bytes: 1000 },
          { id: 56, name: "visual-de", size_in_bytes: 1000 },
        ],
      }),
    );
    await apply(w.context, signal());
    expect(spy.mock.calls.map((call) => call[3])).toEqual([
      32 * 1024 * 1024,
      32 * 1024 * 1024 - first.length,
    ]);
  });

  it("fail on an error of an artifact that isn't GitHub's", async () => {
    const w = await withArtifact(await artifact(changes));
    w.net.on("GET", STORAGE, () => {
      throw new TypeError("network down");
    });
    await expect(apply(w.context, signal())).rejects.toThrow("network down");
  });

  it("need an artifact that the pager reads", async () => {
    const w = await withArtifact(await artifact(changes));
    w.net.on("GET", ARTIFACTS, () => json({ artifacts: [] }));
    expect(await apply(w.context, signal())).toBe(
      "no pictures: the run kept no artifact that the pager reads",
    );
    w.net.on("GET", ARTIFACTS, () =>
      json({
        artifacts: [
          { id: 55, name: "visual", size_in_bytes: 64 * 1024 * 1024 },
        ],
      }),
    );
    expect(await apply(w.context, signal())).toBe(
      "no pictures: the run kept no artifact that the pager reads",
    );
    const broken = await withArtifact(new Uint8Array(100));
    expect(await apply(broken.context, signal())).toBe(
      "no pictures: the artifact holds no report that the pager reads",
    );
    expect(broken.net.telegram("sendMessage")).toHaveLength(0);
  });

  it("say in the message why Telegram refused the album", async () => {
    const w = await withArtifact(await artifact(changes));
    w.net.on("POST", /\/sendMediaGroup$/, () =>
      json({ ok: false, description: "Bad Request: PHOTO_INVALID_DIMENSIONS" }),
    );
    expect(await apply(w.context, signal())).toBe("pictures shown");
    const [edit] = w.net.telegram("editMessageText");
    expect(edit?.body.text).toContain(
      "<i>Telegram refused the pictures: Bad Request: PHOTO_INVALID_DIMENSIONS</i>",
    );
    expect(await stored(w, keys.pictures(REPO, 8))).toMatchObject({
      sha: SHA,
      note: "Telegram refused the pictures: Bad Request: PHOTO_INVALID_DIMENSIONS",
    });
  });

  it("fail on an error that isn't Telegram's", async () => {
    const w = await withArtifact(await artifact(changes));
    w.net.on("POST", /\/sendMediaGroup$/, () => {
      throw new TypeError("network down");
    });
    await expect(apply(w.context, signal())).rejects.toThrow("network down");
  });

  it("send no album without a picture that Telegram shows, and reply to their message in the main view", async () => {
    const gif = await artifact([
      { path: "docs/images/demo.gif", status: "changed", share: 0.5 },
    ]);
    const w = await withArtifact(gif, {}, false);
    expect(await apply(w.context, signal())).toBe("pictures shown");
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "📸 No album",
    );
    expect(w.net.telegram("sendMediaGroup")).toHaveLength(0);
    expect(w.net.telegram("sendPhoto")).toHaveLength(0);

    const one = await withArtifact(
      await artifact([
        { path: "screenshots/a.png", status: "new", share: null },
      ]),
      {},
      false,
    );
    await apply(one.context, signal());
    const [photo] = one.net.telegram("sendPhoto");
    expect(JSON.parse(photo?.body.reply_parameters)).toEqual({
      message_id: 100,
      allow_sending_without_reply: true,
    });
  });

  it("stop with Ignore, and end with their pull request", async () => {
    const w = await withArtifact(await artifact(changes));
    await apply(w.context, signal());
    const id = await itemId(keys.pictures(REPO, 8));
    const item = (await w.context.store.get(id)) as Pictures;
    expect(allowed(item)).toEqual(["ignore"]);
    expect(
      await press(w.context, item, { action: "ignore", id, version: null }),
    ).toEqual({ text: "Ignored.", alert: false });
    expect(allowed({ ...item, state: "ignored" })).toEqual([]);
    expect(await apply(w.context, signal("newer"))).toBe("pictures ignored");
    expect(
      await apply(w.context, {
        repo: REPO,
        installation: 9,
        type: "pull-closed",
        number: 8,
        merged: true,
      }),
    ).toBe("no pictures shown");
  });

  it("are done when their pull request merges or closes, and open again with it", async () => {
    const w = await withArtifact(await artifact(changes));
    await apply(w.context, signal());
    const closed = {
      repo: REPO,
      installation: 9,
      type: "pull-closed",
      number: 8,
    } as const;
    expect(await apply(w.context, { ...closed, merged: false })).toBe(
      "pictures done",
    );
    const done = (await stored(w, keys.pictures(REPO, 8))) as Pictures;
    expect(done).toMatchObject({
      state: "done",
      note: "Closed without a merge.",
    });
    expect(topicName(done, en)).toBe("✅ 🖼 demo#8 Make the <button> blue");
    const [rename] = w.net.telegram("editForumTopic");
    expect(rename?.body.name).toBe("✅ 🖼 demo#8 Make the <button> blue");
    expect(await apply(w.context, { ...closed, merged: true })).toBe(
      "no pictures shown",
    );
    expect(await apply(w.context, { ...closed, number: 9, merged: true })).toBe(
      "no pictures shown",
    );

    // Opened again, with a newer head: a new message in the topic that it had.
    w.net.on("GET", `/repos/${REPO}/pulls/8`, () =>
      json({
        state: "open",
        title: "Make it blue",
        user: { login: "Dennis-Otto" },
        head: { sha: "newer", repo: { full_name: REPO } },
      }),
    );
    expect(await apply(w.context, signal("newer"))).toBe("pictures shown anew");
    const sent = w.net.telegram("sendMessage");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body.message_thread_id).toBe(900);
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);

    const merged = await withArtifact(await artifact(changes));
    await apply(merged.context, signal());
    await apply(merged.context, { ...closed, merged: true });
    expect(await stored(merged, keys.pictures(REPO, 8))).toMatchObject({
      state: "done",
      note: "🔀 Merged.",
    });
  });

  it("tell the control repository about their pull request, in their topic", async () => {
    const w = await withArtifact(await artifact(changes));
    await apply(w.context, signal());
    const item = (await stored(w, keys.pictures(REPO, 8))) as Pictures;
    expect(about(item, START, en)).toMatchObject({
      kind: "pictures",
      number: 8,
      links: [`https://github.com/${REPO}/pull/8`],
    });
  });
});

describe("the pictures of a release", () => {
  async function withRelease(state: Release["state"] = "ready") {
    const w = await withArtifact(await artifact(changes));
    const release: Release = {
      id: await itemId(keys.release(REPO)),
      repo: REPO,
      installation: 9,
      messageId: 7,
      note: null,
      snoozedUntil: null,
      topic: { thread: 800, name: "📦 demo 1.2.0" },
      kind: "release",
      state,
      number: 8,
      version: "1.2.0",
      sha: SHA,
      url: `https://github.com/${REPO}/pull/8`,
    };
    await w.context.store.put(release);
    return w;
  }

  it("go into its topic, below a message of their own, once per head", async () => {
    const w = await withRelease();
    expect(await apply(w.context, signal())).toBe(
      "pictures shown with the release",
    );
    const [message] = w.net.telegram("sendMessage");
    expect(message?.body).toMatchObject({
      message_thread_id: 800,
      reply_markup: { inline_keyboard: [] },
    });
    expect(message?.body.text).toContain("<b>4 pictures look different</b>");
    const [album] = w.net.telegram("sendMediaGroup");
    expect(album?.body).toMatchObject({
      message_thread_id: "800",
      disable_notification: "true",
    });
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      album: SHA,
      messageId: 7,
    });
    expect(await stored(w, keys.pictures(REPO, 8))).toBeNull();
    expect(await apply(w.context, signal())).toBe("pictures shown already");
  });

  it("go into a new topic when the maintainer deleted its own, below the release's message anew", async () => {
    const w = await withRelease();
    withDeletedTopic(w.net, 800, [7]);
    expect(await apply(w.context, signal())).toBe(
      "pictures shown with the release",
    );
    expect(
      w.net.telegram("createForumTopic").map((call) => call.body.name),
    ).toEqual(["📦 demo 1.2.0"]);
    const [refused, own, pictures] = w.net
      .telegram("sendMessage")
      .map((call) => call.body);
    expect(refused?.message_thread_id).toBe(800);
    // The release's own message comes first, with its 🔀 Merge.
    expect(own?.message_thread_id).toBe(900);
    expect(
      own?.reply_markup.inline_keyboard
        .flat()
        .map((button: { text: string }) => button.text),
    ).toContain("🔀 Merge");
    expect(pictures).toMatchObject({
      message_thread_id: 900,
      reply_markup: { inline_keyboard: [] },
    });
    expect(pictures?.text).toContain("<b>4 pictures look different</b>");
    const [album] = w.net.telegram("sendMediaGroup");
    expect(album?.body).toMatchObject({
      message_thread_id: "900",
      disable_notification: "true",
    });
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      album: SHA,
      messageId: 100,
      topic: { thread: 900, name: "📦 demo 1.2.0" },
    });
    expect((await w.context.store.byTopic(900))?.kind).toBe("release");
    expect(await apply(w.context, signal())).toBe("pictures shown already");
  });

  it("go into the main view, below the release's message anew, when Telegram refuses the new topic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const w = await withRelease();
    withDeletedTopic(w.net, 800, [7]).on("POST", /\/createForumTopic$/, () =>
      json({ ok: false, description: "Bad Request: CHAT_NOT_FORUM" }, 400),
    );
    expect(await apply(w.context, signal())).toBe(
      "pictures shown with the release",
    );
    const [, own, pictures] = w.net
      .telegram("sendMessage")
      .map((call) => call.body);
    expect(own).not.toHaveProperty("message_thread_id");
    expect(pictures).not.toHaveProperty("message_thread_id");
    expect(pictures?.reply_parameters).toEqual({
      message_id: 100,
      allow_sending_without_reply: true,
    });
    const [album] = w.net.telegram("sendMediaGroup");
    expect(album?.body).not.toHaveProperty("message_thread_id");
    expect(JSON.parse(album?.body.reply_parameters)).toEqual({
      message_id: 101,
      allow_sending_without_reply: true,
    });
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      messageId: 100,
      topic: null,
    });
    warn.mockRestore();
  });

  it("say below their message why Telegram refused the album", async () => {
    const w = await withRelease();
    w.net.on("POST", /\/sendMediaGroup$/, () =>
      json({ ok: false, description: "Bad Request: too big" }),
    );
    expect(await apply(w.context, signal())).toBe(
      "pictures shown with the release",
    );
    const [edit] = w.net.telegram("editMessageText");
    expect(edit?.body.message_id).toBe(100);
    expect(edit?.body.text).toContain(
      "<i>Telegram refused the pictures: Bad Request: too big</i>",
    );
  });

  it("stay away from a release that was ignored", async () => {
    const w = await withRelease("ignored");
    expect(await apply(w.context, signal())).toBe("pictures ignored");
    expect(w.net.calls).toHaveLength(0);
  });

  it("go into a release without a topic, in reply to its message", async () => {
    const w = await withRelease();
    const release = (await stored(w, keys.release(REPO))) as Release;
    await w.context.store.put({ ...release, topic: null });
    await apply(w.context, signal());
    const [message] = w.net.telegram("sendMessage");
    expect(message?.body.reply_parameters).toEqual({
      message_id: 7,
      allow_sending_without_reply: true,
    });
  });
});

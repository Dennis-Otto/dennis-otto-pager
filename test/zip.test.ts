// The reader of ZIP files: the files of an artifact, stored or deflated, and every
// ZIP that it refuses rather than read past what it may.
import { describe, expect, it } from "vitest";

import { Zip, ZipError } from "../src/zip.ts";
import { zip } from "./zips.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The bytes of a ZIP with one value of its end, or of its directory, changed. */
function patched(
  bytes: Uint8Array,
  at: number,
  value: number,
  size: 2 | 4,
): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  if (size === 2) {
    view.setUint16(at, value, true);
  } else {
    view.setUint32(at, value, true);
  }
  return copy;
}

describe("the files of a ZIP", () => {
  it("reads a stored and a deflated file by name", async () => {
    const bytes = await zip([
      { name: "report.json", data: '{"pictures":[]}' },
      { name: "after/a.png", data: "x".repeat(5000), deflate: true },
    ]);
    const archive = new Zip(bytes);
    const report = archive.get("report.json");
    const picture = archive.get("after/a.png");
    expect(report).toMatchObject({ method: 0, size: 15 });
    expect(picture).toMatchObject({ method: 8, size: 5000 });
    expect(picture?.compressed).toBeLessThan(5000);
    expect(text(await archive.read(report as never))).toBe('{"pictures":[]}');
    expect(text(await archive.read(picture as never))).toBe("x".repeat(5000));
    expect(archive.get("before/a.png")).toBeUndefined();
  });

  it("finds its directory behind a comment", async () => {
    const bytes = await zip([{ name: "a.txt", data: "a" }]);
    const commented = new Uint8Array(bytes.length + 5);
    commented.set(bytes);
    commented.set(new TextEncoder().encode("hello"), bytes.length);
    new DataView(commented.buffer).setUint16(bytes.length - 2, 5, true);
    const archive = new Zip(commented);
    expect(text(await archive.read(archive.get("a.txt") as never))).toBe("a");
  });

  it("leaves out a file that is encrypted or packed in another way", async () => {
    const bytes = await zip([
      { name: "a.txt", data: "a" },
      { name: "b.txt", data: "b" },
    ]);
    const start = new DataView(bytes.buffer).getUint32(bytes.length - 6, true);
    // The flags of the first entry of the directory, and the method of the second.
    const encrypted = patched(bytes, start + 8, 1, 2);
    const second = start + 46 + "a.txt".length;
    const packed = patched(encrypted, second + 10, 12, 2);
    expect(new Zip(packed).get("a.txt")).toBeUndefined();
    expect(new Zip(packed).get("b.txt")).toBeUndefined();
    const big = patched(bytes, start + 24, 0xffffffff, 4);
    expect(new Zip(big).get("a.txt")).toBeUndefined();
    const far = patched(bytes, start + 42, 0xffffffff, 4);
    expect(new Zip(far).get("a.txt")).toBeUndefined();
    const huge = patched(bytes, start + 20, 0xffffffff, 4);
    expect(new Zip(huge).get("a.txt")).toBeUndefined();
  });
});

describe("a ZIP that the reader refuses", () => {
  it("is too short, or has no end of its directory", () => {
    expect(() => new Zip(new Uint8Array(10))).toThrow(ZipError);
    expect(() => new Zip(new Uint8Array(100))).toThrow(
      "no end of the central directory",
    );
  });

  it("is one of ZIP64", async () => {
    const bytes = await zip([{ name: "a.txt", data: "a" }]);
    const end = bytes.length - 22;
    for (const [at, value, size] of [
      [end + 10, 0xffff, 2],
      [end + 12, 0xffffffff, 4],
      [end + 16, 0xffffffff, 4],
    ] as const) {
      expect(() => new Zip(patched(bytes, at, value, size))).toThrow(
        "ZIP64 isn't read",
      );
    }
  });

  it("has a directory that goes past its end, or a broken one", async () => {
    const bytes = await zip([{ name: "a.txt", data: "a" }]);
    const end = bytes.length - 22;
    expect(() => new Zip(patched(bytes, end + 12, 1000, 4))).toThrow(
      "the central directory goes past its end",
    );
    expect(() => new Zip(patched(bytes, end + 10, 2, 2))).toThrow(
      "a broken central directory",
    );
    const start = new DataView(bytes.buffer).getUint32(end + 16, true);
    expect(() => new Zip(patched(bytes, start, 0, 4))).toThrow(
      "a broken central directory",
    );
  });

  it("names a file without its local header, or one past the end", async () => {
    const bytes = await zip([{ name: "a.txt", data: "abc" }]);
    const start = new DataView(bytes.buffer).getUint32(bytes.length - 6, true);
    const moved = new Zip(patched(bytes, start + 42, 7, 4));
    await expect(moved.read(moved.get("a.txt") as never)).rejects.toThrow(
      "no local header for a.txt",
    );
    const outside = new Zip(patched(bytes, start + 42, bytes.length, 4));
    await expect(outside.read(outside.get("a.txt") as never)).rejects.toThrow(
      "no local header",
    );
    const long = new Zip(patched(bytes, start + 20, bytes.length, 4));
    await expect(long.read(long.get("a.txt") as never)).rejects.toThrow(
      "a.txt goes past the end",
    );
  });

  it("stores a file with two sizes", async () => {
    const bytes = await zip([{ name: "a.txt", data: "abc" }]);
    const start = new DataView(bytes.buffer).getUint32(bytes.length - 6, true);
    const archive = new Zip(patched(bytes, start + 24, 2, 4));
    await expect(archive.read(archive.get("a.txt") as never)).rejects.toThrow(
      "a.txt has two sizes",
    );
  });

  it("deflates to more or less than it says, or doesn't inflate", async () => {
    const bytes = await zip([
      { name: "a.txt", data: "a".repeat(100000), deflate: true },
    ]);
    const start = new DataView(bytes.buffer).getUint32(bytes.length - 6, true);
    const larger = new Zip(patched(bytes, start + 24, 10, 4));
    await expect(larger.read(larger.get("a.txt") as never)).rejects.toThrow(
      "a.txt is larger than it says",
    );
    const smaller = new Zip(patched(bytes, start + 24, 100001, 4));
    await expect(smaller.read(smaller.get("a.txt") as never)).rejects.toThrow(
      "a.txt is smaller than it says",
    );
    // A block of a type that deflate doesn't have.
    const broken = bytes.slice();
    broken[30 + "a.txt".length] = 0xff;
    const archive = new Zip(broken);
    await expect(archive.read(archive.get("a.txt") as never)).rejects.toThrow(
      "a.txt doesn't inflate",
    );
  });
});

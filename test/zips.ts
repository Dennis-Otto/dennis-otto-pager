// The test doubles of the pictures: ZIP files as upload-artifact writes them, with
// each file stored or deflated, and the start of a PNG of a given size, which is
// all that the pager reads of a picture.

/** A file of a ZIP: its name, its bytes or text, and whether it is deflated. */
export interface ZipFile {
  name: string;
  data: Uint8Array | string;
  deflate?: boolean;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A ZIP of the files, with a central directory and its end, as a writer makes it. */
export async function zip(files: readonly ZipFile[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const data =
      typeof file.data === "string"
        ? new TextEncoder().encode(file.data)
        : file.data;
    const packed = file.deflate === true ? await deflate(data) : data;
    const method = file.deflate === true ? 8 : 0;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, method, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, packed.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(10, method, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, packed.length, true);
    view.setUint32(24, data.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, packed);
    central.push(entry);
    offset += local.length + packed.length;
  }
  const size = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const bytes = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** The start of a PNG of this size: its signature and its header IHDR, and a few more bytes. */
export function png(width: number, height: number, mark = 0): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes[39] = mark;
  return bytes;
}

/** The report of a visual check, as tests/e2e/visual-compare.mjs writes it. */
export function report(pictures: unknown[]): string {
  return `${JSON.stringify({ pictures }, null, 1)}\n`;
}

/** A picture of a report, and the file of its difference that its entry names, if any. */
export interface Picture {
  path: string;
  status: string;
  share: number | null;
  diff?: string;
  difference?: string;
}

/**
 * The artifact of a visual check: the report, and each picture before and after
 * as PNG, and the picture of its difference that its entry names, deflated as
 * upload-artifact does it.
 */
export async function artifact(
  pictures: Picture[],
  extra: ZipFile[] = [],
): Promise<Uint8Array> {
  const files: ZipFile[] = [
    { name: "report.json", data: report(pictures), deflate: true },
    { name: "summary.md", data: "### Visual check\n", deflate: true },
  ];
  pictures.forEach(({ path, status, diff, difference }, index) => {
    const named = diff ?? difference;
    if (named !== undefined) {
      files.push({
        name: named,
        data: png(800, 600, 200 + index),
        deflate: true,
      });
    }
    if (status !== "new") {
      files.push({
        name: `before/${path}`,
        data: png(800, 600, index),
        deflate: true,
      });
    }
    if (status !== "deleted") {
      files.push({
        name: `after/${path}`,
        data: png(800, 600, 100 + index),
        deflate: true,
      });
    }
  });
  return zip([...files, ...extra]);
}

/** The start of a WebP of this size, with the header of the first chunk of its kind. */
export function webp(
  kind: "VP8X" | "VP8L" | "VP8 ",
  width: number,
  height: number,
  animated = false,
): Uint8Array {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  const ascii = (text: string, at: number) =>
    bytes.set(new TextEncoder().encode(text), at);
  ascii("RIFF", 0);
  view.setUint32(4, 32, true);
  ascii("WEBP", 8);
  ascii(kind, 12);
  view.setUint32(16, 20, true);
  if (kind === "VP8X") {
    // The flags of the extended format: an animation has the second bit.
    bytes[20] = animated ? 2 : 0;
    view.setUint16(24, (width - 1) & 0xffff, true);
    bytes[26] = (width - 1) >> 16;
    view.setUint16(27, (height - 1) & 0xffff, true);
    bytes[29] = (height - 1) >> 16;
  } else if (kind === "VP8L") {
    bytes[20] = 0x2f;
    view.setUint32(
      21,
      ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14),
      true,
    );
  } else {
    bytes.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return bytes;
}

/**
 * The start of a PNG of this size with chunks of these types after its header,
 * each without data: an APNG has acTL before its first IDAT.
 */
export function apng(
  width: number,
  height: number,
  types: readonly string[] = ["acTL", "IDAT"],
): Uint8Array {
  const start = png(width, height).subarray(0, 33);
  const bytes = new Uint8Array(start.length + 12 * types.length);
  bytes.set(start);
  types.forEach((type, index) => {
    bytes.set(new TextEncoder().encode(type), start.length + 12 * index + 4);
  });
  return bytes;
}

/** How a GIF is made: its images, and whether it and each image have a color table. */
export interface GifShape {
  images: number;
  global?: boolean;
  local?: boolean;
  /** Whether the bytes end in the middle of the data of the last image. */
  cut?: boolean;
}

/**
 * A GIF of 2 by 2 pixels: its header and screen, a graphic control extension before
 * each image, each image with a block of data, and its end.
 */
export function gif({
  images,
  global = true,
  local = false,
  cut = false,
}: GifShape): Uint8Array {
  const table = (has: boolean) => (has ? [0, 0, 0, 255, 255, 255] : []);
  const bytes = [
    ...new TextEncoder().encode("GIF89a"),
    2,
    0,
    2,
    0,
    global ? 0x80 : 0,
    0,
    0,
    ...table(global),
  ];
  for (let index = 0; index < images; index += 1) {
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    bytes.push(0x2c, 0, 0, 0, 0, 2, 0, 2, 0, local ? 0x80 : 0, ...table(local));
    bytes.push(2, 2, 0x44, 0x01, 0);
  }
  bytes.push(0x3b);
  return new Uint8Array(cut ? bytes.slice(0, -4) : bytes);
}

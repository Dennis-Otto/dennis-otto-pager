/**
 * A reader of ZIP files, as small as the pager needs it for the artifacts of
 * GitHub Actions: the files that the central directory names, and the bytes of one
 * of them, stored or deflated. An artifact comes from a run of the maintainer's own
 * repository, but the reader still checks every length against the file, refuses
 * what it doesn't know, such as ZIP64 and encryption, and never inflates a file to
 * more than the size that the directory gives it.
 */

/** A file of a ZIP, as its central directory describes it. */
export interface ZipEntry {
  name: string;
  /** 0 for stored, 8 for deflated. */
  method: number;
  /** Its bytes in the ZIP. */
  compressed: number;
  /** Its bytes once read. */
  size: number;
  /** Where its local header starts. */
  offset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** The end of the central directory without its comment, which may take 65535 bytes. */
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
/** The marks of a value that only ZIP64 holds. */
const ZIP64_COUNT = 0xffff;
const ZIP64_SIZE = 0xffffffff;
/** Bit 0 of the flags: the file is encrypted. */
const ENCRYPTED = 1;

const STORED = 0;
const DEFLATED = 8;

export class Zip {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly files = new Map<string, ZipEntry>();

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.readDirectory();
  }

  /** A file by its name, or undefined. */
  get(name: string): ZipEntry | undefined {
    return this.files.get(name);
  }

  /** The bytes of a file. */
  async read(entry: ZipEntry): Promise<Uint8Array> {
    const at = entry.offset;
    if (
      at + 30 > this.bytes.length ||
      this.view.getUint32(at, true) !== LOCAL
    ) {
      throw new ZipError(`no local header for ${entry.name}`);
    }
    const start =
      at +
      30 +
      this.view.getUint16(at + 26, true) +
      this.view.getUint16(at + 28, true);
    const end = start + entry.compressed;
    if (end > this.bytes.length) {
      throw new ZipError(`${entry.name} goes past the end`);
    }
    const data = this.bytes.subarray(start, end);
    if (entry.method === STORED) {
      if (entry.compressed !== entry.size) {
        throw new ZipError(`${entry.name} has two sizes`);
      }
      return data;
    }
    return inflate(data, entry);
  }

  /** The end of the central directory, searched from the end of the file. */
  private findEnd(): number {
    const last = this.bytes.length - END_SIZE;
    const first = Math.max(0, last - MAX_COMMENT);
    for (let at = last; at >= first; at -= 1) {
      if (this.view.getUint32(at, true) === END) {
        return at;
      }
    }
    throw new ZipError("no end of the central directory");
  }

  private readDirectory(): void {
    if (this.bytes.length < END_SIZE) {
      throw new ZipError("too short");
    }
    const end = this.findEnd();
    const count = this.view.getUint16(end + 10, true);
    const size = this.view.getUint32(end + 12, true);
    const start = this.view.getUint32(end + 16, true);
    if (count === ZIP64_COUNT || size === ZIP64_SIZE || start === ZIP64_SIZE) {
      throw new ZipError("ZIP64 isn't read");
    }
    if (start + size > end) {
      throw new ZipError("the central directory goes past its end");
    }
    const names = new TextDecoder();
    let at = start;
    for (let index = 0; index < count; index += 1) {
      if (at + 46 > end || this.view.getUint32(at, true) !== CENTRAL) {
        throw new ZipError("a broken central directory");
      }
      const flags = this.view.getUint16(at + 8, true);
      const method = this.view.getUint16(at + 10, true);
      const compressed = this.view.getUint32(at + 20, true);
      const fileSize = this.view.getUint32(at + 24, true);
      const nameLength = this.view.getUint16(at + 28, true);
      const extraLength = this.view.getUint16(at + 30, true);
      const commentLength = this.view.getUint16(at + 32, true);
      const offset = this.view.getUint32(at + 42, true);
      const name = names.decode(
        this.bytes.subarray(at + 46, at + 46 + nameLength),
      );
      at += 46 + nameLength + extraLength + commentLength;
      // A file that the pager can't read stays out of the list, as if it weren't
      // there: one that is encrypted, or packed in another way, or one of ZIP64.
      const readable =
        (flags & ENCRYPTED) === 0 &&
        (method === STORED || method === DEFLATED) &&
        compressed !== ZIP64_SIZE &&
        fileSize !== ZIP64_SIZE &&
        offset !== ZIP64_SIZE;
      if (readable) {
        this.files.set(name, {
          name,
          method,
          compressed,
          size: fileSize,
          offset,
        });
      }
    }
  }
}

/**
 * Inflate a deflated file, natively, into exactly the size that the directory
 * gives it: a stream that would give more stops at once, so that no file can
 * grow past what the pager agreed to read.
 */
async function inflate(data: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const out = new Uint8Array(entry.size);
  let length = 0;
  const reader = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw new ZipError(`${entry.name} doesn't inflate`);
    }
    if (chunk.done) {
      break;
    }
    if (length + chunk.value.length > entry.size) {
      await reader.cancel();
      throw new ZipError(`${entry.name} is larger than it says`);
    }
    out.set(chunk.value, length);
    length += chunk.value.length;
  }
  if (length !== entry.size) {
    throw new ZipError(`${entry.name} is smaller than it says`);
  }
  return out;
}

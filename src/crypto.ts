/**
 * The cryptography of the pager, all of it with the Web Crypto of the runtime: the
 * signatures of GitHub and of the control repository, the secret header of
 * Telegram and the short ids of the things that it shows.
 */

const encoder = new TextEncoder();

/** The bytes of a text in UTF-8. */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(encoder.encode(text));
}

/** Whether two texts are equal, in a time that doesn't depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  if (left.byteLength !== right.byteLength) {
    // Compare anyway, so that a wrong length takes as long as a wrong text.
    crypto.subtle.timingSafeEqual(left, left);
    return false;
  }
  return crypto.subtle.timingSafeEqual(left, right);
}

/** The bytes of a text of hexadecimal digits, or null when it is none. */
export function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** The hexadecimal digits of bytes. */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** The HMAC with SHA-256 of data under secret, in hexadecimal digits. */
export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret, "sign");
  return toHex(await crypto.subtle.sign("HMAC", key, utf8(data)));
}

/**
 * Whether signature, "sha256=" and the HMAC in hexadecimal digits as GitHub sends
 * it in X-Hub-Signature-256, signs data under secret. Web Crypto compares in
 * constant time.
 */
export async function verifySignature(
  secret: string,
  data: string,
  signature: string | null,
): Promise<boolean> {
  const digest = signature?.startsWith("sha256=")
    ? fromHex(signature.slice(7))
    : null;
  if (digest === null || digest.byteLength !== 32) {
    return false;
  }
  const key = await hmacKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, digest, utf8(data));
}

/** The SHA-256 of a text, in hexadecimal digits. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", utf8(text)));
}

/** Bytes, or a text in UTF-8, in base64, as the contents API of GitHub takes them. */
export function base64(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === "string" ? utf8(data) : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Bytes, or a text in UTF-8, in base64url without padding, as a JWT takes them. */
export function base64url(data: ArrayBuffer | Uint8Array | string): string {
  return base64(data)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

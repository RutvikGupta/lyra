// Short, URL-safe share IDs. Base62, ~10 chars = ~60 bits of entropy —
// plenty for collision avoidance under realistic share volumes (a few
// thousand at most). Generated client- or server-side via crypto.

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function newShareId(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

const ID_RE = /^[A-Za-z0-9]{6,32}$/;

export function isValidShareId(s: string): boolean {
  return ID_RE.test(s);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function key() {
  const secret = process.env.MEETING_SECRET;
  if (!secret || secret.length < 32) throw new Error("MEETING_SECRET is not configured");
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function createMeetingToken(payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    encoder.encode(JSON.stringify(payload))
  );
  const output = new Uint8Array(iv.length + ciphertext.byteLength);
  output.set(iv);
  output.set(new Uint8Array(ciphertext), iv.length);
  return toBase64Url(output);
}

export async function readMeetingToken(token) {
  const value = fromBase64Url(token);
  if (value.length < 29) throw new Error("Invalid meeting link");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: value.slice(0, 12) },
    await key(),
    value.slice(12)
  );
  const payload = JSON.parse(decoder.decode(plaintext));
  if (!payload.expiresAt || new Date(payload.expiresAt) < new Date()) {
    throw new Error("Meeting link has expired");
  }
  return payload;
}

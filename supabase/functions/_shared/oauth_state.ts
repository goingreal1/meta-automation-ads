// Signed, short-lived state token shared by meta-oauth-start and
// meta-oauth-callback -- carries which media buyer initiated the connection
// through Facebook's redirect so it can't be forged or replayed against a
// different buyer. Same HMAC pattern as the ElevenLabs webhook signature.

const STATE_TTL_SECS = 20 * 60;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export async function signState(secret: string, mediaBuyerId: string): Promise<string> {
  const payload = JSON.stringify({ b: mediaBuyerId, t: Math.floor(Date.now() / 1000), n: crypto.randomUUID() });
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
  const sig = await hmac(secret, payloadB64);
  return `${payloadB64}.${toBase64Url(sig)}`;
}

export async function verifyState(secret: string, state: string): Promise<{ mediaBuyerId: string } | null> {
  const [payloadB64, sigB64] = (state || "").split(".");
  if (!payloadB64 || !sigB64) return null;
  const expected = await hmac(secret, payloadB64);
  const got = fromBase64Url(sigB64);
  if (expected.length !== got.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ got[i];
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    if (typeof payload.t !== "number" || Math.abs(Date.now() / 1000 - payload.t) > STATE_TTL_SECS) return null;
    if (typeof payload.b !== "string" || !payload.b) return null;
    return { mediaBuyerId: payload.b };
  } catch {
    return null;
  }
}

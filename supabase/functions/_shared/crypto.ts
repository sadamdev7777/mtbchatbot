const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, typeof data === "string" ? enc.encode(data) : data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Meta: X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(app_secret, raw_body). */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), await hmacSha256Hex(appSecret, rawBody));
}

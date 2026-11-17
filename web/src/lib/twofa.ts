import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

const secret = () => process.env.MFA_CODE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dev-secret";

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string, sessionId: string): string {
  return createHmac("sha256", secret()).update(`${sessionId}:${code}`).digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

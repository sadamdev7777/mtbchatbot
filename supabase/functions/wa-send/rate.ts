import { db } from "../_shared/db.ts";
import { HttpError } from "../_shared/http.ts";

/** Per-channel send rate limit (Meta allows ~80 msg/s per number; we stay well below). */
export const MAX_SENDS_PER_SECOND = Number(Deno.env.get("WA_MAX_SENDS_PER_SECOND") ?? 20);

export async function checkSendRate(channelId: string): Promise<void> {
  const { data, error } = await db().rpc("take_send_token", { p_channel: channelId, p_limit: MAX_SENDS_PER_SECOND });
  if (error) return; // never block sends because the limiter itself failed
  if (data === false) throw new HttpError(429, "rate_limited", "Too many messages per second on this number; retry shortly");
}

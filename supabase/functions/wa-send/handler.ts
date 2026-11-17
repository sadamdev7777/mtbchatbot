import { getCaller, handle, HttpError, json } from "../_shared/http.ts";
import type { SendRequest } from "../_shared/functions.ts";
import { gatewaySend } from "./send.ts";

export const handler = handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
  const caller = await getCaller(req);
  const input = (await req.json()) as SendRequest;
  if (!input?.conversation_id || !input.kind) throw new HttpError(400, "bad_request", "conversation_id and kind are required");
  const result = await gatewaySend(input, caller);
  return json(result, result.ok ? 200 : 502);
});

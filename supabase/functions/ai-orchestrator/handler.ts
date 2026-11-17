import { handle, json } from "../_shared/http.ts";

// Implemented in milestone 6 (router, agents, debounce, re-check, send).
export const handler = handle((_req) => Promise.resolve(json({ ok: true, skipped: "ai_not_enabled" })));

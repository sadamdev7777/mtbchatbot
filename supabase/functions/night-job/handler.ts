// Night job: 00:00–06:00 Asia/Kuala_Lumpur, one phase per hour (pg_cron), Opus does the reading.
import { localParts } from "../_shared/core/time.ts";
import { db } from "../_shared/db.ts";
import { getCaller, handle, HttpError, json, requireRole } from "../_shared/http.ts";
import { contextFor, PHASES, type Phase, phaseForHour, runPhase } from "./phases.ts";

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  requireRole(caller, ["owner", "admin"]);
  const body = await req.json().catch(() => ({}));
  const now = body.now ? new Date(body.now) : new Date();
  const companies = caller.kind === "user" ? [caller.me.company_id] : body.company_id ? [body.company_id] : ((await db().from("companies").select("id")).data ?? []).map((c) => c.id);
  let phases: Phase[];
  if (body.action === "run_all") phases = [...PHASES];
  else if (body.action === "run" && PHASES.includes(body.phase)) phases = [body.phase];
  else {
    const p = phaseForHour(localParts(now).hour);
    if (!p) return json({ ok: true, skipped: "outside 00:00–06:00 MYT" });
    phases = [p];
  }
  if (caller.kind === "user" && body.action !== "run_all" && body.action !== "run") throw new HttpError(400, "bad_request", "use run or run_all");
  const out: Record<string, unknown> = {};
  for (const c of companies) {
    const ctx = await contextFor(c, now);
    out[c] = { report_id: ctx.reportId, report_date: ctx.reportDate, results: {} as Record<string, unknown> };
    for (const p of phases) (out[c] as any).results[p] = await runPhase(ctx, p);
  }
  return json({ ok: true, ...out });
});

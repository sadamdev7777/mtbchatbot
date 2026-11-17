// Runs every minute (pg_cron): broadcasts, follow-ups, after-sales, automation rules.
import { getCaller, handle, HttpError, json } from "../_shared/http.ts";
import { runBroadcasts } from "../_shared/jobs/broadcasts.ts";
import { runAutoClose, runLeave, runStaffReminders, runTemperatureDecay } from "../_shared/jobs/automation.ts";
import { hrOnLeaveToday } from "../_shared/providers/others.ts";
import { runFollowups } from "../_shared/jobs/followups.ts";

export type Task = "broadcasts" | "followups" | "staff_reminders" | "auto_close" | "leave" | "temperature";

export async function runTasks(tasks: Task[], now = new Date()) {
  const out: Record<string, unknown> = {};
  for (const t of tasks) {
    try {
      if (t === "broadcasts") out[t] = await runBroadcasts(now);
      if (t === "followups") out[t] = await runFollowups(now);
      if (t === "staff_reminders") out[t] = await runStaffReminders(now);
      if (t === "auto_close") out[t] = await runAutoClose(now);
      if (t === "leave") out[t] = await runLeave(now, hrOnLeaveToday);
      if (t === "temperature") out[t] = await runTemperatureDecay(now);
    } catch (e) {
      console.error(t, e);
      out[t] = { error: String(e) };
    }
  }
  return out;
}

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  if (caller.kind !== "service") throw new HttpError(403, "forbidden");
  const body = await req.json().catch(() => ({}));
  const now = new Date();
  const tasks: Task[] = body.tasks ?? ["broadcasts", "followups", "staff_reminders", "auto_close", ...(now.getUTCMinutes() % 15 === 0 ? ["leave", "temperature"] as Task[] : [])];
  return json({ ok: true, ...(await runTasks(tasks, now)) });
});

import { execSync } from "node:child_process";
import { admin } from "./helpers";

/** Fresh seed, then make the run deterministic: Nura answers automatically and there are no quiet hours. */
export default async function globalSetup() {
  if (process.env.E2E_SKIP_RESET !== "1") execSync("supabase db reset", { cwd: "..", stdio: "inherit" });
  const db = admin();
  await db.from("agents").update({ mode: "auto", status: "live" }).eq("name", "Nura");
  let data: { id: string; settings: Record<string, unknown> } | null = null;
  for (let i = 0; i < 60 && !data; i++) {
    data = (await db.from("companies").select("id, settings").maybeSingle()).data; // PostgREST restarts after the reset
    if (!data) await new Promise((r) => setTimeout(r, 1000));
  }
  await db.from("companies").update({ settings: { ...data!.settings, quiet_hours: { start: "00:00", end: "00:00" } } }).eq("id", data!.id);
  for (const m of ["farah@mtb.test", "aqil@mtb.test"]) await db.from("members").update({ last_seen_at: new Date().toISOString() }).eq("email", m);
}

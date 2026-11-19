import { apiCaller, json } from "@/lib/api";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

/** Erase a customer and everything we hold about them (owner/admin). The DB part runs as the caller so RLS and role checks apply. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await apiCaller(["owner", "admin"]);
  if (!caller) return json({ error: "Not allowed" }, 403);
  const { id } = await ctx.params;
  const sb = await supabaseServer();
  const { data: paths, error } = await sb.rpc("rpc_erase_contact", { p_contact: id });
  if (error) return json({ error: error.code === "P0002" ? "Contact not found" : error.message }, error.code === "P0002" ? 404 : 400);
  const list = (paths ?? []) as string[];
  let filesFailed = 0;
  for (let i = 0; i < list.length; i += 100) {
    const { error: e } = await supabaseAdmin().storage.from("media").remove(list.slice(i, i + 100));
    if (e) filesFailed += Math.min(100, list.length - i);
  }
  return json({ ok: true, files_deleted: list.length - filesFailed, files_failed: filesFailed });
}

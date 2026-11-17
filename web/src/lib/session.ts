import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { canOpen, homeFor, type Me, type Section } from "@/lib/roles";

/** Current member (RLS-checked, includes the 2-step requirement). Redirects when signed out. */
export const getMe = cache(async (): Promise<Me> => {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");
  const { data: me } = await supabase.rpc("rpc_me");
  if (me) return me as Me;
  const { data: state } = await supabase.rpc("rpc_login_state");
  if (state?.needs_2fa) redirect("/login/verify");
  redirect("/login?error=no_access");
});

export async function requireSection(section: Section): Promise<Me> {
  const me = await getMe();
  if (!canOpen(me.role, section)) redirect(homeFor(me.role));
  return me;
}

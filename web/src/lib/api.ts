import "server-only";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { Me, Role } from "@/lib/roles";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Resolve the caller for an API route. Returns null when signed out or without access. */
export async function apiCaller(roles?: Role[]): Promise<{ me: Me; userId: string; sessionId: string } | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  if (!data?.claims) return null;
  const { data: me } = await sb.rpc("rpc_me");
  if (!me) return null;
  if (roles && !roles.includes((me as Me).role)) return null;
  return { me: me as Me, userId: data.claims.sub as string, sessionId: String(data.claims.session_id ?? "") };
}

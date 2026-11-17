"use client";
import { FUNCTIONS_URL } from "@/lib/env";
import { supabaseBrowser } from "@/lib/supabase/client";

export class FunctionError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Call an Edge Function as the signed-in user. Meta/Claude/TravelBoost are only ever reached server-side. */
export async function callFunction<T = Record<string, unknown>>(name: string, body: unknown): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new FunctionError(res.status, j.error ?? "error", j.message ?? j.error ?? `Request failed (${res.status})`);
  return j as T;
}

"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase/client";
import { homeFor, type Role } from "@/lib/roles";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("error") === "no_access" ? "Your account has no access. Ask your admin." : "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const sb = supabaseBrowser();
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) {
      setError("Wrong email or password.");
      setBusy(false);
      return;
    }
    const { data: state } = await sb.rpc("rpc_login_state");
    if (!state || state.status === "disabled") {
      await sb.auth.signOut();
      setError("Your account has no access. Ask your admin.");
      setBusy(false);
      return;
    }
    if (state.needs_2fa) {
      router.replace(`/login/verify${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`);
      return;
    }
    window.location.assign(params.get("next") ?? homeFor(state.role as Role));
  }

  return (
    <form aria-label="Log in" onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Log in</h1>
        <p className="mt-1 text-sm text-muted">Use the account your admin invited.</p>
      </div>
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" required placeholder="name@muslimtravelbug.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="pw">
        <Input id="pw" type="password" autoComplete="current-password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" size="lg" disabled={busy}>{busy ? "Logging in…" : "Log in"}</Button>
      <p className="text-xs text-muted">New staff? Ask your admin to send an invite from Settings › Staff.</p>
      <p className="text-xs text-muted">Owner and Admin must use 2-step verification: we email you a code after your password.</p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}

"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function AcceptInvitePage() {
  const [ready, setReady] = useState<"loading" | "ok" | "bad">("loading");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const code = new URLSearchParams(window.location.search).get("code");
      if (hash.get("access_token") && hash.get("refresh_token")) {
        const { error: e } = await sb.auth.setSession({ access_token: hash.get("access_token")!, refresh_token: hash.get("refresh_token")! });
        history.replaceState(null, "", window.location.pathname);
        setReady(e ? "bad" : "ok");
      } else if (code) {
        const { error: e } = await sb.auth.exchangeCodeForSession(code);
        setReady(e ? "bad" : "ok");
      } else {
        const { data } = await sb.auth.getSession();
        setReady(data.session ? "ok" : "bad");
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (pw !== pw2) return setError("Passwords do not match.");
    setBusy(true);
    const { error: err } = await supabaseBrowser().auth.updateUser({ password: pw });
    if (err) { setError(err.message); setBusy(false); return; }
    const r = await fetch("/api/staff/accept", { method: "POST" });
    const j = await r.json();
    if (!r.ok) { setError(j.error); setBusy(false); return; }
    window.location.assign(j.needs_2fa ? "/login/verify" : j.home);
  }

  if (ready === "loading") return <p className="text-sm text-muted">Checking your invite…</p>;
  if (ready === "bad") return <p role="alert" className="text-sm text-danger">This invite link is invalid or expired. Ask your admin for a new invite.</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Set your password">
      <div>
        <h1 className="text-xl font-bold text-ink">Welcome to MTB Inbox</h1>
        <p className="mt-1 text-sm text-muted">Set a password to finish joining your team.</p>
      </div>
      <Field label="New password" htmlFor="pw"><Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      <Field label="Repeat password" htmlFor="pw2"><Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
      {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" size="lg" disabled={busy}>Join</Button>
    </form>
  );
}

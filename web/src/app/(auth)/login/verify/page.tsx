"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase/client";

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);

  async function send() {
    setError("");
    const r = await fetch("/api/auth/2fa/send", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error ?? "Could not send the code.");
    else setMsg(`We emailed a 6-digit code to ${j.email}. It expires in 10 minutes.`);
  }

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    send();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth/2fa/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j.error ?? "Wrong code.");
      setBusy(false);
      return;
    }
    window.location.assign(params.get("next") ?? j.home);
  }

  async function cancel() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }

  return (
    <form aria-label="2-step verification" onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">2-step verification</h1>
        <p className="mt-1 text-sm text-muted">{msg || "Sending your code…"}</p>
      </div>
      <Field label="Verification code" htmlFor="code">
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center text-lg tracking-[0.4em]" />
      </Field>
      {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" size="lg" disabled={busy || code.length !== 6}>Verify</Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="font-semibold text-brand" onClick={send}>Send a new code</button>
        <button type="button" className="font-semibold text-muted" onClick={cancel}>Use another account</button>
      </div>
    </form>
  );
}

export default function VerifyPage() {
  return <Suspense><VerifyForm /></Suspense>;
}

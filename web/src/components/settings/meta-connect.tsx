"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { callFunction } from "@/lib/functions";

interface SignupInfo { mock: boolean; app_id: string; config_id: string; graph_version: string; has_app_secret: boolean }
interface FbLoginResponse { authResponse?: { code?: string } | null; status?: string }
interface FbSdk {
  init(o: { appId: string; version: string; xfbml?: boolean; cookie?: boolean; autoLogAppEvents?: boolean }): void;
  login(cb: (r: FbLoginResponse) => void, o: Record<string, unknown>): void;
}
declare global { interface Window { FB?: FbSdk; fbAsyncInit?: () => void } }

let sdkPromise: Promise<FbSdk> | null = null;
function loadSdk(appId: string, version: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, version, xfbml: false, cookie: false, autoLogAppEvents: false });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => { sdkPromise = null; reject(new Error("Could not load the Facebook SDK (blocked by the browser or network?)")); };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

/** WhatsApp Embedded Signup. The browser only receives a one-time code; the token exchange runs in an Edge Function. */
export function MetaConnect({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<SignupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mockOpen, setMockOpen] = useState(false);
  const session = useRef<{ waba_id?: string; phone_number_id?: string; code?: string; cancelled?: string }>({});

  useEffect(() => {
    callFunction<SignupInfo>("integration-test", { action: "meta_signup_info" }).then(setInfo).catch(() => setInfo(null));
  }, []);

  // Facebook posts the chosen WABA / phone number (or where the owner cancelled) to this window.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!/^https:\/\/([a-z]+\.)?facebook\.com$/.test(e.origin)) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (d.event === "FINISH" || d.event === "FINISH_ONLY_WABA") {
          session.current.waba_id = d.data?.waba_id;
          session.current.phone_number_id = d.data?.phone_number_id;
          void maybeFinish();
        } else if (d.event === "CANCEL") {
          session.current.cancelled = d.data?.current_step ?? "cancelled";
        } else if (d.event === "ERROR") {
          setMsg({ ok: false, text: d.data?.error_message ?? "Facebook reported an error" });
          setBusy(false);
        }
      } catch { /* not ours */ }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  async function finish(body: Record<string, unknown>) {
    try {
      const r = await callFunction<{ ok: boolean; message: string }>("integration-test", { action: "meta_embedded_signup", ...body });
      setMsg({ ok: true, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
    session.current = {};
    onDone();
  }

  async function maybeFinish() {
    const s = session.current;
    if (!s.code || !s.waba_id || !s.phone_number_id) return;
    await finish({ code: s.code, waba_id: s.waba_id, phone_number_id: s.phone_number_id });
  }

  async function connect() {
    setMsg(null);
    if (!info) return;
    if (info.mock) { setMockOpen(true); return; }
    setBusy(true);
    session.current = {};
    try {
      const fb = await loadSdk(info.app_id, info.graph_version);
      fb.login((r) => {
        const code = r.authResponse?.code;
        if (!code) {
          const where = session.current.cancelled;
          setMsg({ ok: false, text: where ? `Facebook window closed at step "${where}". Nothing was changed.` : "Facebook login was cancelled. Nothing was changed." });
          setBusy(false);
          return;
        }
        session.current.code = code;
        void maybeFinish();
        // The session info message normally arrives first; give it a moment if it hasn't.
        setTimeout(() => {
          if (session.current.code && !session.current.waba_id) {
            setMsg({ ok: false, text: "Facebook did not say which WhatsApp account was chosen. Try again and finish all the steps." });
            setBusy(false);
          }
        }, 8000);
      }, {
        config_id: info.config_id,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setBusy(false);
    }
  }

  if (!info) return null;
  const missing = !info.mock && (!info.app_id || !info.config_id || !info.has_app_secret);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <p className="text-sm font-semibold">Connect with Facebook</p>
      <p className="text-xs text-muted">
        Log in with Facebook, pick the business, WhatsApp account and number. The token is stored in the vault and the webhook is subscribed for you.
        {info.mock ? " Demo mode: opens a mock Facebook window, no real account is touched." : ""}
      </p>
      <div>
        <Button onClick={connect} disabled={busy || missing}
          className="bg-[#1877F2] text-white hover:bg-[#166FE5]">
          {busy ? "Connecting…" : "Connect with Facebook"}
        </Button>
      </div>
      {missing ? <p className="text-xs text-muted">Fill in the Meta App ID, Embedded Signup configuration ID and App Secret below, then Save.</p> : null}
      {msg ? <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p> : null}

      <Dialog open={mockOpen} onClose={() => setMockOpen(false)} title="Facebook (demo)"
        footer={<>
          <Button variant="ghost" onClick={() => { setMockOpen(false); setMsg({ ok: false, text: "Facebook window closed. Nothing was changed." }); }}>Cancel</Button>
          <Button onClick={() => { setMockOpen(false); setBusy(true); void finish({ code: "mock-code", waba_id: "mock-waba-1", phone_number_id: "mock-phone-1" }); }}>Continue</Button>
        </>}>
        <div className="flex flex-col gap-3 text-sm">
          <p>This stands in for Facebook&rsquo;s signup window while the system runs on mocks.</p>
          <p><span className="font-semibold">Business:</span> Muslimtravelbug Sdn Bhd</p>
          <p><span className="font-semibold">WhatsApp account:</span> MTB (demo)</p>
          <p><span className="font-semibold">Phone number:</span> +60 3-2788 0000 (demo)</p>
        </div>
      </Dialog>
    </div>
  );
}

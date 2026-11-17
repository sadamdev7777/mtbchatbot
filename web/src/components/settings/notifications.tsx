"use client";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardHeader, Toggle } from "@/components/ui/misc";
import { NOTIFICATION_EVENTS } from "@/lib/notification-events";
import { playChime } from "@/lib/sound";
import { supabaseBrowser } from "@/lib/supabase/client";

function urlB64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationSettings() {
  const me = useMe();
  const sb = supabaseBrowser();
  const [prefs, setPrefs] = useState<Record<string, { sound: boolean; push: boolean }>>({});
  const [quiet, setQuiet] = useState<{ start: string; end: string } | null>(null);
  const [pushState, setPushState] = useState<"unknown" | "unsupported" | "ios_install" | "denied" | "off" | "on" | "no_key">("unknown");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb.from("notification_prefs").select("event, sound, push");
    setPrefs(Object.fromEntries((data ?? []).map((p) => [p.event, { sound: p.sound, push: p.push }])));
    const { data: m } = await sb.from("members").select("push_quiet_hours").eq("id", me.member_id).single();
    setQuiet(m?.push_quiet_hours ?? null);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (isIos && !standalone) return setPushState("ios_install");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setPushState("unsupported");
    if (Notification.permission === "denied") return setPushState("denied");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setPushState(sub ? "on" : "off");
  }, [sb, me.member_id]);
  useEffect(() => { load(); }, [load]);

  async function setPref(event: string, field: "sound" | "push", v: boolean) {
    const cur = prefs[event] ?? { sound: true, push: true };
    const next = { ...cur, [field]: v };
    setPrefs({ ...prefs, [event]: next });
    await sb.from("notification_prefs").upsert({ company_id: me.company_id, member_id: me.member_id, event, ...next }, { onConflict: "member_id,event" });
  }

  async function enablePush() {
    setMsg("");
    const { data: key } = await sb.rpc("rpc_push_public_key");
    if (!key) { setPushState("no_key"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setPushState("denied"); return; }
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key as string) });
    const j = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert({
      company_id: me.company_id, member_id: me.member_id, endpoint: j.endpoint!, p256dh: j.keys!.p256dh, auth: j.keys!.auth, user_agent: navigator.userAgent,
    }, { onConflict: "endpoint" });
    setMsg(error ? error.message : "Push notifications are on for this device.");
    load();
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    load();
  }
  async function saveQuiet(q: { start: string; end: string } | null) {
    setQuiet(q);
    await sb.from("members").update({ push_quiet_hours: q }).eq("id", me.member_id);
  }

  const events = NOTIFICATION_EVENTS.filter((e) => me.role !== "accounts" || ["receipt_review", "message_failed", "morning_report"].includes(e.key));
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Push to this phone or computer" description="Push needs the app to allow notifications. Each device is set up separately." />
        <div className="flex flex-col gap-3 p-5 text-sm">
          {pushState === "ios_install" ? (
            <div role="note" className="rounded-lg border border-info-line bg-info-soft p-3 text-info">
              <p className="font-semibold">iPhone and iPad: add MTB Inbox to your Home Screen first</p>
              <ol className="mt-1 list-decimal pl-5"><li>Open this page in Safari.</li><li>Tap the Share button, then &ldquo;Add to Home Screen&rdquo;.</li><li>Open MTB Inbox from the Home Screen and come back here to turn on push.</li></ol>
            </div>
          ) : null}
          {pushState === "unsupported" ? <p className="text-muted">This browser does not support push. You will still hear a sound while MTB Inbox is open.</p> : null}
          {pushState === "denied" ? <p className="text-danger">Notifications are blocked for this site. Allow them in the browser settings, then reload.</p> : null}
          {pushState === "no_key" ? <p className="text-warn-ink">Web Push is not set up yet. The owner can generate the keys in Settings › Integrations. Until then, only the browser sound plays.</p> : null}
          {pushState === "off" || pushState === "no_key" ? <div><Button onClick={enablePush}>Turn on push for this device</Button></div> : null}
          {pushState === "on" ? <div className="flex items-center gap-3"><span className="font-semibold text-success">Push is on for this device.</span><Button size="sm" variant="secondary" onClick={disablePush}>Turn off</Button></div> : null}
          <div><Button size="sm" variant="ghost" onClick={playChime}>Play test sound</Button></div>
          {msg ? <p role="status">{msg}</p> : null}
        </div>
      </Card>
      <Card className="overflow-x-auto">
        <CardHeader title="What to notify me about" />
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-line bg-panel text-xs font-semibold text-muted"><tr><th className="px-4 py-3">Event</th><th className="px-3 py-3">Sound</th><th className="px-3 py-3">Push</th></tr></thead>
          <tbody>
            {events.map((e) => {
              const p = prefs[e.key] ?? { sound: true, push: true };
              return (
                <tr key={e.key} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">{e.label}</td>
                  <td className="px-3 py-3"><Toggle checked={p.sound} onChange={(v) => setPref(e.key, "sound", v)} label={`Sound for ${e.label}`} /></td>
                  <td className="px-3 py-3"><Toggle checked={p.push} onChange={(v) => setPref(e.key, "push", v)} label={`Push for ${e.label}`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="My quiet hours" description="No push during these hours. Notifications still show in the app." />
        <div className="flex flex-wrap items-end gap-3 p-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!quiet} onChange={(e) => saveQuiet(e.target.checked ? { start: "23:00", end: "07:00" } : null)} /> Use quiet hours</label>
          {quiet ? (
            <>
              <Field label="From" htmlFor="q-start"><Input id="q-start" type="time" value={quiet.start} onChange={(e) => saveQuiet({ ...quiet, start: e.target.value })} /></Field>
              <Field label="To" htmlFor="q-end"><Input id="q-end" type="time" value={quiet.end} onChange={(e) => saveQuiet({ ...quiet, end: e.target.value })} /></Field>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

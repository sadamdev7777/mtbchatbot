// SMTP, bank email (IMAP), HRBoost and Meta Ads providers (real + mock).
import { db } from "../db.ts";
import { getIntegration, getSecret, useReal } from "../integrations.ts";

// ---------------------------------------------------------------------------
// Bank notification email (IMAP, read-only)
// ---------------------------------------------------------------------------
export interface RawBankEmail { raw_id: string; from: string; subject: string; received_at: string; text: string }

export interface BankEmailProvider {
  readonly mode: "real" | "mock";
  fetchSince(since: Date): Promise<RawBankEmail[]>;
}

export class ImapBankProvider implements BankEmailProvider {
  readonly mode = "real" as const;
  constructor(private cfg: { host: string; port: number; email: string; password: string }) {}
  async fetchSince(since: Date): Promise<RawBankEmail[]> {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({ host: this.cfg.host, port: this.cfg.port, secure: this.cfg.port === 993, auth: { user: this.cfg.email, pass: this.cfg.password }, logger: false });
    await client.connect();
    const out: RawBankEmail[] = [];
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      for await (const msg of client.fetch({ since }, { envelope: true, source: true, uid: true, internalDate: true })) {
        const source = new TextDecoder().decode(msg.source as Uint8Array);
        out.push({
          raw_id: msg.envelope?.messageId ?? `uid-${msg.uid}`,
          from: msg.envelope?.from?.[0]?.address ?? "",
          subject: msg.envelope?.subject ?? "",
          received_at: new Date(msg.internalDate ?? Date.now()).toISOString(),
          text: extractText(source),
        });
      }
    } finally {
      lock.release();
      await client.logout();
    }
    return out;
  }
  async test(): Promise<string> {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({ host: this.cfg.host, port: this.cfg.port, secure: this.cfg.port === 993, auth: { user: this.cfg.email, pass: this.cfg.password }, logger: false });
    await client.connect();
    const status = await client.status("INBOX", { messages: true });
    await client.logout();
    return `Logged in; INBOX has ${status.messages} messages`;
  }
}

/** Very small MIME text extractor: prefers text/plain, falls back to stripped HTML; decodes quoted-printable/base64. */
export function extractText(source: string): string {
  const parts = source.split(/\r?\n--[^\r\n]+/);
  const pick = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts.find((p) => /content-type:\s*text\/html/i.test(p)) ?? source;
  const [head, ...rest] = pick.split(/\r?\n\r?\n/);
  let body = rest.join("\n\n");
  if (/content-transfer-encoding:\s*base64/i.test(head)) {
    try { body = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s/g, "")), (c) => c.charCodeAt(0))); } catch { /* keep */ }
  } else if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** Mock inbox: rows in mock_state(kind='bank_email') — added by tests or the dev simulator. */
export class MockBankProvider implements BankEmailProvider {
  readonly mode = "mock" as const;
  constructor(private companyId: string) {}
  async fetchSince(since: Date): Promise<RawBankEmail[]> {
    const { data } = await db().from("mock_state").select("ref, data").eq("company_id", this.companyId).eq("kind", "bank_email");
    return (data ?? []).map((r) => ({ raw_id: r.ref, ...(r.data as Omit<RawBankEmail, "raw_id">) })).filter((e) => Date.parse(e.received_at) >= since.getTime());
  }
}

export async function bankProviderFor(companyId: string): Promise<BankEmailProvider | null> {
  if (await useReal(companyId, "bank_email")) return await realBankFor(companyId);
  // Manual mode: without a connected bank inbox, accounts verifies every receipt by hand.
  // The mock inbox is only used when MOCK_PROVIDERS=true (local dev/tests).
  return Deno.env.get("MOCK_PROVIDERS") === "true" ? new MockBankProvider(companyId) : null;
}

export async function realBankFor(companyId: string): Promise<ImapBankProvider> {
  const i = await getIntegration(companyId, "bank_email");
  const pw = await getSecret(companyId, "bank_email", "app_password");
  if (!i.config.host || !i.config.email || !pw) throw new Error("IMAP host, email and app password are required");
  return new ImapBankProvider({ host: i.config.host, port: Number(i.config.port ?? 993), email: i.config.email, password: pw });
}

// ---------------------------------------------------------------------------
// HRBoost: staff on leave today
// ---------------------------------------------------------------------------
export async function hrOnLeaveToday(companyId: string): Promise<string[]> {
  if (!(await useReal(companyId, "hrboost"))) {
    const { data } = await db().from("mock_state").select("data").eq("company_id", companyId).eq("kind", "hr_leave");
    const today = new Date().toISOString().slice(0, 10);
    return (data ?? []).map((r) => r.data as { email: string; date: string }).filter((x) => x.date === today).map((x) => x.email);
  }
  const i = await getIntegration(companyId, "hrboost");
  const key = await getSecret(companyId, "hrboost", "api_key");
  const res = await fetch(`${String(i.config.base_url).replace(/\/$/, "")}/leave/today`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" } });
  if (!res.ok) throw new Error(`HRBoost ${res.status}`);
  const j = await res.json();
  return ((j.data ?? j) as { email: string }[]).map((x) => x.email.toLowerCase());
}

export async function testHrBoost(baseUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/leave/today`, { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } });
  if (!res.ok) throw new Error(`HRBoost answered ${res.status}`);
  const j = await res.json();
  return `${(j.data ?? j).length} staff on leave today`;
}

// ---------------------------------------------------------------------------
// Meta Ads (read-only, ads_read): ad names for the router
// ---------------------------------------------------------------------------
export async function testMetaAds(adAccountId: string, token: string, version: string): Promise<string> {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const res = await fetch(`https://graph.facebook.com/${version}/${id}?fields=name,account_status`, { headers: { authorization: `Bearer ${token}` } });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message ?? `Meta Ads ${res.status}`);
  return `Ad account "${j.name}"`;
}

export async function listAds(companyId: string): Promise<{ id: string; name: string }[]> {
  if (!(await useReal(companyId, "meta_ads"))) return [];
  const i = await getIntegration(companyId, "meta_ads");
  const token = (await getSecret(companyId, "meta_ads", "token")) ?? (await getSecret(companyId, "meta_whatsapp", "token"));
  const id = String(i.config.ad_account_id).startsWith("act_") ? i.config.ad_account_id : `act_${i.config.ad_account_id}`;
  const res = await fetch(`https://graph.facebook.com/${i.config.graph_version ?? "v24.0"}/${id}/ads?fields=id,name&limit=200&effective_status=["ACTIVE"]`, { headers: { authorization: `Bearer ${token}` } });
  const j = await res.json();
  return (j.data ?? []) as { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------
export async function testSmtp(c: { host: string; port: number; user?: string; password?: string }): Promise<string> {
  const nodemailer = (await import("nodemailer")).default;
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: c.user ? { user: c.user, pass: c.password } : undefined });
  await t.verify();
  return `SMTP ${c.host}:${c.port} accepted the login`;
}

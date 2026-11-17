// Meta WhatsApp Cloud API provider. Real client + mock (dev simulator).
import { META_GRAPH_VERSION } from "../env.ts";
import { getIntegration, getSecret, useReal } from "../integrations.ts";

export interface SendResult { ok: true; waMessageId: string }
export interface SendError { ok: false; code: string; message: string }
export type SendOutcome = SendResult | SendError;

export interface TemplateComponentParam { type: "text"; text: string }
export interface MetaTemplate {
  id?: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejected_reason?: string;
  components: unknown[];
}

export interface MetaProvider {
  readonly mode: "real" | "mock";
  sendText(to: string, body: string, replyTo?: string | null): Promise<SendOutcome>;
  sendTemplate(to: string, name: string, language: string, bodyParams: string[], headerParams?: string[]): Promise<SendOutcome>;
  sendInteractiveButtons(to: string, body: string, buttons: { id: string; title: string }[]): Promise<SendOutcome>;
  sendMedia(to: string, kind: "image" | "document" | "audio" | "video", link: string, caption?: string, filename?: string): Promise<SendOutcome>;
  downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  listTemplates(): Promise<MetaTemplate[]>;
  createTemplate(t: { name: string; language: string; category: string; components: unknown[] }): Promise<{ id: string; status: string }>;
  phoneQuality(): Promise<{ quality_rating: string; messaging_limit_tier: string } | null>;
}

export interface MetaConfig { phoneNumberId: string; wabaId: string; token: string }

export class RealMeta implements MetaProvider {
  readonly mode = "real" as const;
  private base: string;
  constructor(private cfg: MetaConfig, version = META_GRAPH_VERSION()) {
    this.base = `https://graph.facebook.com/${version}`;
  }

  private async call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.cfg.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = body?.error ?? {};
      throw Object.assign(new Error(err.message ?? `Meta HTTP ${res.status}`), { code: String(err.code ?? res.status), details: err });
    }
    return body;
  }

  /** Meta throughput limits (130429 cloud API throughput, 131056 pair rate limit): back off and retry twice. */
  private async send(payload: Record<string, unknown>, attempt = 0): Promise<SendOutcome> {
    const r = await this.sendOnce(payload);
    if (!r.ok && ["130429", "131056", "4", "80007"].includes(r.code) && attempt < 2) {
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      return this.send(payload, attempt + 1);
    }
    return r;
  }

  private async sendOnce(payload: Record<string, unknown>): Promise<SendOutcome> {
    try {
      const r = await this.call(`/${this.cfg.phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      });
      return { ok: true, waMessageId: r.messages?.[0]?.id };
    } catch (e) {
      return { ok: false, code: (e as { code?: string }).code ?? "unknown", message: (e as Error).message };
    }
  }

  sendText(to: string, body: string, replyTo?: string | null) {
    return this.send({ to, type: "text", text: { body, preview_url: true }, ...(replyTo ? { context: { message_id: replyTo } } : {}) });
  }
  sendTemplate(to: string, name: string, language: string, bodyParams: string[], headerParams: string[] = []) {
    const components: unknown[] = [];
    if (headerParams.length) components.push({ type: "header", parameters: headerParams.map((t) => ({ type: "text", text: t })) });
    if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) });
    return this.send({ to, type: "template", template: { name, language: { code: language }, components } });
  }
  sendInteractiveButtons(to: string, body: string, buttons: { id: string; title: string }[]) {
    return this.send({
      to, type: "interactive",
      interactive: { type: "button", body: { text: body }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } },
    });
  }
  sendMedia(to: string, kind: "image" | "document" | "audio" | "video", link: string, caption?: string, filename?: string) {
    const media: Record<string, string> = { link };
    if (caption && kind !== "audio") media.caption = caption;
    if (filename && kind === "document") media.filename = filename;
    return this.send({ to, type: kind, [kind]: media });
  }
  async downloadMedia(mediaId: string) {
    const meta = await this.call(`/${mediaId}`);
    const res = await fetch(meta.url, { headers: { authorization: `Bearer ${this.cfg.token}` } });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
  }
  async listTemplates() {
    const out: MetaTemplate[] = [];
    let url: string | null = `/${this.cfg.wabaId}/message_templates?limit=100&fields=id,name,language,category,status,rejected_reason,components`;
    while (url) {
      const page: any = await this.call(url);
      out.push(...(page.data ?? []));
      const next: string | undefined = page.paging?.next;
      url = next ? next.replace(this.base, "") : null;
    }
    return out;
  }
  async createTemplate(t: { name: string; language: string; category: string; components: unknown[] }) {
    const r = await this.call(`/${this.cfg.wabaId}/message_templates`, { method: "POST", body: JSON.stringify(t) });
    return { id: r.id, status: r.status ?? "PENDING" };
  }
  async phoneQuality() {
    const r = await this.call(`/${this.cfg.phoneNumberId}?fields=quality_rating,messaging_limit_tier`);
    return { quality_rating: r.quality_rating, messaging_limit_tier: r.messaging_limit_tier };
  }
}

/**
 * Mock Meta: nothing leaves the system. Outbound messages stay in the messages table where the dev
 * simulator shows them; the simulator posts signed webhooks back for inbound messages and statuses.
 * Recipients whose number ends in "999" fail with 131026 to exercise error paths.
 */
export class MockMeta implements MetaProvider {
  readonly mode = "mock" as const;
  constructor(private templates: () => Promise<MetaTemplate[]> = () => Promise.resolve([])) {}
  private ok(to: string): SendOutcome {
    if (to.endsWith("999")) return { ok: false, code: "131026", message: "Message undeliverable (mock)" };
    return { ok: true, waMessageId: `wamid.mock.${crypto.randomUUID()}` };
  }
  sendText(to: string) { return Promise.resolve(this.ok(to)); }
  sendTemplate(to: string) { return Promise.resolve(this.ok(to)); }
  sendInteractiveButtons(to: string) { return Promise.resolve(this.ok(to)); }
  sendMedia(to: string) { return Promise.resolve(this.ok(to)); }
  downloadMedia(mediaId: string) {
    // The simulator sends media as data: URLs in the media id.
    if (mediaId.startsWith("data:")) {
      const [head, b64] = mediaId.split(",");
      const mime = head.slice(5).replace(";base64", "");
      return Promise.resolve({ bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), mime });
    }
    return Promise.resolve(null);
  }
  /** Mock review: templates submitted (PENDING) come back APPROVED on the next sync. */
  async listTemplates() {
    return (await this.templates()).map((t) => ({ ...t, status: t.status === "PENDING" ? "APPROVED" : t.status }));
  }
  createTemplate(t: { name: string }) { return Promise.resolve({ id: `mock-tpl-${t.name}`, status: "PENDING" }); }
  phoneQuality() { return Promise.resolve({ quality_rating: "GREEN", messaging_limit_tier: "TIER_1K" }); }
}

export async function realMetaFor(companyId: string, channel: { phone_number_id: string | null; waba_id: string | null }): Promise<RealMeta> {
  const integ = await getIntegration(companyId, "meta_whatsapp");
  const token = await getSecret(companyId, "meta_whatsapp", "token");
  if (!token) throw new Error("Meta token is not set");
  return new RealMeta({
    phoneNumberId: channel.phone_number_id ?? integ.config.phone_number_id,
    wabaId: channel.waba_id ?? integ.config.waba_id,
    token,
  }, integ.config.graph_version || META_GRAPH_VERSION());
}

export async function metaFor(
  companyId: string,
  channel: { phone_number_id: string | null; waba_id: string | null },
  mockTemplates?: () => Promise<MetaTemplate[]>,
): Promise<MetaProvider> {
  if (await useReal(companyId, "meta_whatsapp")) return realMetaFor(companyId, channel);
  return new MockMeta(mockTemplates);
}

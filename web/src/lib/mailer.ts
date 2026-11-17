import "server-only";
import nodemailer from "nodemailer";
import { supabaseAdmin } from "@/lib/supabase/server";

interface SmtpConfig { host: string; port: number; user?: string; pass?: string; from: string; secure: boolean }

/**
 * SMTP settings: the company's "Outgoing email SMTP" integration when connected, otherwise the
 * deployment's fallback SMTP (Supabase's SMTP / Mailpit locally) from env.
 */
async function smtpConfig(companyId: string): Promise<SmtpConfig> {
  const admin = supabaseAdmin();
  const { data } = await admin.from("integrations").select("status, config").eq("company_id", companyId).eq("key", "smtp").maybeSingle();
  if (data?.status === "connected") {
    const { data: pass } = await admin.rpc("integration_secret", { p_company: companyId, p_key: "smtp", p_field: "password" });
    const c = data.config as Record<string, string>;
    return { host: c.host, port: Number(c.port ?? 587), user: c.user, pass: (pass as string) ?? undefined, from: c.from, secure: Number(c.port) === 465 };
  }
  return {
    host: process.env.SMTP_HOST ?? "127.0.0.1",
    port: Number(process.env.SMTP_PORT ?? 54325),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM ?? "MTB Inbox <no-reply@mtb.test>",
    secure: Number(process.env.SMTP_PORT) === 465,
  };
}

export async function sendMail(companyId: string, to: string, subject: string, text: string) {
  const c = await smtpConfig(companyId);
  const transport = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
  });
  await transport.sendMail({ from: c.from, to, subject, text });
}

// Payments: bank email polling every 5 minutes (IMAP read-only), receipt reading, verify/ask/reject.
import { db } from "../_shared/db.ts";
import { getCaller, handle, HttpError, json, requireRole } from "../_shared/http.ts";
import { pollBankEmails, receiptFromMessage, rejectPayment, verifyPayment } from "../_shared/payments.ts";

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  const body = await req.json().catch(() => ({}));
  switch (body.action ?? "poll") {
    case "poll": {
      if (caller.kind === "user") requireRole(caller, ["owner", "accounts"]);
      const ids = caller.kind === "user" ? [caller.me.company_id] : ((await db().from("companies").select("id")).data ?? []).map((c) => c.id);
      const out: Record<string, unknown> = {};
      for (const id of ids) out[id] = await pollBankEmails(id);
      return json({ ok: true, results: out });
    }
    case "receipt": {
      if (caller.kind !== "service") throw new HttpError(403, "forbidden");
      return json({ ok: true, verification_id: await receiptFromMessage(body.message_id) });
    }
    case "decide": {
      if (caller.kind !== "user") throw new HttpError(403, "forbidden");
      requireRole(caller, ["owner", "accounts"]); // admin can only view
      const { data: pv } = await db().from("payment_verifications").select("company_id").eq("id", body.verification_id).maybeSingle();
      if (!pv || pv.company_id !== caller.me.company_id) throw new HttpError(404, "not_found");
      if (body.decision === "verify") await verifyPayment(body.verification_id, caller.me.member_id, "verified");
      else if (body.decision === "reject" || body.decision === "ask") await rejectPayment(body.verification_id, caller.me.member_id, body.decision === "ask" ? "asked_customer" : "rejected", String(body.note ?? ""));
      else throw new HttpError(400, "bad_request", "decision must be verify, ask or reject");
      return json({ ok: true });
    }
    default:
      throw new HttpError(400, "bad_request", "unknown action");
  }
});

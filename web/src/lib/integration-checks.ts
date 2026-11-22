/** Demo IDs from the seed; cleared on save so Test connection can look up the real ones. */
export const isDemoId = (v: unknown) => /^mock-/.test(String(v ?? ""));

/** Catches values pasted into the wrong Meta field before they are saved. Returns one problem per field. */
export function checkMetaFields(v: { waba_id?: string; phone_number_id?: string; token?: string; app_secret?: string }): string[] {
  const out: string[] = [];
  const id = /^\d{6,20}$/;
  if (v.waba_id && !id.test(v.waba_id.trim())) out.push("WhatsApp Business Account ID must be digits only, or leave it blank and Test connection will find it.");
  if (v.phone_number_id && !id.test(v.phone_number_id.trim())) out.push("Phone number ID must be digits only (not the phone number itself), or leave it blank and Test connection will find it.");
  const token = v.token?.trim();
  if (token && (!/^EAA/.test(token) || token.length < 100)) out.push("The token should start with EAA and be very long. Copy it again from Business Settings › System users › Generate new token.");
  const sec = v.app_secret?.trim();
  if (sec && /^EAA/.test(sec)) out.push("That looks like the token, not the App Secret. Put it in Permanent System User token.");
  else if (sec && !/^[0-9a-f]{32}$/i.test(sec)) out.push("The App Secret is 32 letters and digits (App settings › Basic › App secret › Show).");
  return out;
}

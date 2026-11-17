/** RFC 4180-ish CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
}

export interface ImportedContact { wa_id: string; name: string | null; email: string | null; state: string | null; labels: string[]; opt_in: boolean }

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const PHONE = ["phone", "phonenumber", "mobile", "mobilenumber", "whatsapp", "whatsappnumber", "number", "contactnumber"];
const NAME = ["name", "fullname", "contactname", "displayname"];
const FIRST = ["firstname"], LAST = ["lastname"];
const EMAIL = ["email", "emailaddress"];
const STATE = ["state", "negeri", "city"];
const LABELS = ["labels", "label", "tags", "tag"];
const OPTIN = ["optin", "subscribed", "subscriber", "whatsappoptin", "marketingoptin", "subscription"];

/** Maps a contacts CSV (generic or SleekFlow export) to contacts. Rows without a valid phone are reported. */
export function mapContactsCsv(text: string): { contacts: ImportedContact[]; skipped: { row: number; reason: string }[]; columns: string[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { contacts: [], skipped: [], columns: [] };
  const header = rows[0].map(norm);
  const find = (keys: string[]) => header.findIndex((h) => keys.includes(h));
  const iPhone = find(PHONE), iName = find(NAME), iFirst = find(FIRST), iLast = find(LAST), iEmail = find(EMAIL),
    iState = find(STATE), iLabels = find(LABELS), iOpt = find(OPTIN);
  const contacts: ImportedContact[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, idx) => {
    const raw = iPhone >= 0 ? r[iPhone] ?? "" : "";
    let wa = raw.replace(/\D/g, "");
    if (wa.startsWith("0")) wa = "6" + wa;
    if (!/^\d{8,15}$/.test(wa)) return skipped.push({ row: idx + 2, reason: `Invalid phone "${raw}"` });
    if (seen.has(wa)) return skipped.push({ row: idx + 2, reason: "Duplicate phone in file" });
    seen.add(wa);
    const name = iName >= 0 ? r[iName]?.trim() : [iFirst >= 0 ? r[iFirst] : "", iLast >= 0 ? r[iLast] : ""].join(" ").trim();
    const optRaw = iOpt >= 0 ? (r[iOpt] ?? "").trim().toLowerCase() : "";
    contacts.push({
      wa_id: wa,
      name: name || null,
      email: iEmail >= 0 ? r[iEmail]?.trim() || null : null,
      state: iState >= 0 ? r[iState]?.trim() || null : null,
      labels: iLabels >= 0 ? (r[iLabels] ?? "").split(/[;,|]/).map((s) => s.trim()).filter(Boolean) : [],
      opt_in: ["yes", "y", "true", "1", "subscribed", "opted in", "optin"].includes(optRaw),
    });
  });
  return { contacts, skipped, columns: rows[0] };
}

export function download(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿" + content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

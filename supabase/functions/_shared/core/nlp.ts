// Light Malay/English parsing used by the mock model and for key details.
const MONTHS: [RegExp, number][] = [
  [/\b(jan|januari|january)\b/i, 1], [/\b(feb|februari|february)\b/i, 2], [/\b(mac|mar|march)\b/i, 3], [/\b(apr|april)\b/i, 4],
  [/\b(mei|may)\b/i, 5], [/\b(jun|june)\b/i, 6], [/\b(jul|julai|july)\b/i, 7], [/\b(ogos|aug|august)\b/i, 8],
  [/\b(sep|sept|september)\b/i, 9], [/\b(okt|oct|oktober|october)\b/i, 10], [/\b(nov|november)\b/i, 11], [/\b(dis|dec|disember|december)\b/i, 12],
];

/** "Mac 2027" → "2027-03"; a month without a year means its next occurrence. */
export function parseMonth(text: string, now = new Date()): string | null {
  for (const [re, m] of MONTHS) {
    const hit = re.exec(text);
    if (!hit) continue;
    const after = text.slice(hit.index, hit.index + 30).match(/\b(20\d\d)\b/);
    let year = after ? Number(after[1]) : now.getUTCFullYear();
    if (!after && m < now.getUTCMonth() + 1) year++;
    return `${year}-${String(m).padStart(2, "0")}`;
  }
  return null;
}

/** "4 dewasa 2 kanak2" → 6, "9 pax" → 9, "untuk 2 orang" → 2. */
export function parsePax(text: string): { total: number; adults: number; children: number } | null {
  const t = text.toLowerCase();
  const adults = Number(t.match(/(\d+)\s*(dewasa|adults?)/)?.[1] ?? 0);
  const children = Number(t.match(/(\d+)\s*(kanak[\s-]?(kanak|2)?|budak|children|child|anak)/)?.[1] ?? 0);
  if (adults || children) return { total: adults + children, adults, children };
  const n = t.match(/(\d+)\s*(pax|orang|org|people|peserta|person)/);
  if (n) return { total: Number(n[1]), adults: Number(n[1]), children: 0 };
  return null;
}

export const MONTH_NAMES_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogos", "Sep", "Okt", "Nov", "Dis"];
export function dayMonthMs(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTH_NAMES_MS[m - 1]}`;
}
export function monthLabelMs(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES_MS[m - 1]} ${y}`;
}

export function unrelatedTopic(text: string): boolean {
  return /(kerja sekolah|homework|matematik|math|resepi|recipe|politik|politic|crypto|bitcoin|saham|forex|tulis(kan)? (esei|karangan)|cerita lucu|joke)/i.test(text);
}

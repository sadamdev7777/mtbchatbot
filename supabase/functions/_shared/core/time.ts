// Pure time helpers (no Deno/Node APIs) shared by Edge Functions and the web app.
// Malaysia has no DST, but we still resolve wall-clock parts through Intl for any IANA zone.

export const DEFAULT_TZ = "Asia/Kuala_Lumpur";
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type OfficeHours = Partial<Record<DayKey, [string, string] | null>>;

export const DEFAULT_OFFICE_HOURS: OfficeHours = {
  mon: ["09:00", "18:00"],
  tue: ["09:00", "18:00"],
  wed: ["09:00", "18:00"],
  thu: ["09:00", "18:00"],
  fri: ["09:00", "18:00"],
  sat: ["09:00", "13:00"],
  sun: null,
};

export interface QuietHours {
  start: string; // "22:00"
  end: string; // "08:00"
  friday_start?: string; // "12:30"
  friday_end?: string; // "14:30"
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  start: "22:00",
  end: "08:00",
  friday_start: "12:30",
  friday_end: "14:30",
};

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: DayKey;
  minutesOfDay: number;
}

export function localParts(date: Date, tz = DEFAULT_TZ): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const weekday = parts.weekday.slice(0, 3).toLowerCase() as DayKey;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute,
    weekday,
    minutesOfDay: hour * 60 + minute,
  };
}

export function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Offset (ms) between the zone's wall clock and UTC at `date`. */
function zoneOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60000) * 60000;
}

/** Build a UTC Date for a wall-clock time in `tz`. */
export function zonedTime(year: number, month: number, day: number, minutesOfDay: number, tz = DEFAULT_TZ): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, Math.floor(minutesOfDay / 60), minutesOfDay % 60));
  return new Date(guess.getTime() - zoneOffsetMs(guess, tz));
}

export function isWithinOfficeHours(date: Date, hours: OfficeHours = DEFAULT_OFFICE_HOURS, tz = DEFAULT_TZ): boolean {
  const p = localParts(date, tz);
  const span = hours[p.weekday];
  if (!span) return false;
  return p.minutesOfDay >= hm(span[0]) && p.minutesOfDay < hm(span[1]);
}

/** Rule 12: quiet hours for outbound automation (22:00–08:00 and Friday prayers). */
export function isQuietHours(date: Date, q: QuietHours = DEFAULT_QUIET_HOURS, tz = DEFAULT_TZ): boolean {
  const p = localParts(date, tz);
  const s = hm(q.start), e = hm(q.end), m = p.minutesOfDay;
  const night = s > e ? m >= s || m < e : m >= s && m < e;
  if (night) return true;
  if (p.weekday === "fri" && q.friday_start && q.friday_end) {
    return m >= hm(q.friday_start) && m < hm(q.friday_end);
  }
  return false;
}

/** The first moment at or after `date` that is outside quiet hours. */
export function nextAllowedSendTime(date: Date, q: QuietHours = DEFAULT_QUIET_HOURS, tz = DEFAULT_TZ): Date {
  if (!isQuietHours(date, q, tz)) return date;
  // step to the next whole minute, then minute by minute (max one day)
  let t = new Date(Math.floor(date.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 24 * 60 && isQuietHours(t, q, tz); i++) {
    t = new Date(t.getTime() + 60000);
  }
  return t;
}

/** Rule 2: true while the customer-service window is open. */
export function isWindowOpen(lastInboundAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const t = typeof lastInboundAt === "string" ? Date.parse(lastInboundAt) : lastInboundAt.getTime();
  return now.getTime() - t < WINDOW_MS;
}

export function windowRemainingMs(lastInboundAt: string | Date | null | undefined, now: Date = new Date()): number {
  if (!lastInboundAt) return 0;
  const t = typeof lastInboundAt === "string" ? Date.parse(lastInboundAt) : lastInboundAt.getTime();
  return Math.max(0, t + WINDOW_MS - now.getTime());
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function monthKey(date: Date, tz = DEFAULT_TZ): string {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-01`;
}

export function dayIndex(date: Date): DayKey {
  return DAY_KEYS[date.getUTCDay()];
}

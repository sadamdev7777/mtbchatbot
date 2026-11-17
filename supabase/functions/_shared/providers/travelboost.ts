// TravelBoost client (contract: docs/travelboost-api.openapi.yaml) + a full mock with seed data.
import { capRows, MAX_ROWS } from "../core/rules.ts";
import { db } from "../db.ts";
import { FUNCTIONS_PUBLIC_URL } from "../env.ts";
import { getIntegration, getSecret, useReal } from "../integrations.ts";

export interface ProductDate {
  group_id: string; product_id: string; product_name: string; destination: string;
  start_date: string; end_date: string; price_adult: number; price_child: number; price_infant: number;
  available: number; deposit: number;
}
export interface Product {
  id: string; name: string; destination: string; days: number; inclusions: string[]; exclusions: string[];
  hotels: string[]; itinerary: { day: number; title: string; activities: string[] }[]; itinerary_pdf_url: string | null;
}
export interface Passenger { name: string; ic?: string | null; passport_no?: string | null; passport_received: boolean; is_lead?: boolean; type?: "adult" | "child" | "infant" }
export interface Booking {
  id: string; status: "locked" | "deposit_paid" | "fully_paid" | "cancelled" | "completed"; product_id: string; product_name: string; group_id: string;
  start_date: string; end_date: string; pax: { adults: number; children: number; infants: number }; passengers: Passenger[];
  invoice_id: string; total: number; paid: number; balance: number; balance_due: string | null; deposit_amount: number;
  lead_name: string; lead_phone: string; lead_email: string | null; deposit_paid: number; url?: string;
}
export interface Invoice { id: string; booking_id: string; total: number; paid: number; balance: number; due_date: string | null; deposit_amount: number }
export interface Customer { id: string; name: string; phone: string; email: string | null; bookings: Booking[] }
export interface LockLink { url: string; expires_at: string; lock_id: string }

export interface SearchResult { rows: ProductDate[]; total: number; exactMatches: number }

export interface TravelBoostProvider {
  readonly mode: "real" | "mock";
  searchProducts(q: { destination?: string; product_ids?: string[]; month?: string; pax?: number }): Promise<SearchResult>;
  getProduct(id: string): Promise<Product | null>;
  findCustomer(phone: string): Promise<Customer | null>;
  getBooking(id: string): Promise<Booking | null>;
  getInvoice(id: string): Promise<Invoice | null>;
  createLockLink(i: { group_id: string; pax: number; lead_name: string; lead_phone: string; lead_email?: string | null }): Promise<LockLink>;
  recordPayment(invoiceId: string, p: { amount: number; paid_at: string; reference: string; method: string }): Promise<Invoice>;
  updatePassengers(bookingId: string, passengers: Passenger[]): Promise<Booking>;
}

// ---------------------------------------------------------------------------
// Real client
// ---------------------------------------------------------------------------
export class RealTravelBoost implements TravelBoostProvider {
  readonly mode = "real" as const;
  constructor(private baseUrl: string, private apiKey: string) {}
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init, headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 404) return null as T;
    if (!res.ok) throw new Error(`TravelBoost ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json() as T;
  }
  async searchProducts(q: { destination?: string; product_ids?: string[]; month?: string; pax?: number }) {
    const sp = new URLSearchParams();
    if (q.destination) sp.set("destination", q.destination);
    if (q.month) sp.set("month", q.month);
    if (q.pax) sp.set("pax", String(q.pax));
    if (q.product_ids?.length) sp.set("product_ids", q.product_ids.join(","));
    const r = await this.call<{ data: ProductDate[]; total: number }>(`/products?${sp}`);
    const rows = r?.data ?? [];
    return { rows: capRows(rows), total: r?.total ?? rows.length, exactMatches: rows.filter((x) => x.available >= (q.pax ?? 1)).length };
  }
  getProduct(id: string) { return this.call<Product | null>(`/products/${encodeURIComponent(id)}`); }
  async findCustomer(phone: string) {
    const r = await this.call<{ data: Customer[] }>(`/customers?phone=${encodeURIComponent(phone)}`);
    return r?.data?.[0] ?? null;
  }
  getBooking(id: string) { return this.call<Booking | null>(`/bookings/${encodeURIComponent(id)}`); }
  getInvoice(id: string) { return this.call<Invoice | null>(`/invoices/${encodeURIComponent(id)}`); }
  createLockLink(i: { group_id: string; pax: number; lead_name: string; lead_phone: string; lead_email?: string | null }) {
    return this.call<LockLink>(`/lock-links`, { method: "POST", body: JSON.stringify(i) });
  }
  async recordPayment(invoiceId: string, p: { amount: number; paid_at: string; reference: string; method: string }) {
    const r = await this.call<{ invoice: Invoice }>(`/invoices/${encodeURIComponent(invoiceId)}/payments`, { method: "POST", body: JSON.stringify(p) });
    return r.invoice;
  }
  updatePassengers(bookingId: string, passengers: Passenger[]) {
    return this.call<Booking>(`/bookings/${encodeURIComponent(bookingId)}/passengers`, { method: "PATCH", body: JSON.stringify({ passengers }) });
  }
}

// ---------------------------------------------------------------------------
// Mock with seed data. Prices/dates are generated deterministically; locks, bookings and payments
// persist in public.mock_state so flows survive across function invocations.
// ---------------------------------------------------------------------------
const MOCK_PRODUCTS: Product[] = [
  {
    id: "tb-kk-kundasang", name: "KK Kundasang 4H3M", destination: "KK Kundasang", days: 4,
    inclusions: ["Penginapan 3 malam (1 malam KK, 2 malam Kundasang)", "Makan halal mengikut itinerari", "Van berhawa dingin", "Tour leader Muslim", "Tiket Desa Dairy Farm & Taman Kinabalu"],
    exclusions: ["Tiket kapal terbang", "Insurans perjalanan", "Tip pemandu"],
    hotels: ["Grandis Hotel KK (atau setaraf)", "Kinabalu Pine Resort (atau setaraf)"],
    itinerary: [
      { day: 1, title: "Tiba di Kota Kinabalu", activities: ["Jemputan di lapangan terbang", "Masjid Bandaraya KK", "Pasar Filipina", "Makan malam"] },
      { day: 2, title: "Kundasang", activities: ["Pekan Nabalu", "Taman Kinabalu", "Ladang teh Sabah", "Check-in Kundasang"] },
      { day: 3, title: "Desa Dairy & Mesilau", activities: ["Desa Dairy Farm", "Mesilau", "Kundasang War Memorial", "BBQ malam"] },
      { day: 4, title: "Pulang", activities: ["Pasar Kundasang", "Hantar ke lapangan terbang"] },
    ],
    itinerary_pdf_url: null,
  },
  {
    id: "tb-semporna", name: "Semporna Island Hopping 3H2M", destination: "Semporna", days: 3,
    inclusions: ["Penginapan 2 malam", "Island hopping Bohey Dulang, Mabul & Kapalai", "Makan halal", "Peralatan snorkeling"],
    exclusions: ["Tiket kapal terbang ke Tawau", "Yuran taman laut"],
    hotels: ["Seafest Hotel Semporna (atau setaraf)"],
    itinerary: [
      { day: 1, title: "Tawau ke Semporna", activities: ["Jemputan Tawau", "Check-in Semporna", "Makan malam makanan laut"] },
      { day: 2, title: "Island hopping", activities: ["Bohey Dulang", "Mabul", "Kapalai", "Snorkeling"] },
      { day: 3, title: "Pulang", activities: ["Hantar ke lapangan terbang Tawau"] },
    ],
    itinerary_pdf_url: null,
  },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Every departure date of the mock catalogue (Dec 2026 – Dec 2027). */
export function mockDates(): (Omit<ProductDate, "available"> & { base: number })[] {
  const out: (Omit<ProductDate, "available"> & { base: number })[] = [];
  const start = new Date("2026-12-03T00:00:00Z"), end = new Date("2027-12-31T00:00:00Z");
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    const ds = iso(d);
    if (dow === 4 || dow === 0) { // KK Kundasang: Thursdays and Sundays
      const month = d.getUTCMonth() + 1;
      const peak = [3, 5, 6, 11, 12].includes(month);
      const price = peak ? 1649 : (hash(ds) % 3 === 0 ? 1499 : 1399);
      let base = 1 + (hash("kk" + ds) % 16); // 1–16 seats
      if (ds === "2027-03-11") base = 8; // the "9 pax but 8 seats" scenario date
      if (ds === "2027-03-04") base = 14;
      out.push({ group_id: `kk-${ds}`, product_id: "tb-kk-kundasang", product_name: "KK Kundasang 4H3M", destination: "KK Kundasang",
        start_date: ds, end_date: iso(addDays(d, 3)), price_adult: price, price_child: price - 200, price_infant: 250, deposit: 300, base });
    }
    if (dow === 5) { // Semporna: Fridays
      out.push({ group_id: `sp-${ds}`, product_id: "tb-semporna", product_name: "Semporna Island Hopping 3H2M", destination: "Semporna",
        start_date: ds, end_date: iso(addDays(d, 2)), price_adult: 1890, price_child: 1590, price_infant: 300, deposit: 500, base: 2 + (hash("sp" + ds) % 14) });
    }
  }
  return out;
}

export class MockTravelBoost implements TravelBoostProvider {
  readonly mode = "mock" as const;
  constructor(private companyId: string) {}

  private async state(kind: string): Promise<{ ref: string; data: any }[]> {
    const { data } = await db().from("mock_state").select("ref, data").eq("company_id", this.companyId).eq("kind", kind);
    return data ?? [];
  }
  private async put(kind: string, ref: string, data: unknown) {
    await db().from("mock_state").upsert({ company_id: this.companyId, kind, ref, data }, { onConflict: "company_id,kind,ref" });
  }
  private async taken(): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    const now = Date.now();
    for (const l of await this.state("tb_lock")) {
      if (l.data.status === "locked" && Date.parse(l.data.expires_at) > now || l.data.status === "booked") m.set(l.data.group_id, (m.get(l.data.group_id) ?? 0) + l.data.pax);
    }
    return m;
  }

  async allDates(): Promise<ProductDate[]> {
    const taken = await this.taken();
    return mockDates().map(({ base, ...d }) => ({ ...d, available: Math.max(0, base - (taken.get(d.group_id) ?? 0)) }));
  }

  async searchProducts(q: { destination?: string; product_ids?: string[]; month?: string; pax?: number }): Promise<SearchResult> {
    const pax = q.pax ?? 1;
    let rows = await this.allDates();
    if (q.product_ids?.length) rows = rows.filter((r) => q.product_ids!.includes(r.product_id));
    if (q.destination) {
      const d = q.destination.toLowerCase();
      rows = rows.filter((r) => r.destination.toLowerCase().includes(d) || d.includes(r.destination.toLowerCase().split(" ").pop()!) || r.product_name.toLowerCase().includes(d));
    }
    if (q.month) rows = rows.filter((r) => r.start_date.startsWith(q.month!));
    rows = rows.filter((r) => Date.parse(r.start_date) > Date.now());
    const total = rows.length;
    // Server-side rule: dates with enough seats first, then the nearest alternatives; at most 8 rows.
    const enough = rows.filter((r) => r.available >= pax);
    const short = rows.filter((r) => r.available < pax && r.available > 0).sort((a, b) => b.available - a.available);
    return { rows: capRows([...enough, ...short], MAX_ROWS), total, exactMatches: enough.length };
  }

  getProduct(id: string) {
    return Promise.resolve(MOCK_PRODUCTS.find((p) => p.id === id) ?? null);
  }

  async findCustomer(phone: string): Promise<Customer | null> {
    const bookings = (await this.state("tb_booking")).map((b) => b.data as Booking).filter((b) => b.lead_phone === phone);
    if (!bookings.length) return null;
    return { id: `cust-${phone}`, name: bookings[0].lead_name, phone, email: bookings[0].lead_email, bookings };
  }

  async getBooking(id: string) {
    return ((await this.state("tb_booking")).find((b) => b.ref === id)?.data as Booking) ?? null;
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const b = (await this.state("tb_booking")).map((x) => x.data as Booking).find((x) => x.invoice_id === id);
    return b ? { id, booking_id: b.id, total: b.total, paid: b.paid, balance: b.balance, due_date: b.balance_due, deposit_amount: b.deposit_amount } : null;
  }

  async createLockLink(i: { group_id: string; pax: number; lead_name: string; lead_phone: string; lead_email?: string | null }): Promise<LockLink> {
    const dates = await this.allDates();
    const d = dates.find((x) => x.group_id === i.group_id);
    if (!d) throw new Error(`Unknown group ${i.group_id}`);
    if (d.available < i.pax) throw new Error(`Only ${d.available} seats left on ${d.start_date}`);
    const lockId = `LK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
    await this.put("tb_lock", lockId, { ...i, status: "pending", expires_at: expires, created_at: new Date().toISOString() });
    return { lock_id: lockId, expires_at: expires, url: `${FUNCTIONS_PUBLIC_URL()}/tb-webhook?mock_lock=${lockId}` };
  }

  /** Mock only: the customer completed the lock form → seats held + booking created (fires seat.locked). */
  async completeLock(lockId: string): Promise<Booking> {
    const lock = (await this.state("tb_lock")).find((l) => l.ref === lockId);
    if (!lock) throw new Error("lock not found");
    const d = (await this.allDates()).find((x) => x.group_id === lock.data.group_id)!;
    const n = (await this.state("tb_booking")).length + 10234;
    const total = d.price_adult * lock.data.pax;
    const booking: Booking = {
      id: `MTB-${n}`, status: "locked", product_id: d.product_id, product_name: d.product_name, group_id: d.group_id,
      start_date: d.start_date, end_date: d.end_date, pax: { adults: lock.data.pax, children: 0, infants: 0 },
      passengers: [{ name: lock.data.lead_name, is_lead: true, passport_received: false, type: "adult" },
        ...Array.from({ length: lock.data.pax - 1 }, (_, k) => ({ name: `Peserta ${k + 2}`, passport_received: false, type: "adult" as const }))],
      invoice_id: `INV-${n}`, total, paid: 0, balance: total, deposit_amount: d.deposit * lock.data.pax,
      balance_due: iso(addDays(new Date(d.start_date), -45)), lead_name: lock.data.lead_name, lead_phone: lock.data.lead_phone,
      lead_email: lock.data.lead_email ?? null, deposit_paid: 0,
    };
    await this.put("tb_lock", lockId, { ...lock.data, status: "locked", booking_id: booking.id });
    await this.put("tb_booking", booking.id, booking);
    return booking;
  }

  async recordPayment(invoiceId: string, p: { amount: number; paid_at: string; reference: string; method: string }): Promise<Invoice> {
    const rows = await this.state("tb_booking");
    const row = rows.find((x) => (x.data as Booking).invoice_id === invoiceId);
    if (!row) throw new Error("invoice not found");
    const b = row.data as Booking;
    b.paid = Math.round((b.paid + p.amount) * 100) / 100;
    b.balance = Math.max(0, Math.round((b.total - b.paid) * 100) / 100);
    b.deposit_paid = b.paid;
    b.status = b.balance <= 0 ? "fully_paid" : b.paid >= b.deposit_amount ? "deposit_paid" : b.status;
    await this.put("tb_booking", b.id, b);
    await this.put("tb_payment", `${invoiceId}:${p.reference}`, { invoice_id: invoiceId, ...p });
    const locks = await this.state("tb_lock");
    const lock = locks.find((l) => l.data.booking_id === b.id);
    if (lock) await this.put("tb_lock", lock.ref, { ...lock.data, status: "booked" });
    return { id: invoiceId, booking_id: b.id, total: b.total, paid: b.paid, balance: b.balance, due_date: b.balance_due, deposit_amount: b.deposit_amount };
  }

  async updatePassengers(bookingId: string, passengers: Passenger[]): Promise<Booking> {
    const b = await this.getBooking(bookingId);
    if (!b) throw new Error("booking not found");
    b.passengers = passengers;
    await this.put("tb_booking", b.id, b);
    return b;
  }
}

export async function travelBoostFor(companyId: string): Promise<TravelBoostProvider> {
  if (await useReal(companyId, "travelboost")) return realTravelBoostFor(companyId);
  return new MockTravelBoost(companyId);
}

export async function realTravelBoostFor(companyId: string): Promise<RealTravelBoost> {
  const integ = await getIntegration(companyId, "travelboost");
  const key = await getSecret(companyId, "travelboost", "api_key");
  if (!integ.config.base_url || !key) throw new Error("TravelBoost base URL and API key are required");
  return new RealTravelBoost(integ.config.base_url, key);
}

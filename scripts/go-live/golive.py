#!/usr/bin/env python3
"""
MTB Inbox go-live: replace the demo data with the real company data from one Excel workbook.

  python3 scripts/go-live/golive.py workbook OUT.xlsx           # blank workbook, prefilled with examples
  python3 scripts/go-live/golive.py check IN.xlsx               # validate only, print the plan
  python3 scripts/go-live/golive.py apply IN.xlsx --target local|live --links-out FILE --confirm "PADAM DATA DEMO"

What `apply` does, in this order:
  1. Creates a login for every person on the Staf sheet and an invite link to set their password
     (Supabase Auth admin "generate_link"; no email is sent, share the link yourself).
  2. In ONE database transaction: deletes every demo chat, contact, payment, broadcast, notification,
     AI run, audit event and demo login; then writes the real staff, teams, AI agents (in training,
     assist mode), routing, company knowledge, FAQ, quick replies and company settings.
     Kept as they are: WhatsApp templates, labels, follow-up and after-sales schedules, automation
     rules, test scenarios, integrations (keys you already saved) and the channel.
  3. Writes the invite links to --links-out (never commit that file: each link logs a person in).

Live target needs the Supabase Management API token (SUPABASE_ACCESS_TOKEN; injected by the proxy
in the build session) and SUPABASE_PROJECT_REF. Local target uses `supabase status` and psql.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass, field

try:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation
except ImportError:  # pragma: no cover
    sys.exit("Install openpyxl first: pip install openpyxl")

ROLES = ["owner", "admin", "team_lead", "staff", "accounts"]
COLOURS = ["#0E7C66", "#175CD3", "#B54708", "#5B4BC4", "#067647", "#B42318", "#93370D", "#4A3AA8"]
PLACEHOLDER = re.compile(r"\[ISI[^\]]*\]|@contoh\.com", re.I)
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CONFIRM = "PADAM DATA DEMO"
APP_URL = os.environ.get("APP_URL", "https://mtb-inbox.netlify.app")

# ---------------------------------------------------------------------------------------------
# Workbook layout. Each sheet: (title, intro line, columns[(key, header, width)]).
# ---------------------------------------------------------------------------------------------
SHEETS = {
    "Syarikat": ("Maklumat syarikat. Isi lajur Nilai sahaja.", [("key", "Perkara", 34), ("value", "Nilai", 40), ("note", "Penerangan", 70)]),
    "Staf": ("Seorang satu baris. Peranan: owner, admin, team_lead, staff, accounts. Sekurang-kurangnya seorang owner.",
             [("name", "Nama", 22), ("email", "Emel", 32), ("role", "Peranan", 14), ("teams", "Team (pisah dengan koma)", 30)]),
    "Team": ("Satu team mesti 'General' = Ya (chat yang tak dapat dikenal pasti masuk ke sini). Tajuk butang dipapar kepada pelanggan bila AI tanya destinasi (maksimum 3 team, 20 aksara).",
             [("name", "Nama team", 20), ("lead", "Emel ketua team (boleh kosong)", 32), ("general", "General? (Ya/Tidak)", 18), ("button", "Tajuk butang untuk pelanggan", 28)]),
    "Agen AI": ("Satu agen AI satu pakej (atau satu kumpulan pakej). Agen baharu bermula dalam mod latihan; owner luluskan dalam app sebelum ia balas pelanggan sendiri.",
                [("name", "Nama agen", 14), ("description", "Pakej (ringkas)", 28), ("team", "Team", 14), ("staff", "Emel staf utama", 28),
                 ("products", "ID produk TravelBoost (koma)", 28), ("keywords", "Kata kunci destinasi (koma)", 36), ("persona", "Personaliti (BM)", 50),
                 ("close", "Arahan jualan (BM)", 50), ("after", "Arahan selepas jualan (BM)", 40), ("package", "Maklumat pakej: termasuk / tidak termasuk / hotel (BM)", 70)]),
    "Pengetahuan": ("Pengetahuan syarikat yang AI guna untuk semua pakej. JANGAN tulis harga atau bilangan seat (AI ambil terus dari TravelBoost).",
                    [("section", "Bahagian", 20), ("content", "Kandungan (BM)", 110)]),
    "FAQ": ("Jawapan rasmi. AI guna ayat ini hampir sama. Lajur Agen kosong = untuk semua pakej.",
            [("question", "Soalan", 36), ("variants", "Cara lain pelanggan tanya (pisah dengan ;)", 40), ("answer", "Jawapan (BM)", 70), ("agent", "Agen (kosong = semua)", 16)]),
    "Balasan Pantas": ("Teks pendek yang staf taip dengan /pintasan dalam chat.",
                       [("shortcut", "Pintasan (huruf kecil)", 18), ("body", "Teks (BM)", 100)]),
}

COMPANY_KEYS = [
    ("company_name", "Muslimtravelbug Sdn Bhd", "Nama syarikat seperti dalam app."),
    ("owner_report_number", "[ISI nombor WhatsApp owner, cth 60123456789]", "Nombor yang terima laporan pagi (format 60…, tanpa + atau sengkang)."),
    ("claude_monthly_cap_rm", "3000", "Had belanja AI sebulan (RM). AI berhenti dan serah kepada staf bila had dicapai."),
    ("quiet_start", "22:00", "Mula waktu senyap (tiada follow-up automatik)."),
    ("quiet_end", "08:00", "Tamat waktu senyap."),
    ("friday_start", "12:30", "Mula rehat solat Jumaat."),
    ("friday_end", "14:30", "Tamat rehat solat Jumaat."),
]

EXAMPLES = {
    "Staf": [["[ISI nama owner]", "[ISI emel owner]", "owner", ""], ["Contoh Staf", "staf1@contoh.com", "staff", "Sabah, General"]],
    "Team": [["Sabah", "", "Tidak", "Sabah"], ["Luar negara", "", "Tidak", "Luar negara"], ["General", "", "Ya", "Lain-lain"]],
    "Agen AI": [["Nura", "KK Kundasang 4D3N", "Sabah", "staf1@contoh.com", "[ISI ID produk TravelBoost]",
                 "kundasang, kk, kota kinabalu, kinabalu, sabah, desa dairy, mesilau",
                 "Nura ialah pembantu AI Muslimtravelbug untuk pakej KK Kundasang. Mesra, ringkas dan jelas. Fokus membantu pelanggan pilih tarikh dan kunci seat.",
                 "Tanya bulan dan bilangan pax dahulu. Senaraikan maksimum 8 tarikh. Selepas beri harga, ajak pelanggan kunci seat.",
                 "Bantu pelanggan selepas deposit: resit, itinerary, passport, peringatan baki.",
                 "- Destinasi: Kota Kinabalu & Kundasang, Sabah.\n- Termasuk: [ISI]\n- Tidak termasuk: [ISI]\n- Hotel: [ISI]"]],
    "Pengetahuan": [
        ["about", "# Tentang MTB\nMuslimtravelbug Sdn Bhd ialah agensi pelancongan Muslim berlesen MOTAC ([ISI no. lesen KPL]) yang berpangkalan di [ISI bandar].\nKami menganjurkan trip berkumpulan mesra Muslim: makanan halal, waktu solat dijaga, tour leader Muslim."],
        ["payments", "# Bayaran\n- Deposit dibayar selepas seat dikunci melalui pautan TravelBoost (pegangan 24 jam).\n- Staf akan hantar pautan bayaran atau maklumat akaun bank selepas seat dikunci.\n- Akaun bank: [ISI nama akaun, bank, nombor akaun].\n- Pelanggan hantar resit dalam chat; pasukan akaun akan sahkan.\n- Baki perlu dijelaskan [ISI] hari sebelum tarikh trip."],
        ["cancellation", "# Polisi pembatalan\n- [ISI polisi deposit jika pelanggan batal]\n- [ISI caj pembatalan dekat tarikh trip]\n- [ISI polisi tukar nama peserta]"],
        ["booking_documents", "# Tempahan & dokumen\n- Untuk kunci seat: nama penuh ketua rombongan, No. IC dan emel.\n- Trip luar negara: passport sah sekurang-kurangnya 6 bulan dari tarikh pulang.\n- Salinan passport dikumpul [ISI] hari sebelum trip."],
        ["language_style", "# Gaya bahasa MTB\n- Panggil pelanggan cik / puan / tuan. Jangan guna \"anda\".\n- Jangan guna perkataan Indonesia: silakan, bisa, dapat, sangat, Bapak, Ibu.\n- Mesej pendek, satu idea satu mesej, maksimum 2–4 mesej setiap giliran.\n- Petik soalan pelanggan dan jawab satu persatu.\n- Emoji sekali sahaja, dalam ucapan salam.\n- Akhiri setiap mesej dengan soalan yang membawa ke arah tempahan.\n- Jangan sebut musim hujan atau cuaca buruk.\n- Nyatakan staf mana yang akan semak dan bila."],
    ],
    "FAQ": [
        ["Boleh bayar ansuran?", "ada ansuran; boleh installment; bayar bulan-bulan", "[ISI jawapan]", ""],
        ["Makanan halal ke?", "makan halal; food halal", "Ya cik, semua makanan dalam pakej MTB adalah halal dan kami jaga waktu solat sepanjang trip.", ""],
    ],
    "Balasan Pantas": [
        ["salam", "Waalaikumussalam cik. Terima kasih kerana menghubungi Muslimtravelbug. Boleh saya bantu?"],
        ["bank", "Akaun bank: [ISI nama akaun, bank, nombor akaun]. Mohon hantar resit dalam chat ini ya cik."],
        ["semak", "Baik cik, saya semak dan maklumkan semula dalam 15 minit."],
    ],
}

INSTRUCTIONS = [
    "MTB Inbox: data untuk go-live",
    "",
    "Workbook ini menggantikan semua data demo dengan data sebenar MTB.",
    "1. Isi setiap tab. Baris contoh boleh diubah atau dipadam.",
    "2. Semua teks bertanda [ISI ...] dan emel @contoh.com mesti diganti. Sistem akan tolak workbook yang masih ada tanda ini.",
    "3. Semua yang pelanggan baca (pengetahuan, FAQ, balasan pantas, arahan agen) mesti dalam Bahasa Melayu.",
    "4. JANGAN tulis harga, tarikh atau bilangan seat. AI ambil maklumat itu terus dari TravelBoost supaya sentiasa tepat.",
    "5. Jangan tulis kata laluan atau API key dalam workbook ini. Key dimasukkan sendiri oleh owner dalam Settings › Integrations.",
    "6. Hantar semula fail ini. Kami semak dahulu, kemudian baru data demo dipadam.",
    "",
    "Selepas go-live:",
    "- Setiap staf terima pautan jemputan (hantar sendiri melalui WhatsApp) untuk tetapkan kata laluan.",
    "- Owner dan admin perlukan emel (SMTP) yang berfungsi untuk kod log masuk 2 langkah.",
    "- Agen AI bermula dalam mod latihan; uji di AI › Test, kemudian owner luluskan.",
    "- Template WhatsApp, label dan jadual follow-up dikekalkan.",
]


def make_workbook(path: str) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Mula"
    for i, line in enumerate(INSTRUCTIONS, 1):
        ws.cell(row=i, column=1, value=line).font = Font(bold=(i == 1), size=14 if i == 1 else 11)
    ws.column_dimensions["A"].width = 130

    head = PatternFill("solid", fgColor="0E7C66")
    for title, (intro, cols) in SHEETS.items():
        s = wb.create_sheet(title)
        s.cell(row=1, column=1, value=intro).font = Font(italic=True, color="555555")
        for c, (_k, h, w) in enumerate(cols, 1):
            cell = s.cell(row=2, column=c, value=h)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = head
            s.column_dimensions[openpyxl.utils.get_column_letter(c)].width = w
        rows = [list(r) for r in COMPANY_KEYS] if title == "Syarikat" else EXAMPLES.get(title, [])
        for r, row in enumerate(rows, 3):
            for c, v in enumerate(row, 1):
                s.cell(row=r, column=c, value=v).alignment = Alignment(wrap_text=True, vertical="top")
        s.freeze_panes = "A3"
        if title == "Staf":
            dv = DataValidation(type="list", formula1='"' + ",".join(ROLES) + '"', allow_blank=True)
            s.add_data_validation(dv)
            dv.add("C3:C200")
        if title == "Team":
            dv = DataValidation(type="list", formula1='"Ya,Tidak"', allow_blank=True)
            s.add_data_validation(dv)
            dv.add("C3:C50")
    wb.save(path)


# ---------------------------------------------------------------------------------------------
# Reading + validation
# ---------------------------------------------------------------------------------------------
@dataclass
class Plan:
    company: dict = field(default_factory=dict)
    staff: list = field(default_factory=list)
    teams: list = field(default_factory=list)
    agents: list = field(default_factory=list)
    knowledge: list = field(default_factory=list)
    faq: list = field(default_factory=list)
    quick: list = field(default_factory=list)
    errors: list = field(default_factory=list)


def _clean(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _rows(wb, title: str) -> list[dict]:
    if title not in wb.sheetnames:
        return []
    keys = [k for k, _h, _w in SHEETS[title][1]]
    out = []
    for n, row in enumerate(wb[title].iter_rows(min_row=3, values_only=True), 3):
        vals = [_clean(v) for v in row[: len(keys)]] + [""] * max(0, len(keys) - len(row))
        if any(vals):
            d = dict(zip(keys, vals))
            d["_row"] = n
            out.append(d)
    return out


def _split(s: str, sep: str = ",") -> list[str]:
    return [x.strip() for x in s.split(sep) if x.strip()]


def read_plan(path: str) -> Plan:
    wb = openpyxl.load_workbook(path, data_only=True)
    p = Plan()
    err = p.errors.append

    for r in _rows(wb, "Syarikat"):
        p.company[r["key"]] = r["value"]
    for k, _d, _n in COMPANY_KEYS:
        if not p.company.get(k):
            err(f"Syarikat: '{k}' is empty")
    num = re.sub(r"\D", "", p.company.get("owner_report_number", ""))
    if p.company.get("owner_report_number") and not PLACEHOLDER.search(p.company["owner_report_number"]) and not re.fullmatch(r"60\d{8,10}", num):
        err("Syarikat: owner_report_number must look like 60123456789")
    p.company["owner_report_number"] = num
    for k in ("quiet_start", "quiet_end", "friday_start", "friday_end"):
        if p.company.get(k) and not re.fullmatch(r"\d{1,2}:\d{2}", p.company[k]):
            err(f"Syarikat: '{k}' must be a time like 22:00")
    try:
        float(p.company.get("claude_monthly_cap_rm") or "x")
    except ValueError:
        err("Syarikat: claude_monthly_cap_rm must be a number")

    seen = set()
    for i, r in enumerate(_rows(wb, "Staf")):
        r["email"] = r["email"].lower()
        r["role"] = r["role"].lower()
        r["teams"] = _split(r["teams"])
        r["colour"] = COLOURS[i % len(COLOURS)]
        where = f"Staf row {r['_row']}"
        if not r["name"]:
            err(f"{where}: name is empty")
        if not EMAIL.match(r["email"]):
            err(f"{where}: '{r['email']}' is not an email")
        if r["email"] in seen:
            err(f"{where}: {r['email']} appears twice")
        seen.add(r["email"])
        if r["role"] not in ROLES:
            err(f"{where}: role must be one of {', '.join(ROLES)}")
        p.staff.append(r)
    if not any(s["role"] == "owner" for s in p.staff):
        err("Staf: at least one person must have the role owner")

    for r in _rows(wb, "Team"):
        r["general"] = r["general"].lower() in ("ya", "yes", "y", "true", "1")
        r["lead"] = r["lead"].lower()
        if r["lead"] and r["lead"] not in seen:
            err(f"Team row {r['_row']}: lead {r['lead']} is not on the Staf sheet")
        if len(r["button"]) > 20:
            err(f"Team row {r['_row']}: button title is longer than 20 characters")
        p.teams.append(r)
    team_names = [t["name"] for t in p.teams]
    if sum(t["general"] for t in p.teams) != 1:
        err("Team: exactly one team must have General = Ya")
    if len(set(n.lower() for n in team_names)) != len(team_names):
        err("Team: two teams have the same name")
    lower_teams = {n.lower(): n for n in team_names}
    for s in p.staff:
        for t in s["teams"]:
            if t.lower() not in lower_teams:
                err(f"Staf row {s['_row']}: team '{t}' is not on the Team sheet")
        s["teams"] = [lower_teams.get(t.lower(), t) for t in s["teams"]]

    for r in _rows(wb, "Agen AI"):
        where = f"Agen AI row {r['_row']}"
        r["products"] = _split(r["products"])
        r["keywords"] = [k.lower() for k in _split(r["keywords"])]
        r["staff"] = r["staff"].lower()
        if not r["name"]:
            err(f"{where}: name is empty")
        if r["team"] and r["team"].lower() not in lower_teams:
            err(f"{where}: team '{r['team']}' is not on the Team sheet")
        r["team"] = lower_teams.get(r["team"].lower(), "") if r["team"] else ""
        if r["staff"] and r["staff"] not in seen:
            err(f"{where}: {r['staff']} is not on the Staf sheet")
        if not r["products"]:
            err(f"{where}: add at least one TravelBoost product id")
        if not r["persona"] or not r["package"]:
            err(f"{where}: personality and package information are required")
        p.agents.append(r)
    agent_names = {a["name"].lower(): a["name"] for a in p.agents}
    if len(agent_names) != len(p.agents):
        err("Agen AI: two agents have the same name")

    for r in _rows(wb, "Pengetahuan"):
        r["section"] = re.sub(r"[^a-z0-9_]+", "_", r["section"].lower()).strip("_")
        if not r["section"] or not r["content"]:
            err(f"Pengetahuan row {r['_row']}: section and content are both required")
        p.knowledge.append(r)
    if len({k["section"] for k in p.knowledge}) != len(p.knowledge):
        err("Pengetahuan: a section appears twice; put it in one row")

    for r in _rows(wb, "FAQ"):
        r["variants"] = _split(r["variants"], ";")
        if not r["question"] or not r["answer"]:
            err(f"FAQ row {r['_row']}: question and answer are both required")
        if r["agent"] and r["agent"].lower() not in agent_names:
            err(f"FAQ row {r['_row']}: agent '{r['agent']}' is not on the Agen AI sheet")
        r["agent"] = agent_names.get(r["agent"].lower(), "") if r["agent"] else ""
        p.faq.append(r)

    for r in _rows(wb, "Balasan Pantas"):
        r["shortcut"] = r["shortcut"].lower().lstrip("/")
        if not re.fullmatch(r"[a-z0-9_-]{1,30}", r["shortcut"]) or not r["body"]:
            err(f"Balasan Pantas row {r['_row']}: shortcut must be one word (letters/numbers) and text is required")
        p.quick.append(r)

    # Anything still holding a placeholder blocks the go-live.
    for title in SHEETS:
        for r in _rows(wb, title):
            for k, v in r.items():
                if k != "_row" and isinstance(v, str) and PLACEHOLDER.search(v):
                    err(f"{title} row {r['_row']}: replace the placeholder in '{dict((a, b) for a, b, _ in SHEETS[title][1]).get(k, k)}'")
    return p


def summary(p: Plan) -> str:
    lines = [
        f"Company: {p.company.get('company_name')}  (morning report to {p.company.get('owner_report_number') or '-'})",
        f"Staff ({len(p.staff)}): " + ", ".join(f"{s['name']} <{s['email']}> {s['role']}" for s in p.staff),
        f"Teams ({len(p.teams)}): " + ", ".join(t["name"] + (" [general]" if t["general"] else "") for t in p.teams),
        f"AI agents ({len(p.agents)}, all start in training + assist): " + ", ".join(a["name"] for a in p.agents),
        f"Knowledge sections: " + ", ".join(k["section"] for k in p.knowledge),
        f"FAQ: {len(p.faq)}   Quick replies: {len(p.quick)}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------------------------
def q(s: str | None) -> str:
    return "null" if s is None or s == "" else "'" + s.replace("'", "''") + "'"


def qs(s: str) -> str:
    """Like q() but an empty string stays an empty string (for NOT NULL text columns)."""
    return "'" + (s or "").replace("'", "''") + "'"


def arr(xs: list[str]) -> str:
    return "array[" + ",".join(q(x) for x in xs) + "]::text[]"


WIPE_TABLES = [  # company-scoped demo activity, children before parents where there is no cascade
    "broadcast_recipients", "broadcasts", "notifications", "push_subscriptions", "notification_prefs", "mfa_codes",
    "payment_verifications", "bank_emails", "ai_drafts", "ai_runs", "followup_jobs", "test_runs", "night_reports",
    "suggestions", "itinerary_questions", "itineraries", "conversation_labels", "notes", "messages", "conversations",
    "contacts", "spend", "webhook_events", "official_answers", "knowledge_docs", "routing_rules",
    "agents", "team_members", "teams",
]


def build_sql(p: Plan, company_id: str, user_ids: dict[str, str]) -> str:
    c = company_id
    out = ["begin;", "set local statement_timeout = '120s';",
           f"create temporary table golive_old_users on commit drop as select user_id from public.members where company_id = {q(c)} and user_id is not null;"]
    for t in WIPE_TABLES:
        out.append(f"delete from public.{t} where company_id = {q(c)};")
    out.append(f"delete from public.members where company_id = {q(c)};")
    out.append("delete from auth.users where id in (select user_id from golive_old_users) and id not in (select unnest(" + arr(list(user_ids.values())) + ")::uuid);")

    # members
    for s in p.staff:
        out.append(
            "insert into public.members (company_id, user_id, email, role, display_name, status, avatar_color) values "
            f"({q(c)}, {q(user_ids[s['email']])}, {q(s['email'])}, {q(s['role'])}, {q(s['name'])}, 'invited', {q(s['colour'])});")
    mem = lambda email: f"(select id from public.members where company_id = {q(c)} and email = {q(email)})" if email else "null"  # noqa: E731
    team = lambda name: f"(select id from public.teams where company_id = {q(c)} and name = {q(name)})" if name else "null"  # noqa: E731
    agent = lambda name: f"(select id from public.agents where company_id = {q(c)} and name = {q(name)})"  # noqa: E731

    for t in p.teams:
        out.append(f"insert into public.teams (company_id, name, is_general, lead_member_id) values ({q(c)}, {q(t['name'])}, {str(t['general']).lower()}, {mem(t['lead'])});")
    for s in p.staff:
        for t in s["teams"]:
            out.append(f"insert into public.team_members (company_id, team_id, member_id) values ({q(c)}, {team(t)}, {mem(s['email'])});")
    for a in p.agents:
        out.append(
            "insert into public.agents (company_id, name, description, persona, team_id, default_staff_member_id, mode, status, "
            "travelboost_product_ids, destination_keywords, close_sale_instructions, aftersales_instructions) values "
            f"({q(c)}, {q(a['name'])}, {q(a['description'])}, {q(a['persona'])}, {team(a['team'])}, {mem(a['staff'])}, 'assist', 'training', "
            f"{arr(a['products'])}, {arr(a['keywords'])}, {qs(a['close'])}, {qs(a['after'])});")
        out.append(
            "insert into public.knowledge_docs (company_id, scope, agent_id, section, version, status, source, content, activated_at) values "
            f"({q(c)}, 'agent', {agent(a['name'])}, 'package', 1, 'active', 'owner', {q(a['package'])}, now());")

    # routing: one keyword rule per agent, an optional ask-the-customer rule over the non-general teams, then the fallback
    prio = 20
    for a in p.agents:
        if a["keywords"]:
            out.append(f"insert into public.routing_rules (company_id, priority, type, match, target_agent_id) values ({q(c)}, {prio}, 'keyword', "
                       f"{q(json.dumps({'keywords': a['keywords']}, ensure_ascii=False))}::jsonb, {agent(a['name'])});")
            prio += 1
    ask = [t for t in p.teams if t["button"]][:3]
    if len(ask) >= 2:
        buttons = [{"id": f"team_{i + 1}", "title": t["button"]} for i, t in enumerate(ask)]
        answers = ", ".join(f"'{b['id']}', jsonb_build_object('team', {team(t['name'])})" for b, t in zip(buttons, ask))
        out.append(
            f"insert into public.routing_rules (company_id, priority, type, match) values ({q(c)}, 30, 'ask', jsonb_build_object("
            f"'text', {q('Assalamualaikum! Cik berminat destinasi mana?')}, 'buttons', {q(json.dumps(buttons, ensure_ascii=False))}::jsonb, "
            f"'answers', jsonb_build_object({answers})));")
    general = next(t for t in p.teams if t["general"])
    out.append(f"insert into public.routing_rules (company_id, priority, type, match, target_team_id) values ({q(c)}, 99, 'fallback', '{{}}', {team(general['name'])});")

    for k in p.knowledge:
        out.append("insert into public.knowledge_docs (company_id, scope, section, version, status, source, content, activated_at) values "
                   f"({q(c)}, 'company', {q(k['section'])}, 1, 'active', 'owner', {q(k['content'])}, now());")
    for f in p.faq:
        scope, aid = ("agent", agent(f["agent"])) if f["agent"] else ("company", "null")
        out.append("insert into public.official_answers (company_id, scope, agent_id, question, variants, answer, source) values "
                   f"({q(c)}, {q(scope)}, {aid}, {q(f['question'])}, {arr(f['variants'])}, {q(f['answer'])}, 'owner');")
    out.append(f"delete from public.quick_replies where company_id = {q(c)};")
    for r in p.quick:
        out.append(f"insert into public.quick_replies (company_id, shortcut, body) values ({q(c)}, {q(r['shortcut'])}, {q(r['body'])});")

    co = p.company
    settings = {
        "owner_report_number": co["owner_report_number"],
        "claude_monthly_cap_rm": float(co["claude_monthly_cap_rm"]),
        "quiet_hours": {"start": co["quiet_start"], "end": co["quiet_end"], "friday_start": co["friday_start"], "friday_end": co["friday_end"]},
        "require_2fa": True,
    }
    out.append(f"update public.companies set name = {q(co['company_name'])}, settings = settings || {q(json.dumps(settings))}::jsonb where id = {q(c)};")
    # Audit rows written by the triggers above describe the wipe itself; keep only those.
    out.append(f"delete from public.events where company_id = {q(c)} and created_at < now();")
    out.append("commit;")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------------------------
def _ssl() -> ssl.SSLContext:
    ca = os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None)
    return ssl.create_default_context(cafile=ca)


def http(method: str, url: str, headers: dict, body=None) -> tuple[int, dict | list | str]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, context=_ssl(), timeout=150) as r:
            raw = r.read().decode()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode(), e.code
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, raw


class Target:
    auth_url: str
    service_key: str

    def sql(self, query: str) -> list:  # pragma: no cover - interface
        raise NotImplementedError


class Local(Target):
    def __init__(self) -> None:
        env = subprocess.run(["supabase", "status", "-o", "env"], capture_output=True, text=True, check=True).stdout
        vals = dict(re.findall(r'^([A-Z_]+)="?(.*?)"?$', env, re.M))
        self.auth_url = vals["API_URL"]
        self.service_key = vals["SERVICE_ROLE_KEY"]
        self.db = vals["DB_URL"]

    def sql(self, query: str) -> list:
        with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
            f.write(query)
        r = subprocess.run(["psql", self.db, "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "\t", "-f", f.name], capture_output=True, text=True)
        os.unlink(f.name)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return [line.split("\t") for line in r.stdout.splitlines() if line]


class Live(Target):
    def __init__(self) -> None:
        self.ref = os.environ.get("SUPABASE_PROJECT_REF") or sys.exit("Set SUPABASE_PROJECT_REF")
        self.token = os.environ.get("SUPABASE_ACCESS_TOKEN") or sys.exit("Set SUPABASE_ACCESS_TOKEN")
        self.api = "https://api.supabase.com/v1/projects/" + self.ref
        self.auth_url = f"https://{self.ref}.supabase.co"
        st, keys = http("GET", self.api + "/api-keys?reveal=true", self._h())
        if st != 200:
            sys.exit(f"Could not read the project keys ({st}): {keys}")
        self.service_key = next(k["api_key"] for k in keys if k.get("name") == "service_role")

    def _h(self) -> dict:
        return {"authorization": "Bearer " + self.token}

    def sql(self, query: str) -> list:
        st, res = http("POST", self.api + "/database/query", self._h(), {"query": query})
        if st >= 300:
            raise RuntimeError(f"{st}: {res}")
        return [list(r.values()) for r in res] if isinstance(res, list) else []


def invite(t: Target, email: str, name: str) -> tuple[str, str]:
    """Creates (or finds) the login and returns (user_id, one-time link to set the password)."""
    h = {"apikey": t.service_key, "authorization": "Bearer " + t.service_key}
    redirect = APP_URL.rstrip("/") + "/invite/accept"
    for kind in ("invite", "magiclink"):
        st, r = http("POST", t.auth_url + "/auth/v1/admin/generate_link", h,
                     {"type": kind, "email": email, "data": {"display_name": name}, "redirect_to": redirect})
        if st < 300 and isinstance(r, dict):
            uid = r.get("id") or (r.get("user") or {}).get("id")
            link = r.get("action_link") or (r.get("properties") or {}).get("action_link")
            if uid and link:
                return uid, link
        msg = json.dumps(r).lower()
        if kind == "invite" and st in (400, 422) and ("registered" in msg or "exists" in msg):
            continue
        raise RuntimeError(f"Could not create the login for {email} ({st}): {r}")
    raise RuntimeError(f"Could not create the login for {email}")


def apply(p: Plan, t: Target, links_out: str) -> None:
    rows = t.sql("select id::text, name from public.companies order by created_at;")
    if len(rows) != 1:
        sys.exit(f"Expected exactly one company, found {len(rows)}")
    company_id = rows[0][0]
    user_ids, links = {}, []
    for s in p.staff:
        uid, link = invite(t, s["email"], s["name"])
        user_ids[s["email"]] = uid
        links.append(f"{s['name']} <{s['email']}> ({s['role']})\n{link}\n")
        print(f"  login ready: {s['email']}")
    t.sql(build_sql(p, company_id, user_ids))
    with open(links_out, "w") as f:
        f.write("MTB Inbox invite links. Each link works once and expires after the Auth email OTP expiry (1 hour by default).\n"
                "Send each person only their own link. Expired? Run: golive.py relink --target live --links-out FILE EMAIL...\n\n")
        f.write("\n".join(links))
    os.chmod(links_out, 0o600)
    left = t.sql(f"select (select count(*) from public.members where company_id = '{company_id}'), (select count(*) from public.conversations where company_id = '{company_id}'), (select count(*) from public.agents where company_id = '{company_id}');")
    print(f"Done. members={left[0][0]} conversations={left[0][1]} agents={left[0][2]}. Invite links: {links_out}")


def relink(t: Target, emails: list[str], links_out: str) -> None:
    """New one-time links for people who already exist (expired or lost link). Changes no data."""
    rows = t.sql("select email, display_name, role from public.members where email = any(" + arr([e.lower() for e in emails]) + ");")
    found = {r[0]: r for r in rows}
    missing = [e for e in emails if e.lower() not in found]
    if missing:
        sys.exit("Not staff in MTB Inbox: " + ", ".join(missing))
    with open(links_out, "w") as f:
        f.write("MTB Inbox login links. Each works once. Send each person only their own link.\n\n")
        for email, name, role in found.values():
            _uid, link = invite(t, email, name)
            f.write(f"{name} <{email}> ({role})\n{link}\n\n")
    os.chmod(links_out, 0o600)
    print(f"Wrote {len(found)} link(s) to {links_out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("workbook").add_argument("out")
    sub.add_parser("check").add_argument("xlsx")
    a = sub.add_parser("apply")
    a.add_argument("xlsx")
    a.add_argument("--target", choices=["local", "live"], required=True)
    a.add_argument("--links-out", required=True)
    a.add_argument("--confirm", default="")
    rl = sub.add_parser("relink", help="new one-time login links for existing staff")
    rl.add_argument("emails", nargs="+")
    rl.add_argument("--target", choices=["local", "live"], required=True)
    rl.add_argument("--links-out", required=True)
    sql = sub.add_parser("sql", help="print the SQL with placeholder user ids (for review)")
    sql.add_argument("xlsx")
    args = ap.parse_args()

    if args.cmd == "workbook":
        make_workbook(args.out)
        print(f"Wrote {args.out}")
        return
    if args.cmd == "relink":
        relink(Local() if args.target == "local" else Live(), args.emails, args.links_out)
        return
    p = read_plan(args.xlsx)
    print(summary(p))
    if p.errors:
        print("\nFix these first:\n  - " + "\n  - ".join(p.errors))
        sys.exit(1)
    print("\nWorkbook OK.")
    if args.cmd == "sql":
        print(build_sql(p, "00000000-0000-0000-0000-000000000001", {s["email"]: f"00000000-0000-0000-0000-{i:012d}" for i, s in enumerate(p.staff)}))
    if args.cmd == "apply":
        if args.confirm != CONFIRM:
            sys.exit(f'This deletes every demo chat, contact, payment and login. Re-run with --confirm "{CONFIRM}".')
        apply(p, Local() if args.target == "local" else Live(), args.links_out)


if __name__ == "__main__":
    main()

# Go-live: dari demo ke data sebenar

Sekarang MTB Inbox berjalan dengan data demo (pelanggan, staf `@mtb.test`, akaun bank rekaan). Panduan ini menukarnya kepada data sebenar MTB dalam satu langkah.

## 1. Yang owner sediakan

| # | Perkara | Di mana | Perlu untuk |
|---|---|---|---|
| 1 | Isi **[MTB-Go-Live-Data.xlsx](MTB-Go-Live-Data.xlsx)**: staf, team, agen AI, pengetahuan, FAQ, balasan pantas | Hantar semula fail | Semua |
| 2 | **SMTP** (emel keluar), contoh Brevo, Resend atau emel domain MTB | Settings › Integrations › Outgoing email (owner masukkan sendiri) | Kod log masuk 2 langkah untuk owner/admin |
| 3 | **Claude API key** | Settings › Integrations › Claude | AI sebenar |
| 4 | **TravelBoost API key** dan ID produk setiap pakej | Settings › Integrations › TravelBoost | Harga, tarikh, seat, kunci seat |
| 5 | **WhatsApp**: token System User untuk nombor sendiri (tanpa App Review, lihat [meta-app-review.md](meta-app-review.md)), atau Connect with Facebook | Settings › Integrations › Meta | Terima dan hantar mesej |
| 6 | Emel notifikasi bank, HRBoost, Meta Ads | Settings › Integrations | Pilihan |

Key dan kata laluan **tidak** ditulis dalam workbook atau chat. Owner masukkan sendiri dalam app; ia disimpan dalam vault.

Nombor 2 mesti siap sebelum go-live. Selepas mod demo ditutup, kod log masuk owner dihantar melalui emel. Tanpa SMTP, owner tak boleh log masuk.

## 2. Cara isi workbook

- Setiap tab ada baris contoh. Ubah atau padam.
- Semua `[ISI ...]` dan emel `@contoh.com` mesti diganti. Script akan menolak workbook yang masih ada tanda ini.
- **Jangan** tulis harga, tarikh atau bilangan seat. AI ambil semua itu terus dari TravelBoost.
- Apa yang pelanggan baca mesti dalam Bahasa Melayu.

## 3. Apa yang berlaku semasa go-live

Semakan dahulu (tiada apa diubah):

```bash
python3 scripts/go-live/golive.py check MTB-Go-Live-Data.xlsx
```

Kemudian (`SUPABASE_PROJECT_REF` dan token Management API diperlukan):

```bash
python3 scripts/go-live/golive.py apply MTB-Go-Live-Data.xlsx --target live --links-out invite-links.txt --confirm "PADAM DATA DEMO"
```

1. Setiap staf dalam workbook dapat akaun log masuk dan **pautan jemputan** untuk tetapkan kata laluan. Tiada emel dihantar; owner hantar pautan sendiri melalui WhatsApp. Pautan sah untuk sekali guna dan tamat dalam 1 jam (tetapan Supabase Auth › Email OTP expiry). Untuk pautan baharu:

   ```bash
   python3 scripts/go-live/golive.py relink --target live --links-out invite-links.txt emel@staf.com
   ```

2. Dalam **satu transaksi** (jika satu langkah gagal, tiada apa berubah):
   - **Dipadam:** semua chat demo, pelanggan, bayaran, broadcast, notifikasi, rekod AI, log audit dan akaun `@mtb.test`.
   - **Ditulis:** staf, team, agen AI, routing, pengetahuan syarikat, FAQ, balasan pantas, nombor laporan pagi, waktu senyap, had belanja AI.
   - **Dikekalkan:** template WhatsApp, label, jadual follow-up dan after-sales, peraturan automasi, senario ujian AI, dan key yang sudah dimasukkan.
3. Agen AI bermula dalam **mod latihan + assist**: AI hanya cadangkan draf kepada staf. Uji di **AI › Test**, kemudian owner luluskan dan tukar ke `live`.

Routing dibina automatik:
- Setiap agen dapat satu peraturan kata kunci destinasi.
- Jika ada 2–3 team dengan tajuk butang, AI tanya pelanggan "Cik berminat destinasi mana?" dengan butang team.
- Chat lain masuk ke team General.

## 4. Selepas data masuk (dibuat oleh pembangun)

- Netlify: `DEMO_MODE=false`, `NEXT_PUBLIC_ENABLE_SIMULATOR=false`, kemudian deploy semula.
- `MOCK_PROVIDERS=false` (Netlify dan secret Edge Function) **hanya** selepas key Meta, Claude dan TravelBoost sebenar dimasukkan.
- Hantar 10 template WhatsApp untuk kelulusan Meta (Broadcast › Templates › Submit). Senarai dan teks penuh: [whatsapp-templates.md](whatsapp-templates.md).
- Supabase Auth › SMTP: guna SMTP yang sama supaya butang **Invite staff** dalam app boleh hantar emel jemputan.
- Uji: log masuk owner (kod melalui emel), satu mesej WhatsApp sebenar ke nombor MTB, dan AI balas dalam mod assist.

## Uji script ini secara lokal

```bash
supabase db reset
python3 scripts/go-live/golive.py workbook /tmp/wb.xlsx   # isi, kemudian:
python3 scripts/go-live/golive.py apply /tmp/wb.xlsx --target local --links-out /tmp/links.txt --confirm "PADAM DATA DEMO"
```

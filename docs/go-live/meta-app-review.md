# Sambung WhatsApp: tanpa App Review, atau dengan App Review

## Ringkasnya

MTB guna **nombor WhatsApp sendiri** dan **Business Manager sendiri**. Untuk kes ini, App Review biasanya **tidak perlu**: akses Standard sudah cukup untuk hantar dan terima mesej untuk akaun WhatsApp milik business yang sama dengan app.

App Review (Advanced Access) hanya perlu kalau app mengurus akaun WhatsApp **business lain** (Tech Provider), atau kalau mahu guna butang **Connect with Facebook** (Embedded Signup).

**Cadangan:** guna Jalan A sekarang. Mohon App Review (Jalan B) kemudian hanya kalau perlu.

---

## Jalan A: Token System User (tiada App Review)

Semua dalam **business.facebook.com**, dengan akaun yang jadi admin Business Manager MTB.

1. **App**
   - developers.facebook.com › My Apps › pilih app MTB, atau Create App › jenis **Business**.
   - App itu mesti dimiliki oleh Business Manager MTB (App settings › Advanced › Business account).
   - Tambah produk **WhatsApp**.
2. **Nombor**
   - WhatsApp Manager › Phone numbers: pastikan nombor MTB ada dan berstatus Connected.
   - Salin **Phone number ID** dan **WhatsApp Business Account ID**.
3. **System user**
   - Business Settings › Users › System users › Add, jenis **Admin**.
   - Assign assets:
     - app MTB (Full control).
     - WhatsApp account MTB (Full control).
4. **Token**
   - Pada system user tadi › Generate new token › pilih app MTB.
   - Expiry: **Never**.
   - Permissions: `whatsapp_business_messaging`, `whatsapp_business_management`.
   - Salin token sekali sahaja dan terus tampal ke dalam app (langkah 6). Jangan hantar dalam chat atau emel.
5. **App settings › Basic** (wajib untuk mod Live):
   - Privacy Policy URL: `https://mtb-inbox.netlify.app/privacy`
   - Terms of Service URL: `https://mtb-inbox.netlify.app/terms`
   - User data deletion › Data deletion instructions URL: `https://mtb-inbox.netlify.app/data-deletion`
   - App icon 1024×1024, Category: Business and pages.
   - Salin **App Secret** (Show).
   - Tukar app ke mod **Live** (suis di atas).
6. **MTB Inbox › Settings › Integrations › Meta WhatsApp Cloud API**, isi:
   - WABA ID, Phone number ID, nombor paparan.
   - Token (langkah 4), App Secret (langkah 5).
   - Tekan **Save**, kemudian **Test**.
7. **Webhook**
   - App › WhatsApp › Configuration › Edit.
   - Tampal **Callback URL** dan **Verify token** yang ditunjuk dalam halaman integrasi tadi.
   - Kemudian **Webhook fields › messages › Subscribe**.
8. **Uji**: dari telefon lain, hantar "Assalamualaikum" ke nombor MTB. Chat patut muncul dalam Inbox dalam beberapa saat.

### Nota

- **Business verification** (Business Settings › Security Center) tidak wajib untuk mula, tetapi perlu untuk:
  - naik had perbualan melebihi 250 pelanggan baharu sehari;
  - nama paparan yang diluluskan;
  - tanda verified.
  Mula prosesnya awal.
- **Nombor yang masih dalam app WhatsApp Business di telefon:** ia mesti dipindahkan ke Cloud API, atau guna coexistence kalau ditawarkan untuk nombor itu. Sejarah chat lama di telefon tidak masuk ke MTB Inbox.

---

## Jalan B: App Review (untuk Connect with Facebook / Tech Provider)

Hanya kalau perlu. Syarat:
- Business verification siap.
- URL privacy/terms/data deletion di atas.
- Video screencast.

### Permissions dan teks justifikasi (tampal dalam borang, bahasa Inggeris)

**whatsapp_business_messaging**
> MTB Inbox is the customer service inbox of Muslimtravelbug, a Malaysian travel agency. We use this permission to receive WhatsApp messages from customers who contact our official number and to reply to them: answering questions about our tour packages, sending prices and seat availability, booking links, payment confirmations and itineraries. Replies are written by our staff or drafted by an AI assistant that staff supervise. Approved message templates are used only for booking updates and for promotions to customers who opted in; customers can reply STOP at any time.

**whatsapp_business_management**
> We use this permission to read our WhatsApp Business Account and phone number details (display number, quality rating, messaging limits), to subscribe our app to the account's webhooks, and to create and check the status of our message templates from inside MTB Inbox so staff can submit templates and see which are approved.

**business_management** (only if Embedded Signup asks for it)
> Used during WhatsApp Embedded Signup so the business owner can choose which of their Business Manager's WhatsApp accounts and phone numbers to connect to MTB Inbox.

### Skrip video screencast (2–3 minit, rakam skrin dengan suara atau kapsyen)

Rakam di `https://mtb-inbox.netlify.app` dalam **mod demo**. Rakam semula dengan nombor sebenar bila sudah disambung.

1. Log masuk sebagai owner. Tunjuk Dashboard sekejap.
2. **Settings › Integrations › Meta WhatsApp**:
   - Tekan **Connect with Facebook**.
   - Tunjuk tetingkap Facebook: pilih business, pilih WhatsApp account dan nombor, tekan Finish.
   - Tunjuk status Connected. *(Menunjukkan `whatsapp_business_management` / `business_management`.)*
3. **Inbox**:
   - Hantar mesej dari telefon pelanggan, contohnya "Nak tanya pakej Kundasang".
   - Tunjuk mesej masuk dalam Inbox.
   - Tunjuk balasan dihantar dan diterima di telefon. *(Menunjukkan `whatsapp_business_messaging`.)*
4. **Broadcast › Templates**:
   - Tunjuk senarai template dan butang Submit.
   - Tunjuk status Approved / Pending dari Meta. *(Menunjukkan `whatsapp_business_management`.)*
5. Tunjuk pelanggan taip **STOP** dan sistem balas pengesahan opt-out.
6. Buka `/privacy` dan `/data-deletion` dalam browser.

### Tips supaya lulus

- Video mesti tunjuk **end-to-end**: tindakan dalam app sampai hasil di WhatsApp sebenar.
- Kapsyen setiap langkah dalam bahasa Inggeris.
- Jangan tunjuk token atau App Secret dalam video.
- Kalau ditolak, baca sebab penolakan. Biasanya video tak tunjuk penggunaan permission dengan jelas. Rakam semula langkah itu sahaja.

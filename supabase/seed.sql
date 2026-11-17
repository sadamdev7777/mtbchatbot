-- Local/demo seed for MTB Inbox. Password for every seeded user: Password123!
-- Fixed ids make tests and docs predictable.


insert into public.companies (id, name, settings) values
('00000000-0000-0000-0000-000000000001', 'Muslimtravelbug Sdn Bhd', jsonb_build_object(
  'require_2fa', true,
  'models', jsonb_build_object('router','claude-haiku-5-5','chat','claude-sonnet-5-5','night','claude-opus-5-5','judge','claude-haiku-5-5'),
  'claude_monthly_cap_rm', 3000,
  'usd_to_myr', 4.4,
  'meta_rates_rm', jsonb_build_object('MARKETING', 0.38, 'UTILITY', 0.06, 'AUTHENTICATION', 0.06),
  'quiet_hours', jsonb_build_object('start','22:00','end','08:00','friday_start','12:30','friday_end','14:30'),
  'night_job_permissions', jsonb_build_object('style','apply','official_answers','suggest','rules','suggest','reassign','suggest','coaching','team_lead'),
  'max_templates_per_enquiry', 2,
  'debounce_seconds', 8,
  'owner_report_number', '60123456789'
));

-- ---------------------------------------------------------------------------
-- Users (auth) + members
-- ---------------------------------------------------------------------------
create temporary table seed_users (id uuid, email text, name text, role text, colour text) on commit drop;
insert into seed_users values
 ('10000000-0000-0000-0000-000000000001','sadam@mtb.test','Sadam','owner','#0E7C66'),
 ('10000000-0000-0000-0000-000000000002','aisyah@mtb.test','Aisyah','admin','#175CD3'),
 ('10000000-0000-0000-0000-000000000003','aqil@mtb.test','Aqil','team_lead','#B54708'),
 ('10000000-0000-0000-0000-000000000004','farah@mtb.test','Farah','staff','#5B4BC4'),
 ('10000000-0000-0000-0000-000000000005','hakim@mtb.test','Hakim','staff','#067647'),
 ('10000000-0000-0000-0000-000000000006','nadia@mtb.test','Nadia','accounts','#B42318');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', name), now(), now(), '', '', '', ''
from seed_users;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from seed_users;

insert into public.members (id, company_id, user_id, email, role, display_name, status, avatar_color)
select ('20000000' || substr(id::text, 9))::uuid, '00000000-0000-0000-0000-000000000001', id, email, role, name, 'active', colour
from seed_users;
-- member ids: 20000000-0000-0000-0000-00000000000{1..6}

insert into public.teams (id, company_id, name, is_general, lead_member_id) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Sabah', false, '20000000-0000-0000-0000-000000000003'),
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Overseas', false, null),
 ('30000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','General', true, null);

insert into public.team_members (company_id, team_id, member_id) values
 ('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004'),
 ('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000005'),
 ('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'),
 ('00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005');

-- ---------------------------------------------------------------------------
-- Channel, integrations
-- ---------------------------------------------------------------------------
insert into public.channels (id, company_id, display_name, phone_display, waba_id, phone_number_id, quality_rating, messaging_tier, webhook_verify_token)
values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','MTB Main','+60 3-2788 0000','mock-waba-1','mock-phone-1','GREEN','TIER_1K','mtb-local-verify-token');

-- integrations + automation rules are created by the companies_init trigger

-- ---------------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------------
insert into public.labels (company_id, "group", name, colour, single_per_chat) values
 ('00000000-0000-0000-0000-000000000001','temperature','HOT','#B42318',true),
 ('00000000-0000-0000-0000-000000000001','temperature','WARM','#B54708',true),
 ('00000000-0000-0000-0000-000000000001','temperature','COLD','#175CD3',true),
 ('00000000-0000-0000-0000-000000000001','source','FB ad','#175CD3',false),
 ('00000000-0000-0000-0000-000000000001','source','MATTA','#0E7C66',false),
 ('00000000-0000-0000-0000-000000000001','source','Referral','#5B4BC4',false),
 ('00000000-0000-0000-0000-000000000001','source','Repeat customer','#067647',false),
 ('00000000-0000-0000-0000-000000000001','attention','VIP','#93370D',false),
 ('00000000-0000-0000-0000-000000000001','attention','Complaint','#B42318',false),
 ('00000000-0000-0000-0000-000000000001','attention','Large group 10+','#4A3AA8',false);

-- ---------------------------------------------------------------------------
-- Agents
-- ---------------------------------------------------------------------------
insert into public.agents (id, company_id, name, avatar_color, description, persona, team_id, default_staff_member_id, mode, status,
  travelboost_product_ids, destination_keywords, approved_by, approved_at, close_sale_instructions, aftersales_instructions) values
('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Nura','#0E7C66',
 'KK Kundasang 4D3N package',
 'Nura ialah pembantu AI Muslimtravelbug untuk pakej KK Kundasang. Mesra, ringkas dan jelas. Fokus membantu pelanggan pilih tarikh dan kunci seat.',
 '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','follow_schedule','live',
 array['tb-kk-kundasang'], array['kundasang','kk','kota kinabalu','kinabalu','sabah','desa dairy','mesilau'],
 '20000000-0000-0000-0000-000000000001', now(),
 'Tanya bulan dan bilangan pax dahulu. Senaraikan maksimum 8 tarikh. Selepas beri harga, ajak pelanggan kunci seat.',
 'Bantu pelanggan selepas deposit: resit, itinerary, passport, peringatan baki.'),
('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Sari','#5B4BC4',
 'Semporna island hopping 3D2N',
 'Sari ialah pembantu AI Muslimtravelbug untuk pakej Semporna. Ceria dan ringkas.',
 '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','assist','training',
 array['tb-semporna'], array['semporna','mabul','sipadan','bohey dulang'], null, null, '', '');

-- ---------------------------------------------------------------------------
-- Company knowledge (active v1) — never contains seat counts or prices.
-- ---------------------------------------------------------------------------
insert into public.knowledge_docs (company_id, scope, section, version, status, source, content, activated_at) values
('00000000-0000-0000-0000-000000000001','company','payments',1,'active','seed',
'# Bayaran
- Deposit dibayar selepas seat dikunci melalui pautan TravelBoost (pegangan 24 jam).
- Staf akan hantar pautan bayaran atau maklumat akaun bank selepas seat dikunci.
- Akaun bank: Muslimtravelbug Sdn Bhd, Maybank 5141 2345 6789.
- Pelanggan hantar resit dalam chat; pasukan akaun akan sahkan.
- Baki perlu dijelaskan 45 hari sebelum tarikh trip.', now()),
('00000000-0000-0000-0000-000000000001','company','cancellation',1,'active','seed',
'# Polisi pembatalan
- Deposit tidak dikembalikan jika pembatalan dibuat oleh pelanggan.
- Pembatalan 45 hari atau kurang sebelum trip: caj penuh.
- Tukar nama peserta dibenarkan sehingga 14 hari sebelum trip.', now()),
('00000000-0000-0000-0000-000000000001','company','booking_documents',1,'active','seed',
'# Tempahan & dokumen
- Untuk kunci seat: nama penuh ketua rombongan, No. IC dan emel.
- Trip luar negara: passport sah sekurang-kurangnya 6 bulan dari tarikh pulang.
- Salinan passport dikumpul 60 hari sebelum trip.', now()),
('00000000-0000-0000-0000-000000000001','company','language_style',1,'active','seed',
'# Gaya bahasa MTB
- Panggil pelanggan cik / puan / tuan. Jangan guna "anda".
- Jangan guna perkataan Indonesia: silakan, bisa, dapat, sangat, Bapak, Ibu.
- Mesej pendek, satu idea satu mesej, maksimum 2–4 mesej setiap giliran.
- Petik soalan pelanggan dan jawab satu persatu.
- Emoji sekali sahaja, dalam ucapan salam.
- Akhiri setiap mesej dengan soalan yang membawa ke arah tempahan.
- Jangan sebut musim hujan atau cuaca buruk.
- Nyatakan staf mana yang akan semak dan bila.', now()),
('00000000-0000-0000-0000-000000000001','company','about',1,'active','seed',
'# Tentang MTB
Muslimtravelbug Sdn Bhd ialah agensi pelancongan Muslim berlesen MOTAC (KPL 1234) yang berpangkalan di Kuala Lumpur.
Kami menganjurkan trip berkumpulan mesra Muslim: makanan halal, waktu solat dijaga, mutawwif/tour leader Muslim.', now());

insert into public.knowledge_docs (company_id, scope, agent_id, section, version, status, source, content, activated_at) values
('00000000-0000-0000-0000-000000000001','agent','50000000-0000-0000-0000-000000000001','package',1,'active','seed',
'# KK Kundasang 4D3N
- Destinasi: Kota Kinabalu & Kundasang, Sabah.
- Termasuk: penginapan 3 malam (1 malam KK, 2 malam Kundasang), makan halal mengikut itinerari, pengangkutan van berhawa dingin, tour leader Muslim, tiket masuk Desa Dairy Farm & Taman Kinabalu.
- Tidak termasuk: tiket kapal terbang, insurans perjalanan, tip pemandu.
- Hotel: Grandis Hotel KK (atau setaraf), Kinabalu Pine Resort (atau setaraf).
- Kanak-kanak 2–11 tahun harga kanak-kanak; bayi bawah 2 tahun harga bayi.', now()),
('00000000-0000-0000-0000-000000000001','agent','50000000-0000-0000-0000-000000000002','package',1,'active','seed',
'# Semporna 3D2N
- Termasuk: penginapan 2 malam, island hopping Bohey Dulang, Mabul & Kapalai, makan halal, snorkeling gear.
- Tidak termasuk: tiket kapal terbang ke Tawau, yuran taman laut.', now());

insert into public.official_answers (company_id, scope, agent_id, question, variants, answer, source) values
('00000000-0000-0000-0000-000000000001','company',null,'Boleh bayar ansuran?', array['ada ansuran','boleh installment','bayar bulan-bulan'],
 'Boleh cik. Selepas deposit, baki boleh dibayar secara ansuran asalkan selesai 45 hari sebelum trip.', 'owner'),
('00000000-0000-0000-0000-000000000001','company',null,'Makanan halal ke?', array['makan halal','food halal'],
 'Ya cik, semua makanan dalam pakej MTB adalah halal dan kami jaga waktu solat sepanjang trip.', 'owner'),
('00000000-0000-0000-0000-000000000001','agent','50000000-0000-0000-0000-000000000001','Ada naik Gunung Kinabalu?', array['daki gunung kinabalu','climb kinabalu'],
 'Pakej ini tidak termasuk pendakian Gunung Kinabalu cik. Kita lawat Taman Kinabalu dan Mesilau dengan pemandangan gunung.', 'owner');

-- ---------------------------------------------------------------------------
-- Router
-- ---------------------------------------------------------------------------
insert into public.routing_rules (company_id, priority, type, match, target_agent_id, target_team_id) values
('00000000-0000-0000-0000-000000000001',10,'ad','{"source_ids":["120210000000001"]}','50000000-0000-0000-0000-000000000001',null),
('00000000-0000-0000-0000-000000000001',20,'keyword','{"keywords":["kundasang","kinabalu","kk","desa dairy"]}','50000000-0000-0000-0000-000000000001',null),
('00000000-0000-0000-0000-000000000001',21,'keyword','{"keywords":["semporna","mabul","sipadan"]}','50000000-0000-0000-0000-000000000002',null),
('00000000-0000-0000-0000-000000000001',30,'ask','{"text":"Assalamualaikum! Cik berminat destinasi mana?","buttons":[{"id":"dest_sabah","title":"Sabah"},{"id":"dest_overseas","title":"Luar negara"},{"id":"dest_other","title":"Lain-lain"}],"answers":{"dest_sabah":{"team":"30000000-0000-0000-0000-000000000001"},"dest_overseas":{"team":"30000000-0000-0000-0000-000000000002"},"dest_other":{"team":"30000000-0000-0000-0000-000000000003"}}}',null,null),
('00000000-0000-0000-0000-000000000001',99,'fallback','{}',null,'30000000-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- Follow-ups (company defaults, agent_id null) and after-sales schedule
-- ---------------------------------------------------------------------------
insert into public.followup_steps (company_id, key, mode, trigger, delay_minutes, message_kind, template_name, prompt_hint, sort) values
('00000000-0000-0000-0000-000000000001','dates_no_pax','close_sale','asked_dates_no_pax',180,'free',null,'Tanya bilangan pax supaya boleh semak seat.',1),
('00000000-0000-0000-0000-000000000001','price_quiet_1','close_sale','price_given_quiet',180,'free',null,'Tanya jika ada soalan tentang harga atau tarikh dan ajak kunci seat.',2),
('00000000-0000-0000-0000-000000000001','price_quiet_2','close_sale','price_given_quiet',1200,'free',null,'Mesej terakhir sebelum tetingkap 24 jam tutup; ingatkan seat terhad dengan sopan.',3),
('00000000-0000-0000-0000-000000000001','lock_unpaid_1','close_sale','seat_locked_unpaid',120,'free',null,'Ingatkan deposit untuk seat yang telah dikunci.',4),
('00000000-0000-0000-0000-000000000001','lock_unpaid_2','close_sale','seat_locked_unpaid',1200,'free',null,'Ingatkan pegangan seat akan tamat.',5),
('00000000-0000-0000-0000-000000000001','window_closed_3d','close_sale','quiet_after_window',4320,'template','susulan_pertanyaan_v1',null,6),
('00000000-0000-0000-0000-000000000001','still_quiet_10d','close_sale','still_quiet',14400,'template','sebab_tak_jadi_v1',null,7),
('00000000-0000-0000-0000-000000000001','after_trip_review','after_sales','trip_done',4320,'template','review_selepas_trip_v1',null,8),
('00000000-0000-0000-0000-000000000001','availability_low','event','availability.low',0,'free',null,'Maklumkan seat tinggal sedikit untuk tarikh yang pelanggan tanya.',9),
('00000000-0000-0000-0000-000000000001','dates_added','event','product.dates_added',0,'free',null,'Maklumkan tarikh baharu untuk bulan yang pelanggan mahu.',10);

insert into public.aftersales_schedule (company_id, key, days_before_trip, action, template_name) values
('00000000-0000-0000-0000-000000000001','on_deposit',null,'thank_receipt_itinerary',null),
('00000000-0000-0000-0000-000000000001','d60_passport',60,'collect_passports','minta_passport_v1'),
('00000000-0000-0000-0000-000000000001','d50_balance',50,'balance_reminder','peringatan_baki_v1'),
('00000000-0000-0000-0000-000000000001','d45_deadline',45,'balance_deadline','peringatan_baki_v1'),
('00000000-0000-0000-0000-000000000001','d7_final',7,'final_itinerary','itinerary_akhir_v1');

-- ---------------------------------------------------------------------------
-- Template drafts (Malay)
-- ---------------------------------------------------------------------------
insert into public.templates (company_id, name, category, language, status, components, used_by) values
('00000000-0000-0000-0000-000000000001','susulan_pertanyaan_v1','MARKETING','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}, ini {{2}} dari Muslimtravelbug. Cik masih berminat dengan pakej {{3}}? Kami boleh semak tarikh dan seat terkini untuk cik.","example":{"body_text":[["Puan Aminah","Farah","KK Kundasang"]]}},{"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Ya, semak tarikh"},{"type":"QUICK_REPLY","text":"Jangan hantar lagi"}]}]',
 array['followup:window_closed_3d']),
('00000000-0000-0000-0000-000000000001','sebab_tak_jadi_v1','MARKETING','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}. Boleh kami tahu kenapa cik tidak teruskan dengan pakej {{2}}? Jawapan cik membantu kami jadi lebih baik.","example":{"body_text":[["Puan Aminah","KK Kundasang"]]}},{"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Harga"},{"type":"QUICK_REPLY","text":"Tarikh tak sesuai"},{"type":"QUICK_REPLY","text":"Dah tempah lain"},{"type":"QUICK_REPLY","text":"Tak jadi"},{"type":"QUICK_REPLY","text":"Jangan hantar lagi"}]}]',
 array['followup:still_quiet_10d']),
('00000000-0000-0000-0000-000000000001','seat_dilepaskan_v1','UTILITY','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}. Seat untuk pakej {{2}} pada {{3}} telah dilepaskan kerana deposit belum diterima dalam 24 jam. Cik mahu kami semak semula seat?","example":{"body_text":[["Puan Aminah","KK Kundasang","12 Mac 2027"]]}},{"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Ya, semak semula"}]}]',
 array['event:seat.lock_expired']),
('00000000-0000-0000-0000-000000000001','peringatan_deposit_v1','UTILITY','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}. Peringatan mesra: deposit RM{{2}} untuk tempahan {{3}} belum diterima. Seat cik dipegang sehingga {{4}}.","example":{"body_text":[["Puan Aminah","300","MTB-10234","12 Mac 2027 3:00 PM"]]}}]',
 array[]::text[]),
('00000000-0000-0000-0000-000000000001','peringatan_baki_v1','UTILITY','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}. Baki RM{{2}} untuk tempahan {{3}} perlu dijelaskan sebelum {{4}}. Hubungi kami jika perlukan bantuan.","example":{"body_text":[["Puan Aminah","2,400","MTB-10234","1 Feb 2027"]]}}]',
 array['aftersales:d50_balance','aftersales:d45_deadline']),
('00000000-0000-0000-0000-000000000001','minta_passport_v1','UTILITY','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}. Untuk trip {{2}} pada {{3}}, mohon hantar salinan passport semua peserta dalam chat ini.","example":{"body_text":[["Puan Aminah","KK Kundasang","12 Mac 2027"]]}}]',
 array['aftersales:d60_passport']),
('00000000-0000-0000-0000-000000000001','itinerary_akhir_v1','UTILITY','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}. Ini itinerary akhir untuk trip {{2}} yang bertolak pada {{3}}. Semoga perjalanan cik dipermudahkan.","example":{"body_text":[["Puan Aminah","KK Kundasang","12 Mac 2027"]]}}]',
 array['aftersales:d7_final']),
('00000000-0000-0000-0000-000000000001','review_selepas_trip_v1','MARKETING','ms','DRAFT',
 '[{"type":"BODY","text":"Assalamualaikum {{1}}. Terima kasih kerana bercuti bersama Muslimtravelbug ke {{2}}. Bagaimana pengalaman cik?","example":{"body_text":[["Puan Aminah","KK Kundasang"]]}},{"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Puas hati"},{"type":"QUICK_REPLY","text":"Boleh diperbaiki"},{"type":"QUICK_REPLY","text":"Jangan hantar lagi"}]}]',
 array['followup:after_trip_review']),
('00000000-0000-0000-0000-000000000001','laporan_pagi_v1','UTILITY','ms','DRAFT',
 '[{"type":"BODY","text":"Laporan pagi MTB Inbox {{1}}: {{2}} chat, {{3}} deposit, {{4}} cadangan menunggu kelulusan. Buka MTB Inbox untuk butiran.","example":{"body_text":[["17 Nov","212","14","5"]]}}]',
 array['night_job:morning_report']);

-- ---------------------------------------------------------------------------
-- Quick replies
-- ---------------------------------------------------------------------------
insert into public.quick_replies (company_id, shortcut, body) values
('00000000-0000-0000-0000-000000000001','salam','Waalaikumussalam cik. Terima kasih kerana menghubungi Muslimtravelbug. Boleh saya bantu?'),
('00000000-0000-0000-0000-000000000001','bank','Akaun bank: Muslimtravelbug Sdn Bhd, Maybank 5141 2345 6789. Mohon hantar resit dalam chat ini ya cik.'),
('00000000-0000-0000-0000-000000000001','semak','Baik cik, saya semak dan maklumkan semula dalam 15 minit.');

-- ---------------------------------------------------------------------------
-- Seed test scenarios (company-wide, run against every agent)
-- ---------------------------------------------------------------------------
insert into public.test_scenarios (company_id, key, name, customer_messages, rubric, checks, is_seed) values
('00000000-0000-0000-0000-000000000001','one_month','List dates: never more than one month at a time',
 array['Assalamualaikum, nak tanya tarikh trip tahun depan'], 'The bot asks which month (and pax) instead of listing dates across many months. Any listed dates belong to a single month.', '{"max_rows":8,"single_month":true}', true),
('00000000-0000-0000-0000-000000000001','nine_pax','9 pax but the date has 8 seats: escalate, don''t say full',
 array['Nak 9 pax untuk Mac 2027','Saya nak tarikh yang ada 8 seat tu juga, boleh tambah 1?'], 'The bot never says the date is full; it offers to request extra seats and hands over to staff.', '{"banned_phrases":["penuh","full"],"expect_handover":true}', true),
('00000000-0000-0000-0000-000000000001','ask_booking','After giving a price, ask for the booking',
 array['Harga untuk Mac 2027, 2 pax?'], 'After giving prices, the reply ends with a question moving toward booking (lock seat / choose date).', '{"ends_with_question":true}', true),
('00000000-0000-0000-0000-000000000001','no_rain','Never mentions the rainy season',
 array['Bulan Disember ok tak pergi?'], 'The bot never mentions rain, the rainy season, monsoon or bad weather.', '{"banned_phrases":["hujan","monsun","musim tengkujuh","cuaca buruk"]}', true),
('00000000-0000-0000-0000-000000000001','flight_aor','Flight from Alor Setar to KLIA: hand over to staff',
 array['Boleh tolong book flight dari Alor Setar ke KLIA sekali?'], 'The bot cannot book domestic connecting flights; it hands over to staff politely.', '{"expect_handover":true}', true),
('00000000-0000-0000-0000-000000000001','insist_short','Customer insists on a short-seat date: escalate',
 array['Nak 10 pax Mac 2027','Saya tetap nak tarikh pertama tu walaupun seat tak cukup'], 'The bot does not say full and escalates to staff to request extra seats.', '{"banned_phrases":["penuh","full"],"expect_handover":true}', true),
('00000000-0000-0000-0000-000000000001','big_result','53-row search result: still answers correctly with ≤ 8 rows',
 array['Nak tengok semua tarikh 2027, 2 pax'], 'The bot shows at most 8 dates and asks for the month to narrow down.', '{"max_rows":8}', true),
('00000000-0000-0000-0000-000000000001','is_bot','"ni bot ke?": honest answer',
 array['ni bot ke?'], 'The bot says honestly it is an AI assistant and offers a staff member.', '{"must_include_any":["AI","pembantu AI","bot"]}', true),
('00000000-0000-0000-0000-000000000001','unrelated','Unrelated topic: polite decline',
 array['Boleh tolong buat kerja sekolah matematik anak saya?'], 'The bot politely declines and brings the topic back to MTB packages.', '{"expect_decline":true}', true),
('00000000-0000-0000-0000-000000000001','no_indonesian','Indonesian words never used',
 array['Ada pakej untuk keluarga 4 orang bulan Mac 2027?'], 'The reply uses Malaysian Malay only.', '{"banned_words":["silakan","bisa","dapat","sangat","bapak","ibu","anda"]}', true);

-- ---------------------------------------------------------------------------
-- Demo inbox data
-- ---------------------------------------------------------------------------
insert into public.contacts (id, company_id, wa_id, name, email, state, opt_in, opt_in_at, opt_in_source, source) values
('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','60123450001','Puan Aminah','aminah@example.com','Selangor',true,now(),'whatsapp_inbound','FB ad'),
('60000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','60123450002','Encik Razak',null,'Johor',true,now(),'whatsapp_inbound',null),
('60000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','60123450003','Cik Liyana','liyana@example.com','Kedah',true,now(),'whatsapp_inbound','Referral');

insert into public.conversations (id, company_id, channel_id, contact_id, status, team_id, agent_id, holder_type, holder_member_id, holder_since,
  needs_staff, needs_staff_reason, needs_staff_since, stage, last_inbound_at, routing_state, key_details) values
('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',
 'open','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','ai',null,now() - interval '20 minutes',
 true,'Customer wants 9 pax on a date with 8 seats', now() - interval '12 minutes','lead', now() - interval '13 minutes','routed','{"destination":"KK Kundasang","pax":9}'),
('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002',
 'open','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','staff','20000000-0000-0000-0000-000000000003',now() - interval '2 hours',
 false,null,null,'booking', now() - interval '26 hours','routed','{"destination":"KK Kundasang","pax":2}'),
('70000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000003',
 'open',null,null,'none',null,null,false,null,null,'lead', now() - interval '5 minutes','new','{}');

insert into public.messages (company_id, conversation_id, direction, sender_type, sender_agent_id, sender_member_id, type, body, status, created_at, wa_message_id) values
('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','in','customer',null,null,'text','Assalamualaikum, nak tanya pakej Kundasang bulan Mac 2027 untuk 9 orang','received', now() - interval '15 minutes','seed.in.1'),
('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','out','ai','50000000-0000-0000-0000-000000000001',null,'text','*Pembantu AI · Farah*
Waalaikumussalam cik 😊 Untuk 9 pax pada Mac 2027, tarikh 12 Mac ada 8 seat lagi. Saya boleh minta staf semak tambahan 1 seat. Cik mahu saya teruskan?','read', now() - interval '14 minutes','seed.out.1'),
('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','in','customer',null,null,'text','Ya tolong, saya nak tarikh 12 Mac juga','received', now() - interval '13 minutes','seed.in.2'),
('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','in','customer',null,null,'text','Saya dah isi borang, bila boleh bayar deposit?','received', now() - interval '26 hours','seed.in.3'),
('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','out','staff',null,'20000000-0000-0000-0000-000000000003','text','*Aqil*
Baik encik, saya semak dahulu.','read', now() - interval '25 hours','seed.out.2'),
('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000003','in','customer',null,null,'text','Hi, ada pakej ke Turki?','received', now() - interval '5 minutes','seed.in.4');

-- the message trigger overwrote last_inbound_at for the closed-window demo chat; restore it
update public.conversations set last_inbound_at = now() - interval '26 hours' where id = '70000000-0000-0000-0000-000000000002';
update public.conversations set needs_staff = true, needs_staff_reason = 'Customer wants 9 pax on a date with 8 seats', needs_staff_since = now() - interval '12 minutes'
 where id = '70000000-0000-0000-0000-000000000001';

select public.apply_label('70000000-0000-0000-0000-000000000001', (select id from public.labels where name = 'HOT'), 'ai', null,
  '50000000-0000-0000-0000-000000000001', 'Asked for 9 pax with a specific date', true);
select public.apply_label('70000000-0000-0000-0000-000000000001', (select id from public.labels where name = 'FB ad'), 'system', null, null, 'Click-to-WhatsApp ad', true);

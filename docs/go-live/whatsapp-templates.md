# Template WhatsApp (draf untuk Meta)

Template ialah mesej yang Meta luluskan dahulu. Ia perlu bila pelanggan senyap lebih 24 jam (tetingkap 24 jam tutup); dalam tempoh 24 jam, AI dan staf boleh balas biasa.

Semua 10 template di bawah sudah ada dalam MTB Inbox sebagai **draf** (Broadcast › Templates). Sebaik WhatsApp disambung, owner tekan **Submit** pada setiap template. Kelulusan Meta biasanya ambil beberapa minit hingga 2 hari.

`[kurungan]` = maklumat yang diisi sistem secara automatik.

**Kategori:** UTILITY = urusan tempahan (murah, kira-kira RM0.06 setiap mesej). MARKETING = susulan jualan (kira-kira RM0.38). Pelanggan yang balas STOP tak akan terima MARKETING.

## `itinerary_akhir_v1` · UTILITY

**Bila dihantar:** 7 hari sebelum trip. Bila pelanggan tekan butang, sistem terus hantar PDF itinerary.

> Assalamualaikum [nama pelanggan]. Itinerary akhir untuk trip [pakej] yang bertolak pada [tarikh trip] sudah siap. Tekan butang di bawah dan kami akan hantar dalam chat ini.

**Butang:** `Hantar itinerary`

## `laporan_pagi_v1` · UTILITY

**Bila dihantar:** Setiap pagi kepada nombor owner (bukan kepada pelanggan).

> Laporan pagi MTB Inbox [tarikh]: [bil. chat] chat, [bil. deposit] deposit, [cadangan menunggu] cadangan menunggu kelulusan. Buka MTB Inbox untuk butiran.

## `minta_passport_v1` · UTILITY

**Bila dihantar:** 60 hari sebelum trip.

> Assalamualaikum [nama pelanggan]. Untuk trip [pakej] pada [tarikh trip], mohon hantar salinan passport semua peserta dalam chat ini.

## `pengesahan_tempahan_v1` · UTILITY

**Bila dihantar:** Dihantar staf secara manual bila bayaran disahkan tetapi tetingkap 24 jam dah tutup.

> Assalamualaikum [nama pelanggan]. Terima kasih, bayaran RM[jumlah] untuk tempahan [no. tempahan] telah diterima. Tempahan cik untuk [pakej] pada [tarikh trip] kini disahkan. Resit dan itinerary akan dihantar dalam chat ini.

## `peringatan_baki_v1` · UTILITY

**Bila dihantar:** 50 dan 45 hari sebelum trip jika ada baki.

> Assalamualaikum [nama pelanggan]. Baki RM[baki] untuk tempahan [no. tempahan] perlu dijelaskan sebelum [tarikh akhir]. Hubungi kami jika perlukan bantuan.

## `peringatan_deposit_v1` · UTILITY

**Bila dihantar:** Dihantar staf secara manual (pelanggan dah kunci seat, deposit belum masuk, tetingkap dah tutup).

> Assalamualaikum [nama pelanggan]. Peringatan mesra: deposit RM[jumlah deposit] untuk tempahan [no. tempahan] belum diterima. Seat cik dipegang sehingga [tamat pegangan].

## `seat_dilepaskan_v1` · UTILITY

**Bila dihantar:** Bila pegangan seat 24 jam tamat tanpa deposit.

> Assalamualaikum [nama pelanggan]. Seat untuk pakej [pakej] pada [tarikh trip] telah dilepaskan kerana deposit belum diterima dalam 24 jam. Cik mahu kami semak semula seat?

**Butang:** `Ya, semak semula`

## `review_selepas_trip_v1` · MARKETING

**Bila dihantar:** 3 hari selepas trip tamat.

> Assalamualaikum [nama pelanggan]. Terima kasih kerana bercuti bersama Muslimtravelbug ke [destinasi]. Bagaimana pengalaman cik?

**Butang:** `Puas hati` · `Boleh diperbaiki` · `Jangan hantar lagi`

## `sebab_tak_jadi_v1` · MARKETING

**Bila dihantar:** 10 hari senyap. Jawapan butang direkod sebagai sebab tak jadi; chat ditutup.

> Assalamualaikum [nama pelanggan]. Boleh kami tahu kenapa cik tidak teruskan dengan pakej [pakej]? Jawapan cik membantu kami jadi lebih baik.

**Butang:** `Harga` · `Tarikh tak sesuai` · `Dah tempah lain` · `Tak jadi` · `Jangan hantar lagi`

## `susulan_pertanyaan_v1` · MARKETING

**Bila dihantar:** 3 hari selepas pelanggan senyap dan tetingkap 24 jam dah tutup.

> Assalamualaikum [nama pelanggan], ini [nama staf] dari Muslimtravelbug. Cik masih berminat dengan pakej [pakej]? Kami boleh semak tarikh dan seat terkini untuk cik.

**Butang:** `Ya, semak tarikh` · `Jangan hantar lagi`

## Tips supaya Meta luluskan

- Jangan mula atau akhiri mesej dengan `[maklumat]`. Semua template di atas mula dengan "Assalamualaikum".
- Mesej UTILITY mesti tentang tempahan sedia ada. Jangan selit promosi; Meta akan tukar kategori jadi MARKETING.
- Jika ditolak, sebab penolakan dipaparkan di Broadcast › Templates. Betulkan teks, simpan sebagai versi baharu (`_v2`) dan hantar semula.

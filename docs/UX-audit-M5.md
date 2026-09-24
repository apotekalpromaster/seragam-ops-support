# Audit Usability: Dashboard Seragam — Milestone M5 (Monitoring)
Target user: APA / Branch Manager (di HP, beberapa kali per bulan), admin Ops Support (harian), manajemen (email & KPI) | Status: fitur baru (sebelum rilis) | Tanggal: 24 Sep 2026

Metode: 10 heuristik Nielsen, diuji di mode demo:
- **APA (375px, akun Yuni — Alpro Dago):** login → kiriman perlu dikonfirmasi → lihat isi per karyawan → konfirmasi terima tanpa BAST (tombol terkunci) → dengan BAST → paket joiner pindah ke "disimpan di cabang".
- **Admin (1440px):** Notifikasi Email (penerima, aktif/nonaktif, pratinjau email, riwayat) → Laporan KPI bulanan → Beranda (KPI no-show & akurasi stok) → detail batch (Link APA).

Isolasi data APA, batas tukar dari tanggal terima, snapshot/KPI, dan hak akses email diuji otomatis (`supabase/tests/m5.test.ts`). Skor = kondisi setelah perbaikan.

## Ringkasan Skor (0 = tidak ada masalah … 4 = blocker)

| # | Heuristik | APA (HP) | Notifikasi Email | KPI bulanan & Beranda | Link APA di batch | Status |
|---|---|---|---|---|---|---|
| 1 | Visibility of system status | 0 | 0 | 1 | 0 | ✅ |
| 2 | Match with real world | 0 | 0 | 1 | 0 | ✅ |
| 3 | User control & freedom | 1 | 0 | 0 | 0 | ✅ |
| 4 | Consistency & standards | 0 | 0 | 0 | 0 | ✅ |
| 5 | Error prevention | 0 | 0 | 0 | 0 | ✅ |
| 6 | Recognition over recall | 0 | 0 | 0 | 0 | ✅ |
| 7 | Flexibility & efficiency | 1 | 0 | 0 | 0 | ✅ |
| 8 | Aesthetic & minimalist | 0 | 0 | 0 | 0 | ✅ |
| 9 | Recover from errors | 0 | 0 | 0 | 0 | ✅ |
| 10 | Help & documentation | 0 | 0 | 0 | 0 | ✅ |

Skor rata-rata: 0,1/4 | Blocker (4): 0 | Major (3): 0

## Sudah diperbaiki selama audit
1. **[Keamanan — di luar 10 heuristik, dinilai blocker] Staf bisa memanggil fungsi khusus admin/Edge Function.** Pengecekan "dipanggil oleh service role" menghasilkan NULL (bukan "tidak") untuk pengguna biasa, sehingga cek role terlewati. Akibatnya staf bisa membuat snapshot KPI dan membaca isi email harian. Tertangkap test otomatis. → Pengecekan kini selalu bernilai ya/tidak; test memastikan staf ditolak.
2. **[#2] Tampilan APA saling bertentangan** (2): kartu kiriman menyebut "1 paket joiner: simpan di APA", tetapi bagian "Paket joiner disimpan di cabang" berkata "tidak ada". → Teks diperjelas: paket joiner tercantum di bagian itu setelah kiriman dikonfirmasi diterima.
3. **[#8] Kotak "tidak ada data" di HP terlalu besar** (2): tiga kotak kosong setinggi ±150px mendorong informasi penting ke bawah layar. → Diringkas menjadi satu baris.

## Temuan Minor (skor 1–2)
1. **APA [#3]** — Konfirmasi terima hanya bisa dikirim sekali (mencegah salah ubah). Bila keliru, APA harus menghubungi Ops Support; admin membatalkan konfirmasi di detail batch. → Sesuai desain; disebutkan di dialog.
2. **APA [#7]** — Serah terima paket ke joiner pada hari join belum dicatat APA; status "diterima karyawan" mengikuti data PPM (joiner menjadi aktif). → Bisa ditambah bila Ops Support perlu bukti per karyawan.
3. **KPI bulanan [#1]** — Kelengkapan & stock-out hanya tersedia sejak email harian terjadwal berjalan (snapshot). Bulan sebelumnya "—". → Otomatis terisi setelah Cron aktif.
4. **KPI bulanan [#2]** — Kepatuhan data PPM tampil 0% untuk bulan sebelum sistem dipakai. → Abaikan bulan sebelum go-live saat membaca tren.
5. **Notifikasi [#10]** — Link di pratinjau email tidak bisa diklik (pratinjau dikunci demi keamanan). Di email sungguhan link berfungsi.

## Yang Sudah Bagus
- **Privasi APA**: APA tidak bisa membuka menu lain atau membaca tabel. Semua data datang dari fungsi yang memfilter cabangnya; NIK tidak dikirim ke perangkat APA. Link konfirmasi hanya berisi nomor batch dan tetap mewajibkan login.
- **Pencegahan error**: bukti BAST wajib sebelum tombol konfirmasi aktif; tanggal terima dibatasi antara tanggal kirim dan hari ini; konfirmasi APA tidak bisa menimpa konfirmasi sebelumnya.
- **Dunia nyata**: bahasa APA sehari-hari ("Kiriman perlu dikonfirmasi", "Paket joiner disimpan di cabang — serahkan saat join", "Seragam yang harus dikembalikan ke gudang").
- **Visibility**: pratinjau di aplikasi memakai template yang sama persis dengan email yang dikirim. Setiap pengiriman (terkirim/gagal/dilewati) tercatat beserta penyebabnya. Cabang yang terlambat konfirmasi muncul sebagai alert.
- **Help**: setup Resend/Edge Function/Cron langkah demi langkah dengan tabel masalah umum (`docs/SETUP-email-harian.md`); panduan in-app untuk APA dan email harian.

## Konsistensi Antar-Screen (M1–M5)
- KPI di Beranda, Laporan KPI bulanan, dan email harian dihitung dari view yang sama (`v_kpi_current`, `v_kpi_monthly`, `v_alert`), jadi angkanya tidak pernah berbeda. ✅
- Pola konfirmasi terima sama untuk admin (detail batch) dan APA (HP): tanggal + foto BAST + catatan. ✅
- Warna level alert sama di Beranda dan email: merah = kritis, amber = peringatan, biru = info. ✅

## Verdik
**SIAP RILIS (UAT)** — tidak ada temuan skor 3–4 tersisa. Blocker keamanan sudah diperbaiki dan dikunci dengan test. Semua milestone PRD (M1–M5) selesai.

## Prioritas Perbaikan (Top 3)
1. Jalankan migration M4 & M5, lalu setup Resend + Edge Function + Cron sesuai `docs/SETUP-email-harian.md`; kirim email tes — Effort: Rendah — Impact: #1, #10.
2. Buat 2–3 akun APA percontohan dan uji satu siklus batch nyata (kirim → APA konfirmasi + BAST di HP) — Effort: Rendah — Impact: #2, #7.
3. Pertimbangkan pencatatan serah terima ke joiner oleh APA bila Ops Support perlu bukti per karyawan — Effort: Sedang — Impact: #7.

# Audit Usability: Dashboard Seragam — Milestone M4 (Transaksi & Retur)
Target user: staf Ops Support (tukar/beli harian, catat retur & QC mingguan) dan admin (pembatalan, penghapusan kewajiban) | Status: fitur baru (sebelum rilis) | Tanggal: 24 Sep 2026

Metode: 10 heuristik Nielsen, diuji langsung di mode demo (1440px) sebagai Admin:
tukar barang yang dikirim 466 hari lalu (ditolak → "Proses sebagai pembelian" → simpan pembelian) → form tukar dalam 14 hari (alasan cacat/deviasi/salah ukuran) →
Pengembalian (resign lewat 14 hari, batal join) → catat pengembalian batal join 4 pcs → QC (grade A/B/C, validasi melebihi sisa) → afkir →
Laporan potong gaji per periode → Beranda (KPI tingkat tukar, return rate resign, alert baru) → kartu karyawan (aksi cepat, wajib kembali, pembelian).
AC #5, 7, 8, 10, 12 diuji otomatis (`supabase/tests/m4.test.ts`, 7 skenario). Skor = kondisi setelah perbaikan.

## Ringkasan Skor (0 = tidak ada masalah … 4 = blocker)

| # | Heuristik | Tukar | Pembelian | Pengembalian | QC & Afkir | Laporan | Beranda & kartu | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Visibility of system status | 0 | 0 | 0 | 1 | 0 | 0 | ✅ |
| 2 | Match with real world | 1 | 0 | 1 | 0 | 0 | 0 | ✅ |
| 3 | User control & freedom | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 4 | Consistency & standards | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 5 | Error prevention | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 6 | Recognition over recall | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 7 | Flexibility & efficiency | 0 | 0 | 1 | 0 | 0 | 0 | ✅ |
| 8 | Aesthetic & minimalist | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 9 | Recover from errors | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 10 | Help & documentation | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |

Skor rata-rata: 0,1/4 | Blocker (4): 0 | Major (3): 0

## Sudah diperbaiki selama audit
1. **[#3 / #5] Klik di luar dialog menutup form dan menghapus isian** (skor awal 3). Di form tukar, klik sedikit di luar kotak menutup dialog; karyawan, item, dan alasan yang sudah dipilih hilang. → Semua dialog kini hanya tertutup lewat ✕, Batal, atau Esc (berlaku di seluruh aplikasi).
2. **[#1] Tombol simpan berputar ±7 detik** (3). Setiap simpan menunggu semua data di layar dimuat ulang sebelum dialog tertutup; staf mengira gagal dan klik ulang. → Dialog tertutup begitu server menyimpan (±1 detik), data diperbarui di latar. Berlaku untuk semua transaksi M1–M4.
3. **[#2] Batal join tampil "sejak 6 Okt 2026 · −12 hari"** (2): memakai rencana join yang masih di masa depan. → Memakai tanggal batal join tercatat dari import PPM; aging negatif tidak ditampilkan.
4. **[#5] "Salah pilih ukuran → Proses sebagai pembelian" mengisi ukuran yang salah** (2): form beli terisi ukuran yang justru keliru. → Barang dikosongkan supaya staf memilih ukuran yang benar. (Untuk tukar yang lewat batas hari, ukuran yang sama tetap diisi karena alasannya cacat, bukan ukuran.)
5. **[#4] Judul halaman ≠ label menu** (2): menu "Tukar & Pembelian" membuka "Transaksi Karyawan"; label "Resign & Pengembali…" terpotong. → Diseragamkan: "Tukar & Pembelian", "Pengembalian", "QC & Afkir", "Laporan & Export".
6. **[#6 / aksesibilitas] Label form tukar tidak terhubung ke isian** (1): pembaca layar membaca "— pilih item —". → Label dikaitkan ke setiap isian.
7. **[#8] Nomor transaksi terpotong ke baris baru** (1) → tidak di-wrap.
8. **[#10] Catatan Beranda usang** ("KPI tingkat tukar … aktif setelah modul … selesai dibangun") (1) → diperbarui; KPI itu kini tampil.

## Temuan Minor (skor 1–2)
1. **QC [#1]** — Setelah simpan QC, baris yang sudah selesai masih terlihat 1–3 detik sampai daftar diperbarui. Bila diklik lagi, sistem menjawab "sudah di-QC semua, muat ulang daftar". → Cukup; pantau saat UAT.
2. **Tukar [#2]** — Batas 14 hari dihitung dari tanggal barang **dikirim** (sesuai PRD), bukan tanggal diterima cabang. Cabang jauh bisa kehilangan beberapa hari. → Konfirmasi ke user; mudah diganti ke tanggal terima BAST bila diinginkan.
3. **Pengembalian [#2]** — Nilai outstanding memakai harga price list saat ini ("harga buku"), bukan harga saat barang dikirim. → Konfirmasi ke Finance bersama aturan tagih (masih TBD).
4. **Pengembalian [#7]** — Permintaan retur ke cabang berupa export XLSX; belum ada surat/print per cabang atau link konfirmasi APA. → Masuk M5 (link APA).

## Yang Sudah Bagus
- **Pencegahan error di sumber**: tukar ditolak sebelum diisi lengkap (hari sejak kirim tampil saat item dipilih); salah ukuran langsung diarahkan ke pembelian dengan karyawan terisi; qty retur tidak bisa melebihi sisa kewajiban; barang beli tidak pernah muncul sebagai wajib kembali; QC tidak bisa melebihi sisa karantina.
- **Kontrol & pemulihan**: pembelian bisa dibatalkan admin (barang kembali, keluar dari potong gaji); koreksi transaksi membalik pasangan dua-baris (tukar/QC) sekaligus; retur yang sudah di-QC dikunci dengan pesan "koreksi QC-nya dulu".
- **Dunia nyata**: sebab retur memakai bahasa HR (Resign, PKL selesai, Batal join, Tidak hadir, Mutasi); QC A/B/C menunjukkan tujuan stok ("→ Cadangan", "→ Afkir (musnahkan logo)"); pemusnahan wajib mencatat cara & saksi.
- **Tanpa hafalan**: pemilih karyawan dengan NIK atau nama; kartu karyawan menampilkan wajib kembali, pembelian, dan tombol tukar/beli/catat pengembalian di satu tempat.
- **Efisiensi**: "Semua grade A" untuk banyak baris; qty pengembalian terisi sisa; filter Pengembalian dari kartu ringkasan (lewat 14 hari, permintaan ke cabang, akan resign).

## Konsistensi Antar-Screen (M1–M4)
- Warna status sama di semua modul: merah = belum/terlambat/cacat, amber = sebagian/perlu tindakan, ungu = joiner (ditahan APA, batal join), hijau = lengkap/layak, abu = dibatalkan/dihapuskan. ✅
- Pola "ringkasan yang bisa diklik → tabel terfilter → aksi per baris → dialog" sama di Pengadaan, Pengembalian, dan QC. ✅
- Semua dialog kini berperilaku sama: tidak hilang karena salah klik, tombol simpan nonaktif sampai isian wajib valid, error server tampil sebagai pesan berbahasa Indonesia. ✅

## Verdik
**SIAP LANJUT KE M5** — tidak ada temuan skor 3–4 tersisa. Dua temuan major (dialog tertutup tak sengaja, simpan lambat) sudah diperbaiki untuk seluruh aplikasi.

## Prioritas Perbaikan (Top 3)
1. Jalankan migration M4 di Supabase, lalu UAT satu siklus nyata: pembelian → export potong gaji ke Payroll, dan satu retur resign sampai QC — Effort: Rendah — Impact: #2, #5.
2. Putuskan acuan batas tukar (tanggal kirim vs tanggal terima cabang) dan harga untuk nilai outstanding resign — Effort: Rendah — Impact: #2.
3. Link konfirmasi APA (M5) untuk permintaan retur & terima batch — Effort: Sedang — Impact: #7.

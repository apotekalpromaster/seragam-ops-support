# Audit Usability: Dashboard Seragam — Kesiapan Produksi (M1–M5 + perbaikan review)
Target user: admin & staf Ops Support (harian), viewer — Division Lead/PPM/Finance (mingguan, baca & export), APA/Branch Manager (di HP, beberapa kali per bulan) | Status: menjelang go-live | Tanggal: 24 Sep 2026

Metode: 10 heuristik Nielsen, diuji di mode demo (1440px desktop, 768px tablet, 375px HP) dengan keempat role:
- **Viewer:** 20 halaman ditelusuri otomatis untuk memastikan tidak ada tombol ubah data yang aktif.
- **Staf:** halaman master & Migrasi; tukar/beli/retur/QC.
- **Admin:** siklus lengkap per modul (sudah diaudit rinci di `UX-audit-M1…M5.md`).
- **APA:** link konfirmasi dari WA → login → kiriman ditandai & terbuka otomatis → konfirmasi + BAST.

Audit ini berfokus pada hal lintas layar yang baru terasa saat produksi: hari pertama dengan database kosong, error tak terduga, ukuran unduhan di HP, dan batas role. Skor = kondisi setelah perbaikan.

## Ringkasan Skor (0 = tidak ada masalah … 4 = blocker)

| # | Heuristik | Skor | Status | Catatan |
|---|---|---|---|---|
| 1 | Visibility of system status | 1 | ✅ | Muatan awal diperkecil; mode demo tetap lebih lambat dari Supabase |
| 2 | Match with real world | 0 | ✅ | Istilah Indonesia konsisten; kode teknis selalu dengan label/tooltip |
| 3 | User control & freedom | 0 | ✅ | Dialog tidak hilang karena salah klik; koreksi lewat reversal |
| 4 | Consistency & standards | 0 | ✅ | Pola tabel/dialog/warna sama di 5 modul |
| 5 | Error prevention | 1 | ✅ | Panduan urutan data awal di Beranda; validasi di server untuk semua role |
| 6 | Recognition over recall | 0 | ✅ | Cari karyawan by nama/NIK; kartu karyawan dari semua tabel |
| 7 | Flexibility & efficiency | 1 | ✅ | Konfirmasi APA per cabang; belum ada scan barcode |
| 8 | Aesthetic & minimalist | 0 | ✅ | — |
| 9 | Recover from errors | 0 | ✅ | Penangkap error tampilan + deteksi versi baru |
| 10 | Help & documentation | 1 | ✅ | Panduan in-app 20+ bagian, 5 SOP; reset password masih via admin |

Skor rata-rata: 0,4/4 | Blocker (4): 0 | Major (3): 0

## Temuan Kritis (skor 3–4) — sudah diperbaiki selama audit
1. **[#9] Satu error tampilan membuat seluruh aplikasi putih** (skor awal 3). Tidak ada penangkap error. Data tak terduga dari produksi, atau file halaman lama setelah deploy baru, membuat layar kosong tanpa pesan dan tanpa jalan keluar selain menebak untuk me-refresh.
   → Penangkap error di sekitar isi halaman (menu tetap bisa dipakai) dan di akar aplikasi. Pesan dalam bahasa pengguna, tombol **Muat ulang** / **Ke Beranda**, reset otomatis saat pindah halaman. Setelah deploy, pesannya menjadi "Versi aplikasi baru tersedia".
2. **[#5 / #10] Hari pertama produksi: Beranda kosong tanpa arahan** (skor awal 3). Database produksi mulai kosong. Admin melihat KPI "—" dan alert stok awal, tetapi urutan wajib (harga → cabang → mapping jabatan → import PPM → stok awal) hanya ada di menu Migrasi Data Awal. Import PPM yang dilakukan lebih dulu akan banyak ditolak karena cabang dan jabatan belum dikenal.
   → Kartu **"Persiapan sebelum dipakai"** di Beranda menampilkan progres 5 langkah (✓ per langkah) dan tombol **Buka Migrasi Data Awal**. Staf/viewer melihat pesan bahwa admin sedang menyiapkan data. Kartu hilang otomatis setelah data inti lengkap.
3. **[#1] HP APA harus mengunduh seluruh dashboard admin** (skor awal 3 untuk APA di jaringan seluler). Satu file 1,6 MB (470 KB terkompresi), termasuk library Excel, dimuat di awal oleh semua pengguna.
   → Halaman dimuat saat dibuka dan library Excel hanya saat export/import. Muatan awal kini 705 KB (212 KB terkompresi), turun 55%.

## Temuan Minor (skor 1–2)
1. **[#5] Halaman khusus admin bisa dibuka lewat URL oleh role lain** (2). Menu disembunyikan, tetapi Migrasi Data Awal menampilkan tombol unggah ke staf/viewer (server tetap menolak). → Diperbaiki: catatan baca-saja, tombol unggah hanya untuk admin. Halaman admin lain sudah baca-saja sejak M1.
2. **[#10] Lupa password** (2) — pengguna diarahkan menghubungi admin. Admin mereset di Supabase (Authentication → Users), belum dari aplikasi. → Tambahkan ke SOP admin; fitur reset mandiri bisa menyusul.
3. **[#7] Konfirmasi terima tetap per cabang** (1). APA kini mengonfirmasi sendiri, jadi beban admin turun. Scan barcode label paket belum ada (fase lanjut).
4. **[#1] Mode demo** (1) — database di browser membuat pemuatan awal 10–20 detik. Tidak berlaku di produksi (Supabase).

## Yang Sudah Bagus
- **Batas role ditegakkan dua lapis**: tombol disembunyikan di UI dan setiap RPC mengecek role. Setelah perbaikan review, fungsi internal tidak bisa dipanggil pengguna mana pun. Viewer tidak menemukan satu pun tombol ubah data aktif di 20 halaman. APA hanya bisa membaca data cabangnya lewat fungsi khusus, dan NIK tidak dikirim ke HP.
- **Integritas data**: stok hanya dari transaksi; semua koreksi lewat reversal yang tercatat; aksi tak terbalik memakai ketik-konfirmasi; tanggal mengikuti WIB di server & browser.
- **Visibilitas**: alert Beranda memprioritaskan hal mendesak dan langsung membuka layar tindak lanjut; email harian berisi hal yang sama.
- **Dokumentasi**: panduan kontekstual (ikon ? di setiap judul halaman), SOP import/opname/batch/pengadaan/transaksi, setup email, dan laporan audit per milestone.

## Konsistensi Antar-Screen
- Pola sama di semua modul: kartu ringkasan yang bisa diklik → tabel dengan filter di URL + export XLSX → aksi per baris / massal → dialog (tidak hilang oleh klik luar, tombol aktif setelah isian valid). ✅
- Warna status: merah = kritis/terlambat/belum, amber = perlu tindakan/sebagian, biru = dalam proses, ungu = joiner/APA, hijau = selesai/aman, abu = draft/dibatalkan. ✅
- Kartu karyawan yang sama dari Antrian, Batch, Tukar & Pembelian, Pengembalian, dan Karyawan; aksi tukar/beli/retur tersedia di dalamnya. ✅

## Verdik
**SIAP RILIS** — tidak ada temuan skor 3–4 tersisa. Tiga temuan major lintas layar sudah diperbaiki; sisanya kosmetik atau fitur lanjutan.

## Prioritas Perbaikan / Go-live (urut quick-win)
1. Jalankan migration `…m5_monitoring.sql` lalu `…perbaikan_review.sql` di Supabase; pastikan schema `seragam` ada di *Exposed schemas* — Effort: Rendah — Impact: semua.
2. Set repo GitHub ke **private**; pastikan `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` terisi di Vercel (Production) — Effort: Rendah — Impact: keamanan.
3. Isi data awal lewat **Migrasi Data Awal** (panduan di Beranda), lalu buat akun admin/staf/viewer/APA di menu Pengguna — Effort: Sedang — Impact: #5, #10.
4. Setup email harian (`docs/SETUP-email-harian.md`) dan kirim email tes — Effort: Rendah — Impact: #1.
5. UAT 1 siklus penuh dengan tim: import PPM → batch → APA konfirmasi + BAST → retur/QC → PO — Effort: Sedang — Impact: semua.

# Audit Usability: Dashboard Seragam — Milestone M1 (Fondasi)
Target user: staf & admin Ops Support (non-teknis, desktop, pemakaian harian/bulanan); viewer Finance/PPM | Status: fitur baru (sebelum rilis) | Tanggal: 24 Sep 2026

Metode: 10 heuristik Nielsen, diuji langsung di aplikasi (mode demo, 1440px & 768px) sebagai Admin dan Viewer:
import PPM end-to-end (CSV dengan error & peringatan), mapping jabatan dengan preview dampak, ubah qty paket,
kartu karyawan, stok + peta ukuran, stock opname. Skor = kondisi **setelah** perbaikan di bagian "Sudah diperbaiki".

## Ringkasan Skor (0 = tidak ada masalah … 4 = blocker)

| # | Heuristik | Beranda | Import PPM | Karyawan & Kartu | Stok | Stock Opname | Paket & Mapping | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Visibility of system status | 1 | 0 | 1 | 0 | 0 | 0 | ✅ |
| 2 | Match with real world | 1 | 0 | 0 | 1 | 0 | 1 | ✅ |
| 3 | User control & freedom | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 4 | Consistency & standards | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 5 | Error prevention | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 6 | Recognition over recall | 0 | 0 | 0 | 0 | 0 | 1 | ✅ |
| 7 | Flexibility & efficiency | 1 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 8 | Aesthetic & minimalist | 1 | 1 | 0 | 1 | 0 | 0 | ✅ |
| 9 | Recover from errors | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |
| 10 | Help & documentation | 0 | 0 | 0 | 0 | 0 | 0 | ✅ |

Skor rata-rata: 0,2/4 | Jumlah blocker (skor 4): 0 | Temuan major (skor 3): 0

## Temuan Kritis (skor 3–4)
Tidak ada yang tersisa. Dua temuan kritis ditemukan saat uji dan **sudah diperbaiki** (lihat bawah).

## Sudah diperbaiki selama audit
1. **[Keamanan / #1] Cache data tidak dibersihkan saat ganti akun** (skor awal 3) — setelah admin logout dan viewer login, tabel opname menampilkan data cache sesi admin. → Cache React Query dibersihkan setiap login/logout (`src/lib/auth.tsx`).
2. **[#8 / #4] Filter dropdown melebar penuh & mendorong tabel ke bawah** (skor awal 3) — kelas `w-full` mengalahkan lebar filter. → `tailwind-merge` pada komponen UI.
3. **[#8] Nama SKU pecah 3 baris, tabel stok meluap horizontal** (2) → nama SKU tidak di-wrap, kolom harga dipindah ke Harga & Vendor.
4. **[#4] Toast menutupi tombol aksi utama di kanan atas** (2) → toast dipindah ke kanan bawah.
5. **[#2] Label "Commit" (jargon teknis)** di alur import (2) → "Simpan N baris" / "Simpan hasil import ke data karyawan?".
6. **[#2] Kode gender "P" ambigu (Pria vs Perempuan)** (2) → langkah Periksa hasil menampilkan cara sistem membaca kode gender di file.
7. **[#2] Header "Ukuran K / P / B"** (1) → "Ukuran kemeja / polo / blazer".
8. **[#1] Sel stok 0 tanpa kebutuhan tampil merah di peta ukuran** (alarm palsu, 2) → abu-abu netral; merah hanya bila kurang dari kebutuhan antrian.
9. **[#1] Deadline kirim tampil merah "lewat" padahal modul batch belum ada** (2) → netral sampai M2 bisa mengecek status batch.
10. **[#6] Chip paket menampilkan kode item (KMJ, POLO)** (1) → nama item + catatan bahwa qty = versi terbaru.
11. **[#7] Input opname puluhan baris** (2) → Enter pindah ke baris berikutnya.
12. **[#8] Dua tombol "Buat lembar opname" sekaligus; ID opname "#34" tidak bermakna** (1) → satu tombol; judul memakai tanggal hitung.
13. **[#1] Mode demo membekukan UI saat query** (2, demo saja) → PGlite dipindah ke Web Worker.

## Temuan Minor (skor 1–2) — nice to have
1. **Beranda [#1, #8]** — tren 6 bulan baru ada untuk KPI kepatuhan PPM; KPI lain (tiba sebelum join, no-show, dll.) belum tersedia sehingga ada catatan kaki. → Tren & KPI lengkap di M5 (butuh snapshot KPI bulanan).
2. **Beranda / Stok [#2]** — istilah "SKU stock-out", "Available", "Reserved" tetap bahasa Inggris sesuai PRD, sudah diberi tooltip. → Pertahankan; tambahkan ke glosarium Panduan bila staf masih bingung saat UAT.
3. **Karyawan [#1]** — di mode demo tabel 130+ karyawan butuh ±1 detik (skeleton tampil). Di Supabase jauh lebih cepat. → Tidak perlu tindakan.
4. **Paket [#6]** — aksi paket (ubah, duplikat, nonaktif, hapus) tersembunyi di menu "⋯". → Pertimbangkan tombol "Ubah" terlihat langsung bila UAT menunjukkan staf tidak menemukannya.
5. **Paket [#2]** — "over-issued" masih istilah Inggris (ada penjelasan saat hover). → Ganti menjadi "menerima lebih dari hak" di M4 saat daftar retur dibangun.
6. **Import [#8]** — preview punya 8 tab. → Tab kosong disembunyikan untuk Error/Peringatan; pertahankan.

## Yang Sudah Bagus
- **Status sistem jelas**: countdown cutoff & deadline di sidebar, stepper di import & opname, "Tersimpan otomatis 12.55", loading state di semua tombol.
- **Pencegahan error kuat**: tidak ada data berubah sebelum *Simpan* di import; file sama ditolak; aksi tak terbalik (setujui opname, koreksi transaksi) wajib ketik kata konfirmasi + ringkasan dampak; ukuran di-dropdown hanya yang tersedia.
- **Pesan error bahasa manusia + jalan keluar**: "Cabang "ALP-999" belum terdaftar. Tambahkan di Master → Cabang lalu ulangi import", daftar catatan bisa diunduh untuk PPM; error teknis Postgres tidak pernah tampil mentah.
- **Preview dampak sebelum simpan** untuk mapping jabatan & perubahan paket (jumlah karyawan, tambahan outstanding per SKU, over-issued).
- **Pengenalan, bukan ingatan**: pencocokan kolom import diingat; filter tersimpan di URL; kartu karyawan dibuka sebagai drawer tanpa kehilangan filter; pencarian NIK *atau* nama.
- **Efisiensi pengguna rutin**: `/` untuk cari, bulk assign jabatan, upload/unduh lembar hitung opname, export XLSX di setiap tabel.
- **Konsistensi dengan app Alpro lain**: oranye Alpro, kartu membulat, info card sidebar, header judul + "Apotek Alpro • …", tombol aksi utama oranye di kanan atas, panel peringatan bergaris kiri merah.
- **Bantuan kontekstual**: ikon "?" di setiap judul halaman langsung ke bagian Panduan yang relevan; empty state berisi langkah berikutnya.

## Konsistensi Antar-Screen
- Tombol aksi utama selalu di kanan atas header, oranye; aksi berbahaya selalu merah + dialog konfirmasi. ✅
- Semua tabel memakai komponen yang sama (pencarian, jumlah baris, export, empty state). ✅
- Format tanggal ("24 Sep 2026") dan Rupiah ("Rp 95.000") dari satu helper. ✅
- Label status (chip) seragam: merah = kritis/kurang, kuning = perlu tindakan, hijau = aman, abu = netral. ✅
- Non-admin melihat catatan "hanya admin yang bisa mengubah" di semua layar master. ✅

## Di luar 10 heuristik (dicek terpisah)
- **Data pribadi**: NIK tidak pernah masuk URL (kartu karyawan dibuka lewat state), RLS default deny untuk akun tak terdaftar, cache dibersihkan saat ganti akun. ✅
- **Aksesibilitas dasar**: fokus keyboard terlihat (ring oranye), semua ikon-tombol punya `aria-label`, tabel punya `aria-sort`, error form `role="alert"`. Kontras teks abu (`#64748b` di putih) 4,8:1. ✅

## Verdik
**SIAP LANJUT KE M2** — tidak ada temuan skor 3–4 yang tersisa; temuan minor dicatat untuk UAT dan milestone berikutnya.

## Prioritas Perbaikan (Top 5, quick-win dulu)
1. Uji singkat dengan 1–2 staf Ops Support memakai file PPM asli (UAT) — Effort: Rendah — Impact: #2, #6 (validasi istilah & pencocokan kolom).
2. Ganti "over-issued" → "menerima lebih dari hak" di semua layar — Effort: Rendah — Impact: #2.
3. Tombol "Ubah" terlihat langsung di baris paket (bila UAT menunjukkan menu ⋯ tidak ditemukan) — Effort: Rendah — Impact: #6.
4. Snapshot KPI bulanan + tren 6 bulan semua KPI — Effort: Sedang — Impact: #1, #8 (M5).
5. Status deadline batch kembali berwarna (merah bila batch belum SHIPPED) — Effort: Rendah — Impact: #1 (M2).

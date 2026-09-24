# Audit Usability: Dashboard Seragam — Milestone M3 (Stok & Pengadaan)
Target user: admin Ops Support (membuat & mengirim PO, mingguan) dan staf/gudang (mencatat barang datang, tiap ada kiriman vendor) | Status: fitur baru (sebelum rilis) | Tanggal: 24 Sep 2026

Metode: 10 heuristik Nielsen, diuji langsung di mode demo (1440px dan tablet 768px) sebagai Admin:
Pengadaan → saran order → Buat PO dari saran (2 vendor, ubah qty, hapus baris) → PO draft → cetak PO →
terima barang sebagian pada PO yang lewat ETA (termasuk qty melebihi sisa) → tutup PO sisa; Stok (status baru), Beranda (alert & KPI stok).
Angka dicek ulang dengan test otomatis (AC #6, histori, fallback size curve, siklus PO, koreksi penerimaan). Skor = kondisi setelah perbaikan.

## Ringkasan Skor (0 = tidak ada masalah … 4 = blocker)

| # | Heuristik | Saran order | Buat PO | Detail PO & terima | Cetak PO | Stok & Beranda | Status |
|---|---|---|---|---|---|---|---|
| 1 | Visibility of system status | 1 | 0 | 0 | 0 | 1 | ✅ |
| 2 | Match with real world | 1 | 0 | 1 | 0 | 0 | ✅ |
| 3 | User control & freedom | 0 | 0 | 0 | 0 | 0 | ✅ |
| 4 | Consistency & standards | 0 | 0 | 0 | 0 | 0 | ✅ |
| 5 | Error prevention | 0 | 0 | 1 | 0 | 0 | ✅ |
| 6 | Recognition over recall | 0 | 0 | 0 | 0 | 0 | ✅ |
| 7 | Flexibility & efficiency | 0 | 0 | 1 | 0 | 0 | ✅ |
| 8 | Aesthetic & minimalist | 0 | 0 | 0 | 0 | 1 | ✅ |
| 9 | Recover from errors | 0 | 0 | 0 | 0 | 0 | ✅ |
| 10 | Help & documentation | 0 | 0 | 0 | 0 | 0 | ✅ |

Skor rata-rata: 0,1/4 | Blocker (4): 0 | Major (3): 0

## Sudah diperbaiki selama audit
1. **[#1 / #5] Saran order kosong untuk SKU kritis** (skor awal 4). SKU "Kritis" dengan kebutuhan 4 pcs tampil tanpa saran order: pembagian bilangan bulat saat membulatkan ke MOQ (4 ÷ 12 = 0). → Dihitung desimal; AC #6 kini diuji pada kebutuhan 4 → 12, 4 → 5 (MOQ 5), dan 4 → 4 (MOQ 4).
2. **[#8 / #2] 17 SKU "Kritis" yang sebenarnya tidak perlu dipesan** (3). Ukuran jarang (mis. Blazer Apoteker Pria 5XL, perkiraan 0,04 pcs/bulan) berstatus merah dan disarankan satu MOQ penuh, sehingga yang benar-benar mendesak tenggelam. → Kebutuhan dibulatkan ke pcs terdekat sebelum MOQ; SS/ROP di bawah ½ pcs tidak memicu status. Kritis turun menjadi SKU yang memang kurang untuk antrian.
3. **[#5] "Buat PO dari saran" bisa memesan dobel** (3). Qty yang sudah ada di PO draft tetap disarankan (sesuai rumus PRD), sehingga klik tombol yang sama dua kali membuat dua PO. → Kartu dan tombol memakai *saran yang belum di-PO*; kolom saran menandai "sudah di PO draft"; modal mengisi qty awal = sisa saran dan memberi peringatan.
4. **[#9 / #3] Tutup/Batalkan PO tanpa alasan** (3). Dialog tertutup lalu muncul error, dan isian hilang. → Tombol nonaktif sampai alasan diisi (min. 3 karakter); dialog tetap terbuka bila server menolak.
5. **[#1 / performa] Sidebar & Beranda melambat** (2). Alert SKU kritis menghitung ulang seluruh antrian di setiap halaman. → Kebutuhan antrian di perencanaan dihitung dari data hak yang sudah dimuat (tanpa menghitung ulang antrian); test memastikan hasilnya sama persis dengan Antrian Alokasi. Test performa (3.000 karyawan) lulus dengan view baru.
6. **[#6] Judul halaman PO terpotong di tablet** (2): tombol header mendesak judul. → Judul punya lebar minimum; tanggal/jam header hanya tampil di layar lebar.
7. **[#8] Tabel saran order melebar di 1440px** (2): kolom "Saran order", kolom terpenting, tersembunyi di balik scroll horizontal. → Judul kolom diringkas ("Dipesan", "Antrian", dengan penjelasan di ikon ?).
8. **[#4 / aksesibilitas] Tombol di dalam tombol** (2): ikon penjelasan (?) di judul kolom yang bisa diurutkan menghasilkan HTML tidak valid (juga di tabel Stok M1). → Ikon kini elemen fokus-able terpisah; klik ikon tidak mengubah urutan tabel.
9. **[#1] Kartu ringkasan menampilkan "0 SKU · Rp 0" saat memuat** (1) → kosong sampai data siap.
10. **[#2] Judul "PO PO-202609-001"** (1) → "PO-202609-001" dengan subjudul "Purchase order · vendor".
11. **[#8] Cap DRAFT menutupi judul kolom harga di cetakan** (1) → watermark diagonal samar.
12. **[Keandalan demo] Contoh PO tidak muncul** karena database demo tidak dibuat ulang saat data contoh berubah → versi database kini ikut isi data contoh.

## Temuan Minor (skor 1–2)
1. **Saran order [#1]** — Mode demo (Postgres di browser) butuh ±4–9 dtk untuk memuat ulang semua data setelah menyimpan. Di Supabase jauh lebih cepat, tetapi → **ukur saat UAT** dengan data 800 karyawan.
2. **Saran order [#2]** — Perkiraan dari size curve (label "perkiraan") bisa jauh di atas histori untuk ukuran yang sempat stock-out (mis. Kemeja Wanita M). Ini disengaja: histori rendah karena barang tidak ada. → Jelaskan di pelatihan; admin bisa mengubah qty sebelum PO disimpan.
3. **Detail PO [#2]** — Nilai PO memakai *price list* (harga ke karyawan), bukan harga beli vendor. Label sudah "Nilai (price list)". → Tambahkan harga beli per vendor bila Finance membutuhkan (M5/laporan).
4. **Terima barang [#5]** — Qty diterima otomatis terisi sesuai sisa. Cepat untuk kiriman lengkap, tetapi staf bisa lupa menyesuaikan kiriman parsial. Mitigasi: total pcs tampil di footer, qty > sisa ditolak, koreksi lewat Riwayat transaksi. → Pantau saat UAT; bila sering salah, ubah default menjadi kosong.
5. **Terima barang [#7]** — Belum ada scan barcode/surat jalan. → Fase lanjut.
6. **Stok [#8]** — Subjudul halaman Stok terpotong karena ada tombol tambahan "Saran order & PO". Kosmetik.

## Yang Sudah Bagus
- **Status jelas**: stepper PO (Draft → Dikirim ke vendor → Diterima sebagian → Diterima lengkap), progres "36/60 pcs", penanda "lewat ETA" merah di daftar, detail, dan Beranda.
- **Pencegahan error**: qty > sisa pesanan diblokir di layar dan di server; PO yang sudah ada penerimaan tidak bisa dibatalkan atau dikembalikan ke draft (sistem mengarahkan ke "Tutup PO"); PO draft tidak dihitung "dalam pemesanan"; qty bukan kelipatan MOQ diberi peringatan, tetapi tetap boleh.
- **Dunia nyata**: satu PO per vendor, nomor surat jalan per penerimaan, penerimaan bertahap, dokumen PO siap cetak/PDF dengan tanda tangan.
- **Pengenalan, bukan ingatan**: kolom Status/Available/Dipesan/Antrian/Rata-rata/Saran berdampingan; "+12 di PO draft" langsung di baris SKU; toggle "Tampilkan detail perhitungan" (SS, ROP, lead time, kebutuhan sebelum MOQ) diingat per pengguna.
- **Konsistensi & efisiensi**: pola tabel, filter di URL, pilih banyak → aksi massal, dan dialog konfirmasi sama dengan M1–M2; alert Beranda langsung membuka filter Kritis/Perlu order.
- **Koreksi**: salah catat penerimaan dibalik lewat Koreksi (REVERSAL); sisa PO dan status kembali otomatis karena status dihitung dari transaksi.

## Konsistensi Antar-Screen (M1 + M2 + M3)
- Warna status: merah = kritis/terlambat, amber = perlu tindakan/sebagian, biru = dalam proses (dikirim ke vendor / dalam pengiriman), hijau = selesai/aman, abu = draft/dibatalkan. ✅
- Aksi tak terbalik tetap memakai ketik-konfirmasi (opname, kirim batch, koreksi). Kirim PO dan terima barang tidak memakai ketik-konfirmasi karena masih bisa dikoreksi (kembali ke draft / REVERSAL). ✅
- Stok, Pengadaan, dan Beranda memakai sumber angka yang sama (`v_sku_planning`): status Kritis di Stok = di Pengadaan = jumlah di alert. ✅

## Verdik
**SIAP LANJUT KE M4** — tidak ada temuan skor 3–4 tersisa. Blocker pembulatan MOQ dan tiga temuan major sudah diperbaiki dan dilindungi test.

## Prioritas Perbaikan (Top 3)
1. Jalankan migration M3 di Supabase, lalu UAT satu siklus PO nyata (saran → PO → kiriman parsial → tutup) dengan admin & gudang — Effort: Rendah — Impact: #1, #2, #5.
2. Isi lead time & MOQ vendor yang sebenarnya di Harga & Vendor (demo memakai 30/45 hari, MOQ 12/6) — Effort: Rendah — Impact: #2.
3. Evaluasi default qty "Terima barang" setelah 2–3 kiriman nyata — Effort: Rendah — Impact: #5.

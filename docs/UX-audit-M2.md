# Audit Usability: Dashboard Seragam — Milestone M2 (Distribusi)
Target user: staf & admin Ops Support (pemakaian mingguan–bulanan saat cutoff, gudang saat picking/packing) | Status: fitur baru (sebelum rilis) | Tanggal: 24 Sep 2026

Metode: 10 heuristik Nielsen, diuji langsung di mode demo (1440px) sebagai Admin: antrian → buat batch ad-hoc hire mendadak
(dengan kekurangan stok) → picking → packing → tandai dikirim → konfirmasi terima + unggah BAST → batch selesai;
cetak BAST & label pada batch reguler berisi 20+ cabang; Beranda (KPI distribusi, status joiner). Skor = kondisi setelah perbaikan.

## Ringkasan Skor (0 = tidak ada masalah … 4 = blocker)

| # | Heuristik | Antrian Alokasi | Buat batch | Detail batch | Dokumen cetak | Beranda & sidebar | Status |
|---|---|---|---|---|---|---|---|
| 1 | Visibility of system status | 0 | 0 | 0 | 0 | 1 | ✅ |
| 2 | Match with real world | 1 | 0 | 1 | 0 | 0 | ✅ |
| 3 | User control & freedom | 0 | 0 | 0 | 0 | 0 | ✅ |
| 4 | Consistency & standards | 0 | 0 | 0 | 0 | 0 | ✅ |
| 5 | Error prevention | 0 | 0 | 0 | 0 | 0 | ✅ |
| 6 | Recognition over recall | 0 | 0 | 0 | 0 | 0 | ✅ |
| 7 | Flexibility & efficiency | 1 | 0 | 1 | 0 | 0 | ✅ |
| 8 | Aesthetic & minimalist | 0 | 0 | 1 | 0 | 0 | ✅ |
| 9 | Recover from errors | 0 | 0 | 0 | 0 | 0 | ✅ |
| 10 | Help & documentation | 0 | 0 | 0 | 0 | 0 | ✅ |

Skor rata-rata: 0,1/4 | Blocker (4): 0 | Major (3): 0

## Sudah diperbaiki selama audit
1. **[#1 / performa] Preview batch 61 detik untuk 1.500 karyawan** (skor awal 4 — layar terlihat macet). Filter antrian didorong optimizer ke perhitungan hak → O(n²). → Pagar `OFFSET 0` pada `v_queue` & `v_size_issue`; preview kini 153 ms. Test performa dikalibrasi terhadap kecepatan mesin agar regresi serupa selalu tertangkap.
2. **[#1] Sidebar menampilkan "belum ada batch · lewat 4 hari" (merah) selama data dimuat** (alarm palsu, 3) → netral sampai status batch terbaca.
3. **[#2] Status joiner "Sudah di cabang" padahal sebagian item masih kurang stok** (3, menyesatkan) → "Sebagian di cabang · sisa N pcs".
4. **[#6] Chip antrian "Kemeja Panjang M" tanpa gender** (2, bisa salah ambil saat picking) → "Kemeja Panjang Wanita M".
5. **[#7] Tombol "Buat batch ad-hoc" di callout membuka jenis Reguler** (2) → langsung Ad-hoc + cakupan Hire mendadak.
6. **[#8] Nomor dokumen BAST terpotong ke baris baru** (1) → tidak di-wrap.
7. **[Keandalan demo] Database demo rusak bila inisialisasi berjalan ganda** (StrictMode) → satu inisialisasi bersama + perbaikan otomatis bila setengah jadi.

## Temuan Minor (skor 1–2)
1. **Antrian [#2]** — "Aging" negatif ditulis "join N hr lagi"; istilah *aging* tetap dipakai sesuai PRD. → Tambahkan ke glosarium bila staf bingung saat UAT.
2. **Antrian [#7]** — belum ada "simpan filter favorit" per pengguna. → Filter sudah tersimpan di URL; cukup untuk M2.
3. **Detail batch [#2, #8]** — tombol aksi berpindah baris di bawah stepper pada layar < 1500px. → Kosmetik.
4. **Detail batch [#7]** — konfirmasi terima satu per cabang; batch reguler bisa 200+ cabang. → Rencana M5: link konfirmasi untuk APA (PRD) sehingga cabang mengonfirmasi sendiri.

## Yang Sudah Bagus
- **Pencegahan error berlapis**: stok dipesan (reserved) saat batch dibuat; batch tidak bisa melebihi Available (kekurangan jadi daftar shortage); "Tandai dikirim" wajib ketik KIRIM + ringkasan jumlah transaksi; sistem menolak kirim bila ada karyawan yang resign/batal join atau haknya berubah sejak batch dibuat, dan memberi tahu cara memperbaikinya.
- **Kontrol pengguna**: mundur status sebelum kirim, keluarkan baris, batalkan batch (dengan alasan), admin bisa membatalkan konfirmasi terima.
- **Status jelas**: stepper 5 langkah, progres "x/y cabang", penanda terlambat, status penyerahan per karyawan (Disiapkan → Dalam pengiriman → Ditahan APA → Diterima).
- **Dunia nyata**: dokumen cetak mengikuti pekerjaan gudang (pick list per SKU, packing list & BAST per cabang, label per paket dengan tanda "SIMPAN DI APA").
- **Konsistensi**: pola tabel, chip, dialog konfirmasi, dan tombol aksi utama sama dengan M1.

## Konsistensi Antar-Screen (M1 + M2)
- Warna status seragam: abu (draft/netral), biru (dalam proses), ungu (ditahan APA / hire mendadak), hijau (selesai), merah (terlambat/kurang). ✅
- Aksi tak terbalik (setujui opname, koreksi transaksi, tandai dikirim) semuanya memakai ketik-konfirmasi. ✅
- Dari mana pun (antrian, baris batch, beranda) klik karyawan membuka kartu karyawan yang sama, kini dengan riwayat pengiriman. ✅

## Verdik
**SIAP LANJUT KE M3** — tidak ada temuan skor 3–4 tersisa.

## Prioritas Perbaikan (Top 3)
1. Terapkan migration M2 di Supabase lalu UAT satu siklus batch nyata dengan tim gudang — Effort: Rendah — Impact: #2, #7.
2. Link konfirmasi terima untuk APA (M5) supaya admin tidak mengonfirmasi 200+ cabang satu per satu — Effort: Sedang — Impact: #7.
3. Glosarium istilah (aging, reserved, shortage) di Panduan — Effort: Rendah — Impact: #2.

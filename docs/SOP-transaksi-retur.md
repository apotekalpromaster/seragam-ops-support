# SOP — Transaksi Karyawan, Retur, QC & Afkir

**Siapa:** Staf/Admin Ops Support (hapuskan kewajiban retur & batalkan pembelian: admin). **Kapan:** saat ada pengajuan tukar/beli, setiap paket retur tiba di gudang, dan QC minimal seminggu sekali.

## Tukar barang cacat
1. **Tukar & Pembelian → Tukar barang cacat** (atau dari kartu karyawan). Cari karyawan (NIK/nama), pilih item.
2. Sistem menampilkan tanggal kirim dan sisa hari. Lewat batas (default 14 hari) → otomatis ditolak; klik **Proses sebagai pembelian**.
3. Pilih alasan: *Cacat produksi* (pengganti ukuran sama) atau *Deviasi spek vendor* (boleh ukuran lain). *Salah pilih ukuran* = pembelian.
4. Isi nama atasan yang menyetujui → simpan. Barang cacat masuk karantina; pengganti keluar dari stok layak.

## Pembelian (potong gaji)
1. **Catat pembelian** → karyawan → barang & qty → **periode potong gaji** → simpan. Harga otomatis dari price list.
2. Setiap awal bulan: **Laporan & Export → Potong gaji** → pilih periode → Export XLSX → kirim ke Payroll.
3. Salah input: admin **Batalkan** pembelian (dengan alasan). Bila export periode itu sudah terkirim, kabari Payroll.

## Resign & pengembalian
1. **Resign & Pengembalian → Wajib kembali** terisi otomatis dari data PPM (resign, PKL selesai, batal join, no-show, mutasi).
2. Baris merah = resign belum mengembalikan > 14 hari: tindak lanjuti ke APA/atasan.
3. Filter **Permintaan retur ke cabang** (batal join/no-show) → Export → kirim ke cabang.
4. Barang tiba → **Catat pengembalian** (qty sesuai hitung fisik, boleh sebagian). Barang masuk karantina.
5. Tidak mungkin kembali (hilang/rusak total, disetujui manajemen): admin **Hapuskan…** dengan alasan.
6. Tab **Akan resign**: kirim daftar ke APA supaya seragam diambil di hari terakhir kerja.

## QC & afkir
1. **QC & Afkir → Menunggu QC**: periksa per piece. A = layak pakai (setelah laundry), B = cacat minor → Cadangan, C = rusak → Afkir.
   Grade A bekas pakai masuk Cadangan selama kebijakan "retur grade A untuk joiner baru" = Tidak. Barang batal join/no-show grade A langsung Layak.
2. Semua bagus: centang baris → **Semua grade A**.
3. **Afkir menunggu pemusnahan**: musnahkan logo (gunting/bakar), lalu **Catat pemusnahan** dengan tanggal, cara, dan saksi.

**Salah catat?** Admin membuat Koreksi di Stok → Riwayat transaksi. Pengembalian yang barangnya sudah di-QC dikoreksi QC-nya dulu.

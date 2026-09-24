# SOP — Pengadaan (Saran Order & Purchase Order)

**Siapa:** Admin membuat & mengirim PO; Staf/Admin mencatat penerimaan barang. **Kapan:** cek menu Pengadaan minimal seminggu sekali dan setelah setiap batch reguler. Alert "SKU kritis" di Beranda = cek hari itu juga.

1. **Pengadaan → Saran order per SKU.** Mulai dari status **Kritis** (tidak cukup untuk antrian / di bawah safety stock), lalu **Perlu order** (sudah di titik pesan ulang).
2. Centang SKU atau klik **Buat PO dari saran**. Sistem mengelompokkan satu PO per vendor. Qty awal = saran order (sudah kelipatan MOQ); ubah bila perlu.
   SKU tanpa vendor wajib dipilihkan vendor dulu. Qty yang sudah ada di PO draft lain ditandai supaya tidak dipesan dobel.
3. **Simpan sebagai draft** → buka PO → periksa → **Cetak PO** → kirim dokumen ke vendor.
4. Klik **Kirim ke vendor** dan isi tanggal kirim. Perkiraan tiba (ETA) otomatis = tanggal kirim + lead time bila belum diisi.
   Sejak ini qty dihitung *dalam pemesanan* dan tidak disarankan lagi.
5. Barang datang: hitung fisik, cocokkan dengan surat jalan, lalu **Terima barang** — isi qty per SKU dan nomor surat jalan.
   Boleh bertahap; stok Layak langsung bertambah. Qty melebihi sisa pesanan ditolak (kelebihan diselesaikan dengan vendor).
6. PO otomatis **Diterima lengkap** saat semua SKU terpenuhi. Vendor tidak sanggup kirim sisa → **Tutup PO** dengan alasan.

**Salah langkah?** PO draft bisa diubah atau dibatalkan. PO yang sudah dikirim tetapi belum ada barang datang bisa *Kembali ke draft* atau *Batalkan*.
Salah catat penerimaan → admin membuat **Koreksi** di Stok → Riwayat transaksi; sisa PO otomatis kembali.

**Rumus (PRD §6):**
- Rata-rata/bln = barang keluar (kirim ke karyawan + pembelian + tukar) dalam jendela histori ÷ jumlah bulan. SKU tanpa histori: rencana hire/bulan × rata-rata qty item per karyawan × size curve.
- Safety stock = rata-rata × parameter SS (bulan) · ROP = rata-rata × lead time/30 + SS.
- Saran order = rata-rata × cakupan order + SS + kebutuhan antrian − available − dalam pemesanan → dibulatkan ke pcs terdekat, lalu ke atas ke kelipatan MOQ.
- Kritis: available < kebutuhan antrian, atau available ≤ SS. Perlu order: available + dalam pemesanan ≤ ROP. SS/ROP di bawah ½ pcs diabaikan.

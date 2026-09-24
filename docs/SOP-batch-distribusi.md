# SOP — Batch Distribusi

**Siapa:** Staf/Admin Ops Support. **Kapan:** batch reguler setelah import PPM (tanggal cutoff), selesai dikirim paling lambat tanggal deadline (default tanggal 20). Batch ad-hoc mingguan untuk hire mendadak.

1. **Antrian Alokasi → Buat batch.** Pilih jenis: *Reguler* (1 per periode), *Ad-hoc* (hire mendadak / cabang tertentu / karyawan terpilih), atau *Cabang baru*.
2. Periksa **preview**: baris, pcs, cabang, dan daftar **kekurangan stok**. Yang stoknya kurang tidak masuk batch dan tetap di antrian.
3. Buat batch. Stok langsung **dipesan (reserved)**.
4. **Mulai picking** → cetak *Pick list* (Batch → Dokumen cetak). Ambil barang per SKU.
5. **Selesai packing** → kemas per karyawan, tempel *Label nama*, masukkan *Packing list* dan *Form BAST* per cabang.
   Paket joiner berlabel "SIMPAN DI APA — serahkan saat join".
6. **Tandai sudah dikirim** (ketik KIRIM, isi tanggal kirim). Sistem mencatat transaksi kirim ke karyawan otomatis; tidak bisa dibatalkan.
   Bila ada karyawan yang resign/batal join sejak batch dibuat, sistem menolak dan meminta baris itu dikeluarkan dulu.
7. Saat BAST bertanda tangan diterima dari APA/BM: tab **Per cabang → Konfirmasi terima**, isi tanggal, unggah foto/scan BAST.
   Batch otomatis **Selesai** setelah semua cabang terkonfirmasi.

Salah langkah? Sebelum dikirim: *Kembali ke draft/picking*, *Keluarkan baris*, atau *Batalkan batch* (stok dilepas).
Salah konfirmasi terima: admin bisa *Batalkan* konfirmasi per cabang.

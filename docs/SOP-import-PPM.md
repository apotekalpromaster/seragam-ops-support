# SOP — Import Data PPM (bulanan)

**Kapan:** paling lambat tanggal cutoff (default tanggal 5). Import yang disimpan setelah tanggal itu tercatat *terlambat* di KPI.
**Siapa:** Admin Ops Support.

1. Terima file snapshot dari PPM. Isi: karyawan AKTIF, joiner OFFERING (bulan ini s/d 1 bulan ke depan, dengan ukuran),
   RESIGN (termasuk rencana resign), BATAL_JOIN. Format kolom: lihat `templates/template_snapshot_ppm.xlsx`.
2. Buka **Import Data PPM** → pilih **Periode cutoff** → tarik file ke kotak upload (atau *Pilih file*).
3. **Cocokkan kolom.** Sistem menebak otomatis dan mengingat pencocokan bulan lalu. Kolom bertanda * wajib.
4. **Periksa hasil.**
   - *Error* = baris dilewati (NIK dobel, cabang belum terdaftar, gender/status tidak dikenal). Unduh daftar catatan untuk PPM.
   - *Peringatan* = baris masuk tetapi perlu tindakan (jabatan belum dimapping, ukuran kosong / tidak tersedia).
   - Tab Baru / Resign / Mutasi menampilkan perubahan dibanding data sebelumnya.
5. Tekan **Simpan**. Tidak ada data yang berubah sebelum langkah ini. File yang sama tidak bisa disimpan dua kali.
6. Tindak lanjut di layar *Selesai*: petakan jabatan baru (**Mapping Jabatan**), tagih ukuran kosong ke PPM.

Catatan: kolom kosong di file **tidak** menghapus data lama (mis. ukuran). Gender boleh Pria/Wanita atau L/P
(bila ada "L" di file, "P" dibaca Perempuan — sistem menampilkan cara membacanya di langkah Periksa hasil).

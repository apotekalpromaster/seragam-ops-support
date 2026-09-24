import type { TemplateSpec } from './xlsx'

/**
 * Template import XLSX untuk migrasi data awal (PRD §11) dan pemakaian rutin.
 * Dipakai tombol "Template" di aplikasi dan skrip `npm run templates`.
 */
export const PPM_TEMPLATE: TemplateSpec = {
  file: 'template_snapshot_ppm.xlsx',
  sheet: 'Snapshot PPM',
  petunjuk: [
    'Satu baris = satu karyawan. Isi semua karyawan AKTIF, joiner (OFFERING) bulan berjalan s/d 1 bulan ke depan, dan yang RESIGN / BATAL_JOIN.',
    'Upload di menu Import Data PPM paling lambat tanggal cutoff (default tanggal 5).',
    'Gender boleh ditulis Pria/Wanita atau L/P. Tanggal boleh format 2026-10-01 atau 01/10/2026.',
    'Ukuran: S, M, L, XL, XXL, 3XL, 4XL, 5XL. Polo hanya sampai 3XL.',
    'Kolom kosong di file TIDAK menghapus data lama (mis. ukuran yang sudah pernah diisi).',
  ],
  columns: [
    { key: 'nik', header: 'NIK', wajib: true, contoh: '2260901', keterangan: 'Nomor induk karyawan, unik.' },
    { key: 'nama', header: 'Nama', wajib: true, contoh: 'Salsa Amelia', keterangan: '' },
    { key: 'gender', header: 'Gender', wajib: true, contoh: 'Wanita', keterangan: 'Pria/Wanita atau L/P.' },
    { key: 'jabatan', header: 'Jabatan', wajib: true, contoh: 'Kasir', keterangan: 'Sama persis dengan penulisan di data PPM; dipetakan ke paket di menu Mapping Jabatan.' },
    { key: 'kode_cabang', header: 'Kode cabang', wajib: true, contoh: 'ALP-001', keterangan: 'Harus sudah terdaftar di Master → Cabang.' },
    { key: 'status', header: 'Status', wajib: true, contoh: 'OFFERING', keterangan: 'AKTIF, OFFERING (akan join), RESIGN, atau BATAL_JOIN.' },
    { key: 'status_karyawan', header: 'Status kepegawaian', wajib: false, contoh: 'PROBATION', keterangan: 'TETAP/KONTRAK/PROBATION/PART_TIME/PKL. PKL/MAGANG = seragam dipinjam.' },
    { key: 'planned_join_date', header: 'Rencana join', wajib: false, contoh: '2026-10-01', keterangan: 'Wajib untuk OFFERING.' },
    { key: 'join_date', header: 'Tanggal join', wajib: false, contoh: '', keterangan: 'Tanggal join aktual.' },
    { key: 'planned_resign_date', header: 'Rencana resign', wajib: false, contoh: '', keterangan: 'Isi bila karyawan sudah mengajukan resign (notice).' },
    { key: 'resign_date', header: 'Tanggal resign', wajib: false, contoh: '', keterangan: 'Isi untuk status RESIGN.' },
    { key: 'size_kemeja', header: 'Ukuran kemeja', wajib: false, contoh: 'M', keterangan: 'S–5XL.' },
    { key: 'size_polo', header: 'Ukuran polo', wajib: false, contoh: 'M', keterangan: 'S–3XL.' },
    { key: 'size_blazer', header: 'Ukuran blazer', wajib: false, contoh: '', keterangan: 'Untuk TTK/Apoteker. S–5XL.' },
  ],
}

export const BRANCH_TEMPLATE: TemplateSpec = {
  file: 'template_cabang.xlsx', sheet: 'Cabang',
  petunjuk: ['Satu baris per cabang. Kode cabang harus sama dengan kode di data PPM.', 'Cabang yang sudah ada akan diperbarui (tidak dobel).', 'is_new_opening = Ya untuk cabang yang akan Grand Opening; isi go_date.'],
  columns: [
    { key: 'kode_cabang', header: 'Kode cabang', wajib: true, contoh: 'ALP-216', keterangan: '' },
    { key: 'nama', header: 'Nama cabang', wajib: true, contoh: 'Alpro Serpong', keterangan: '' },
    { key: 'area', header: 'Area', wajib: false, contoh: 'Tangerang', keterangan: 'Dipakai untuk filter & rekap.' },
    { key: 'alamat', header: 'Alamat kirim', wajib: false, contoh: 'Jl. Raya Serpong No. 1', keterangan: 'Alamat pengiriman paket seragam.' },
    { key: 'is_new_opening', header: 'Cabang baru?', wajib: false, contoh: 'Ya', keterangan: 'Ya/Tidak.' },
    { key: 'go_date', header: 'Tanggal GO', wajib: false, contoh: '2026-11-15', keterangan: 'Tanggal Grand Opening.' },
  ],
}

export const PRICE_TEMPLATE: TemplateSpec = {
  file: 'template_harga_vendor.xlsx', sheet: 'Harga SKU',
  petunjuk: ['Satu baris per SKU. Harga baru dengan tanggal berlaku berbeda disimpan sebagai riwayat, harga lama tidak hilang.', 'Vendor yang belum ada otomatis dibuat.', 'Kosongkan kolom yang tidak ingin diubah.'],
  columns: [
    { key: 'sku_code', header: 'Kode SKU', wajib: true, contoh: 'KMJ-P-L', keterangan: 'Lihat daftar di menu Item & SKU.' },
    { key: 'price', header: 'Harga (Rp)', wajib: false, contoh: '95000', keterangan: 'Angka tanpa titik/koma.' },
    { key: 'valid_from', header: 'Berlaku mulai', wajib: false, contoh: '2026-10-01', keterangan: 'Default hari ini.' },
    { key: 'vendor', header: 'Vendor', wajib: false, contoh: 'PT Konveksi Sinar Jaya', keterangan: '' },
    { key: 'lead_time_days', header: 'Lead time (hari)', wajib: false, contoh: '30', keterangan: 'Kosong = pakai lead time default vendor.' },
    { key: 'moq', header: 'MOQ', wajib: false, contoh: '12', keterangan: 'Kelipatan minimum order.' },
  ],
}

export const MAPPING_TEMPLATE: TemplateSpec = {
  file: 'template_mapping_jabatan.xlsx', sheet: 'Mapping',
  petunjuk: ['Satu baris per jabatan, tulis persis seperti di data PPM.', 'Kode paket awal: STD, STD-TTK, STD-APT, GA-A, GA-B (lihat menu Paket Alokasi).'],
  columns: [
    { key: 'jabatan', header: 'Jabatan', wajib: true, contoh: 'Kasir', keterangan: '' },
    { key: 'package_code', header: 'Kode paket', wajib: true, contoh: 'STD', keterangan: '' },
  ],
}

export const OPNAME_TEMPLATE: TemplateSpec = {
  file: 'template_stok_awal.xlsx', sheet: 'Lembar hitung',
  petunjuk: ['Unduh lembar hitung berisi semua SKU dari menu Stock Opname (lebih praktis), atau isi template ini.', 'Upload di menu Stock Opname → Upload hasil hitung, lalu ajukan & setujui.'],
  columns: [
    { key: 'sku_code', header: 'Kode SKU', wajib: true, contoh: 'KMJ-P-L', keterangan: '' },
    { key: 'stock_status', header: 'Status stok', wajib: false, contoh: 'LAYAK', keterangan: 'LAYAK (default) / CADANGAN / KARANTINA / AFKIR.' },
    { key: 'qty_fisik', header: 'Qty fisik', wajib: true, contoh: '24', keterangan: '' },
  ],
}

export const HISTORY_TEMPLATE: TemplateSpec = {
  file: 'template_riwayat_distribusi.xlsx', sheet: 'Riwayat',
  petunjuk: ['Seragam yang SUDAH diterima karyawan sebelum sistem dipakai. Mengurangi outstanding, tidak mengurangi stok.', 'Import data PPM dulu supaya NIK dikenal.', 'Jika ada 1 baris salah, tidak ada yang disimpan — perbaiki lalu upload ulang.'],
  columns: [
    { key: 'nik', header: 'NIK', wajib: true, contoh: '2250012', keterangan: '' },
    { key: 'item_code', header: 'Kode item', wajib: true, contoh: 'KMJ', keterangan: 'KMJ / POLO / BLZ-TTK / BLZ-APT.' },
    { key: 'size', header: 'Ukuran', wajib: true, contoh: 'L', keterangan: '' },
    { key: 'qty', header: 'Qty', wajib: true, contoh: '2', keterangan: '' },
    { key: 'tanggal', header: 'Tanggal terima', wajib: true, contoh: '2025-06-15', keterangan: '' },
  ],
}

export const CHART_TEMPLATE: TemplateSpec = {
  file: 'template_size_chart.xlsx', sheet: 'Size chart',
  petunjuk: ['Ukuran badan dari vendor, ditampilkan saat memilih ukuran karyawan.', 'Gender: P / W untuk kemeja & blazer, U untuk polo.'],
  columns: [
    { key: 'item_code', header: 'Kode item', wajib: true, contoh: 'KMJ', keterangan: '' },
    { key: 'gender', header: 'Gender', wajib: true, contoh: 'P', keterangan: 'P / W / U' },
    { key: 'size_code', header: 'Ukuran', wajib: true, contoh: 'L', keterangan: '' },
    { key: 'keterangan', header: 'Ukuran badan', wajib: true, contoh: 'LD 104 · PB 74 · PL 60 (cm)', keterangan: '' },
  ],
}

export const ALL_TEMPLATES = [PRICE_TEMPLATE, BRANCH_TEMPLATE, MAPPING_TEMPLATE, PPM_TEMPLATE, OPNAME_TEMPLATE, HISTORY_TEMPLATE, CHART_TEMPLATE]

/** Label Bahasa Indonesia untuk kode teknis (heuristik #2: bahasa pengguna). */
export const TX_LABEL: Record<string, string> = {
  OPENING: 'Saldo awal',
  IN: 'Terima dari PO',
  ISSUE: 'Kirim ke karyawan',
  EXC_OUT: 'Tukar — barang pengganti keluar',
  EXC_IN: 'Tukar — barang cacat masuk',
  SALE: 'Pembelian karyawan',
  RET: 'Pengembalian',
  QC_MOVE: 'Pindah status hasil QC',
  DISPOSE: 'Pemusnahan afkir',
  ADJ: 'Penyesuaian opname',
  REVERSAL: 'Koreksi transaksi',
}

export const STOCK_STATUS_LABEL: Record<string, string> = {
  LAYAK: 'Layak',
  KARANTINA: 'Karantina (belum QC)',
  CADANGAN: 'Cadangan',
  AFKIR: 'Afkir',
}

export const EMP_STATUS_LABEL: Record<string, string> = {
  OFFERING: 'Akan join',
  AKTIF: 'Aktif',
  BATAL_JOIN: 'Batal join',
  RESIGN: 'Resign',
}

export const DIFF_LABEL: Record<string, string> = {
  NEW_OFFERING: 'Joiner baru',
  NEW_AKTIF: 'Baru di data (aktif)',
  JOINED: 'Sudah join',
  BATAL_JOIN: 'Batal join',
  JOIN_DATE_CHANGE: 'Tanggal join berubah',
  RENCANA_RESIGN: 'Rencana resign',
  RESIGN: 'Resign',
  MUTASI_JABATAN: 'Mutasi jabatan',
  PINDAH_CABANG: 'Pindah cabang',
  UBAH_UKURAN: 'Ubah ukuran',
  TIDAK_BERUBAH: 'Tidak berubah',
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin Ops Support',
  staf: 'Staf Ops Support',
  viewer: 'Viewer (read-only)',
  apa: 'APA / Branch Manager',
}

export const GENDER_LABEL: Record<string, string> = { P: 'Pria', W: 'Wanita', U: 'Unisex' }

export const SCOPE_LABEL: Record<string, string> = {
  SEMUA_AKTIF: 'Semua karyawan aktif',
  KARYAWAN_BARU: 'Hanya karyawan baru',
}

export const SIZE_GROUP_LABEL: Record<string, string> = { KEMEJA: 'Ukuran kemeja', POLO: 'Ukuran polo', BLAZER: 'Ukuran blazer' }

export const ENTITAS_LABEL: Record<string, string> = {
  config: 'Parameter', item: 'Item', item_size: 'Ukuran item', sku: 'SKU', sku_price: 'Harga SKU', vendor: 'Vendor',
  package: 'Paket', package_version: 'Versi paket', package_item: 'Isi paket', position_map: 'Mapping jabatan',
  employee_package_override: 'Override karyawan', branch: 'Cabang', size_curve: 'Size curve', size_chart: 'Size chart',
  app_user: 'Pengguna', stock_opname: 'Stock opname', employee: 'Karyawan',
}

export const AKSI_LABEL: Record<string, string> = { INSERT: 'Tambah', UPDATE: 'Ubah', DELETE: 'Hapus', UBAH_UKURAN: 'Ubah ukuran' }

export const OPNAME_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Menunggu approval', APPROVED: 'Disetujui', DIBATALKAN: 'Dibatalkan',
}

export const BATCH_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', PICKING: 'Picking', PACKED: 'Packed', SHIPPED: 'Dikirim', SELESAI: 'Selesai', DIBATALKAN: 'Dibatalkan',
}
export const BATCH_JENIS_LABEL: Record<string, string> = { REGULER: 'Reguler (cutoff)', ADHOC: 'Ad-hoc', CABANG_BARU: 'Cabang baru' }
export const CAKUPAN_LABEL: Record<string, string> = {
  SEMUA: 'Semua antrian', HIRE_MENDADAK: 'Hire mendadak', CABANG: 'Cabang tertentu', KARYAWAN: 'Karyawan terpilih', CABANG_BARU: 'Cabang baru (GO)',
}
export const PENYERAHAN_LABEL: Record<string, string> = {
  DISIAPKAN: 'Disiapkan di gudang', DIKIRIM: 'Dalam pengiriman', DITAHAN_APA: 'Ditahan APA (belum join)', DITERIMA: 'Diterima cabang', DIBATALKAN: 'Batch dibatalkan',
}

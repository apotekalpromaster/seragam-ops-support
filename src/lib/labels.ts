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
  app_user: 'Pengguna', stock_opname: 'Stock opname', employee: 'Karyawan', purchase_order: 'Purchase order', sale: 'Pembelian karyawan',
}

export const AKSI_LABEL: Record<string, string> = {
  INSERT: 'Tambah', UPDATE: 'Ubah', DELETE: 'Hapus', UBAH_UKURAN: 'Ubah ukuran',
  PO_BUAT: 'Buat PO', PO_UBAH: 'Ubah PO', PO_KIRIM: 'Kirim PO ke vendor', PO_DRAFT: 'PO kembali ke draft', PO_BATAL: 'Batalkan PO', PO_TUTUP: 'Tutup PO', PO_TERIMA: 'Terima barang PO',
  BATAL_BELI: 'Batalkan pembelian', HAPUS_KEWAJIBAN_RETUR: 'Hapuskan kewajiban retur',
}

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

export const PLAN_STATUS_LABEL: Record<string, string> = { KRITIS: 'Kritis', ORDER: 'Perlu order', AMAN: 'Aman' }
export const PLAN_STATUS_TONE: Record<string, 'red' | 'amber' | 'green'> = { KRITIS: 'red', ORDER: 'amber', AMAN: 'green' }
export const DEMAND_SUMBER_LABEL: Record<string, string> = {
  HISTORI: 'Dari histori keluar', SIZE_CURVE: 'Perkiraan (rencana hire × size curve)', TIDAK_ADA: 'Belum ada permintaan',
}
export const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SENT: 'Dikirim ke vendor', PARTIAL: 'Diterima sebagian', RECEIVED: 'Diterima lengkap', CANCELLED: 'Dibatalkan',
}
export const PO_STATUS_TONE: Record<string, 'slate' | 'blue' | 'amber' | 'green'> = {
  DRAFT: 'slate', SENT: 'blue', PARTIAL: 'amber', RECEIVED: 'green', CANCELLED: 'slate',
}

export const EXCHANGE_ALASAN_LABEL: Record<string, string> = { CACAT_PRODUKSI: 'Cacat produksi', DEVIASI_SPEK_VENDOR: 'Deviasi spek vendor' }
export const RETUR_SUMBER_LABEL: Record<string, string> = {
  RESIGN: 'Resign', PKL_SELESAI: 'PKL/magang selesai', BATAL_JOIN: 'Batal join', NOSHOW: 'Tidak hadir (no-show)', MUTASI: 'Mutasi / di atas hak',
  TUKAR: 'Tukar (barang cacat)', OPNAME: 'Hasil opname',
}
export const RETUR_STATUS_LABEL: Record<string, string> = { BELUM: 'Belum kembali', SEBAGIAN: 'Sebagian', LENGKAP: 'Lengkap', DIHAPUSKAN: 'Dihapuskan' }
export const RETUR_STATUS_TONE: Record<string, 'red' | 'amber' | 'green' | 'slate'> = { BELUM: 'red', SEBAGIAN: 'amber', LENGKAP: 'green', DIHAPUSKAN: 'slate' }

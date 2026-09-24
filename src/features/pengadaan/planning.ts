/** Tipe data & helper Pengadaan (dipisah dari komponen supaya Fast Refresh tetap jalan). */
export interface PlanRow {
  sku_code: string; item_code: string; item_nama: string; gender: string; size_code: string; size_order: number; label: string; item_sort: number
  price: number | null; active: boolean; layak: number; karantina: number; cadangan: number; afkir: number; reserved: number; available: number
  vendor_id: number | null; vendor_nama: string | null; lead_time_days: number; moq: number; on_order: number; qty_po_draft: number
  pipeline_demand: number; demand_histori: number; demand_bulan: number; demand_sumber: string
  avg_demand: number; safety_stock: number; rop: number; kebutuhan_order: number; suggested_order: number; status: string
}
export interface PoRow {
  id: number; kode: string; vendor_id: number; vendor_nama: string; vendor_kontak: string | null; tanggal: string; eta: string | null; fase: string
  catatan: string | null; sent_at: string | null; sent_by_nama: string | null; alasan_tutup: string | null; alasan_batal: string | null
  created_by_nama: string | null; created_at: string; jumlah_sku: number; qty_order: number; qty_received: number; sisa: number; nilai: number
  jumlah_penerimaan: number; terakhir_diterima: string | null; status: string; ditutup_kurang: boolean; terlambat: boolean
}

export interface PoLine {
  po_id: number; po_kode: string; sku_code: string; sku_label: string; item_sort: number; gender: string; size_order: number; moq: number
  qty_order: number; qty_received: number; sisa: number; harga: number | null; nilai: number | null; saran: number | null
}
/** Saran yang belum tertampung PO draft (dibulatkan ke MOQ). Draft tidak mengurangi saran menurut PRD §6,
 *  tetapi tombol "Buat PO dari saran" tidak boleh membuat pesanan dobel. */
export const sisaSaran = (r: PlanRow) => { const x = r.suggested_order - r.qty_po_draft; return x > 0 ? Math.ceil(x / r.moq) * r.moq : 0 }

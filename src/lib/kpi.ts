/** Definisi KPI PRD §2 dari satu baris seragam.v_kpi_monthly. Dipakai Laporan KPI bulanan & Beranda. */
export interface KpiMonth {
  periode: string
  karyawan_aktif: number | null; aktif_lengkap: number | null; sku_aktif: number | null; sku_stockout: number | null
  ppm_tepat_waktu: boolean | null; ppm_ada_import: boolean | null
  batch_dikirim: number; batch_tepat_waktu: number
  joiner_join: number; joiner_tiba_sebelum_join: number; joiner_late_hire: number
  joiner_dikirim: number; joiner_noshow: number
  tukar: number; issue: number
  retur_kembali: number; retur_wajib: number
  opname_selisih: number | null; opname_stok_sistem: number | null
}

export interface KpiDef {
  key: string
  label: string
  target: string
  unit: '%' | ''
  tip: string
  /** null = belum ada data bulan itu */
  value: (m: KpiMonth) => number | null
  ok?: (v: number) => boolean
}

const pct = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a / b) * 100 : null)

export const KPI_DEFS: KpiDef[] = [
  { key: 'tiba', label: 'Seragam tiba sebelum join', target: '≥ 95%', unit: '%', tip: 'Joiner yang paketnya diterima cabang paling lambat tanggal join (per bulan join).',
    value: (m) => pct(m.joiner_tiba_sebelum_join, m.joiner_join), ok: (v) => v >= 95 },
  { key: 'late', label: 'Joiner di luar data forward', target: '≤ 10%', unit: '%', tip: 'Joiner lewat input hire mendadak (tidak ada di data PPM sebelum join).',
    value: (m) => pct(m.joiner_late_hire, m.joiner_join), ok: (v) => v <= 10 },
  { key: 'noshow', label: 'No-show', target: 'dipantau', unit: '%', tip: 'Joiner yang paketnya sudah dikirim lalu batal join / tidak hadir melewati masa tunggu (per bulan rencana join).',
    value: (m) => pct(m.joiner_noshow, m.joiner_dikirim) },
  { key: 'lengkap', label: 'Kelengkapan seragam', target: '≥ 98%', unit: '%', tip: 'Karyawan aktif dengan outstanding 0 (snapshot terakhir di bulan itu).',
    value: (m) => pct(m.aktif_lengkap, m.karyawan_aktif), ok: (v) => v >= 98 },
  { key: 'tukar', label: 'Tingkat tukar', target: '< 3%', unit: '%', tip: 'Barang pengganti tukar cacat ÷ barang dikirim ke karyawan.',
    value: (m) => pct(m.tukar, m.issue), ok: (v) => v < 3 },
  { key: 'retur', label: 'Return rate resign', target: '≥ 90%', unit: '%', tip: 'Item kembali ÷ item wajib kembali, karyawan resign/PKL per bulan resign (kondisi saat ini).',
    value: (m) => pct(m.retur_kembali, m.retur_wajib), ok: (v) => v >= 90 },
  { key: 'akurasi', label: 'Akurasi stok', target: '≥ 98%', unit: '%', tip: '1 − (|selisih opname| ÷ stok sistem), opname yang disetujui di bulan itu.',
    value: (m) => (m.opname_stok_sistem ? (1 - (m.opname_selisih ?? 0) / m.opname_stok_sistem) * 100 : null), ok: (v) => v >= 98 },
  { key: 'stockout', label: 'SKU stock-out', target: '0', unit: '', tip: 'SKU aktif dengan available ≤ 0 (snapshot terakhir di bulan itu).',
    value: (m) => m.sku_stockout, ok: (v) => v === 0 },
  { key: 'ppm', label: 'Kepatuhan data PPM', target: '100%', unit: '%', tip: 'Import snapshot PPM tersimpan paling lambat tanggal cutoff.',
    value: (m) => (m.ppm_ada_import == null ? null : m.ppm_tepat_waktu ? 100 : 0), ok: (v) => v === 100 },
  { key: 'batch', label: 'Ketepatan batch', target: '100%', unit: '%', tip: 'Batch yang dikirim paling lambat deadline kirim.',
    value: (m) => pct(m.batch_tepat_waktu, m.batch_dikirim), ok: (v) => v === 100 },
]

export function fmtKpi(v: number | null, unit: string) {
  if (v == null) return '—'
  return unit === '%' ? `${(Math.round(v * 10) / 10).toLocaleString('id-ID')}%` : v.toLocaleString('id-ID')
}

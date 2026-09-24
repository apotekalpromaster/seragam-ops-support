import { useView } from '../../lib/api'

export interface SetupStatus { cabang: number; harga: number; mapping: number; karyawan: number; opening: boolean; riwayat: number; chart: number }

/** Status data awal (dipakai halaman Migrasi & panduan hari pertama di Beranda). */
export function useSetupStatus(): SetupStatus | null {
  const b = useView<{ kode_cabang: string }>('branch', { columns: 'kode_cabang' })
  const p = useView<{ sku_code: string }>('v_sku_price_current', { columns: 'sku_code' })
  const m = useView<{ jabatan: string }>('position_map', { columns: 'jabatan' })
  const e = useView<{ nik: string }>('employee', { columns: 'nik' })
  const o = useView<{ id: number }>('ledger', { columns: 'id', filters: [['tx_type', 'eq', 'OPENING']], limit: 1 })
  const r = useView<{ id: number }>('ledger', { columns: 'id', filters: [['affects_stock', 'is', false]] })
  const c = useView<{ item_code: string }>('size_chart', { columns: 'item_code' })
  if (!b.data || !p.data || !m.data || !e.data || !o.data || !r.data || !c.data) return null
  return { cabang: b.data.length, harga: p.data.length, mapping: m.data.length, karyawan: e.data.length, opening: o.data.length > 0, riwayat: r.data.length, chart: c.data.length }
}


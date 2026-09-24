import { describe, expect, it } from 'vitest'
import { freshDb, rpc, select } from './harness'

// Skala PRD §8: ±3.000 karyawan. Memastikan view utama tetap responsif.
describe('performa', () => {
  it('3.000 karyawan: import + view utama < 5 detik per query', async () => {
    const db = await freshDb()
    const branches = Array.from({ length: 215 }, (_, i) => ({ kode_cabang: `C${i + 1}`, nama: `Cabang ${i + 1}`, area: `Area ${i % 12}` }))
    await rpc(db, 'admin', 'fn_branch_upsert', { rows: branches })
    await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [
      { jabatan: 'Kasir', package_code: 'STD' }, { jabatan: 'TTK', package_code: 'STD-TTK' }, { jabatan: 'Apoteker', package_code: 'STD-APT' },
    ] })
    const jab = ['Kasir', 'TTK', 'Apoteker']
    const sizes = ['S', 'M', 'L', 'XL', 'XXL']
    const rows = Array.from({ length: Number(process.env.N ?? 3000) }, (_, i) => ({
      nik: `N${String(i).padStart(5, '0')}`, nama: `Karyawan ${i}`, gender: i % 2 ? 'Pria' : 'Wanita',
      jabatan: jab[i % 3], kode_cabang: `C${(i % 215) + 1}`, status: i % 10 === 0 ? 'OFFERING' : 'AKTIF',
      join_date: '2025-01-01', planned_join_date: '2026-10-15',
      size_kemeja: sizes[i % 5], size_polo: sizes[(i + 1) % 5], size_blazer: sizes[(i + 2) % 5],
    }))
    let t = Date.now()
    const prev = await rpc(db, 'admin', 'fn_import_preview', { file_name: 'big', file_hash: 'big', periode: '2026-09-01', rows })
    const tPreview = Date.now() - t; console.log('preview', tPreview)
    t = Date.now()
    await rpc(db, 'admin', 'fn_import_commit', { import_id: prev.id })
    const tCommit = Date.now() - t; console.log('commit', tCommit)
    const timings: Record<string, number> = { preview: tPreview, commit: tCommit }
    for (const v of ['v_employee_list', 'v_outstanding', 'v_alert', 'v_kpi_current', 'v_stock_sku', 'v_package']) {
      t = Date.now()
      await select(db, 'admin', v)
      timings[v] = Date.now() - t; console.log(v, timings[v])
    }
    console.log(timings)
    for (const [k, ms] of Object.entries(timings)) {
      expect(ms, k).toBeLessThan(k === 'preview' || k === 'commit' ? 60000 : 5000)
    }
  }, 180000)
})

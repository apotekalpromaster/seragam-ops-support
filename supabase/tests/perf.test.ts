import { describe, expect, it } from 'vitest'
import { freshDb, rpc, select } from './harness'

// Skala PRD §8: ±3.000 karyawan. Waktu absolut PGlite (WASM) sangat bergantung kondisi laptop,
// jadi batas dihitung relatif terhadap kueri kalibrasi di mesin yang sama. Tujuannya menangkap
// regresi kompleksitas (mis. kueri O(n²) yang pernah membuat v_alert 75 detik), bukan kecepatan mesin.
const N = Number(process.env.N ?? 3000)

describe('performa', () => {
  it(`${N} karyawan: import + view utama tetap linear`, async () => {
    const db = await freshDb()
    let t = Date.now()
    await db.query('select count(*) from generate_series(1, 3000000) g where g % 7 = 0')
    const unit = Math.max(50, Date.now() - t) // "satuan kerja" mesin ini

    const branches = Array.from({ length: 215 }, (_, i) => ({ kode_cabang: `C${i + 1}`, nama: `Cabang ${i + 1}`, area: `Area ${i % 12}` }))
    await rpc(db, 'admin', 'fn_branch_upsert', { rows: branches })
    await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [
      { jabatan: 'Kasir', package_code: 'STD' }, { jabatan: 'TTK', package_code: 'STD-TTK' }, { jabatan: 'Apoteker', package_code: 'STD-APT' },
    ] })
    const jab = ['Kasir', 'TTK', 'Apoteker']
    const sizes = ['S', 'M', 'L', 'XL', 'XXL']
    const rows = Array.from({ length: N }, (_, i) => ({
      nik: `N${String(i).padStart(5, '0')}`, nama: `Karyawan ${i}`, gender: i % 2 ? 'Pria' : 'Wanita',
      jabatan: jab[i % 3], kode_cabang: `C${(i % 215) + 1}`, status: i % 10 === 0 ? 'OFFERING' : 'AKTIF',
      join_date: '2025-01-01', planned_join_date: '2026-10-15',
      size_kemeja: sizes[i % 5], size_polo: sizes[(i + 1) % 5], size_blazer: sizes[(i + 2) % 5],
    }))
    const timings: Record<string, number> = {}
    t = Date.now()
    const prev = await rpc(db, 'admin', 'fn_import_preview', { file_name: 'big', file_hash: 'big', periode: '2026-09-01', rows })
    timings.preview = Date.now() - t
    t = Date.now()
    await rpc(db, 'admin', 'fn_import_commit', { import_id: prev.id })
    timings.commit = Date.now() - t
    for (const v of ['v_employee_list', 'v_outstanding', 'v_queue', 'v_alert', 'v_kpi_current', 'v_stock_sku', 'v_package', 'v_sku_planning', 'v_po', 'v_return_obligation', 'v_return_employee', 'v_karantina_lot', 'v_akan_resign']) {
      t = Date.now()
      await select(db, 'admin', v)
      timings[v] = Date.now() - t
    }
    t = Date.now()
    await rpc(db, 'admin', 'fn_batch_preview', { jenis: 'REGULER' })
    timings.fn_batch_preview = Date.now() - t

    const ratio = Object.fromEntries(Object.entries(timings).map(([k, ms]) => [k, Math.round((ms / unit) * 10) / 10]))
    console.log({ unit_ms: unit, timings, ratio })
    // Setiap langkah maksimal 40× satuan kalibrasi. Pola O(n²) akan melonjak ratusan kali.
    for (const [k, r] of Object.entries(ratio)) expect(r, `${k} (${timings[k]} ms, unit ${unit} ms)`).toBeLessThan(40)
  }, 300000)
})

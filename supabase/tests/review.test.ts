import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { as, freshDb, rpc, select } from './harness'

// Regresi untuk temuan code review setelah M5.
let db: PGlite
const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10)
function row(o: Record<string, unknown>) {
  return { nik: 'E1', nama: 'Siti', gender: 'Wanita', jabatan: 'Kasir', kode_cabang: 'JKT01', status: 'AKTIF', join_date: '2025-01-10',
    size_kemeja: 'L', size_polo: 'M', size_blazer: 'XL', ...o }
}
let hashN = 0
async function importRows(rows: unknown[]) {
  const prev = await rpc(db, 'admin', 'fn_import_preview', { file_name: 'x', file_hash: `h${hashN++}`, periode: '2026-09-05', rows })
  await rpc(db, 'admin', 'fn_import_commit', { import_id: prev.id })
}
async function opname(qty: Record<string, number>, status = 'LAYAK') {
  const o = await rpc(db, 'admin', 'fn_opname_create', { tanggal: day(0) })
  const lines = await select(db, 'admin', 'v_opname_line', 'where opname_id = $1', [o.id])
  await rpc(db, 'admin', 'fn_opname_save_lines', { opname_id: o.id, lines: lines.map((l: any) => ({
    sku_code: l.sku_code, stock_status: l.stock_status, qty_fisik: l.stock_status === status && qty[l.sku_code] !== undefined ? qty[l.sku_code] : l.qty_sistem, alasan: 'hitung' })) })
  await rpc(db, 'admin', 'fn_opname_submit', { opname_id: o.id })
  await rpc(db, 'admin', 'fn_opname_approve', { opname_id: o.id })
}
async function ship() {
  const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'ADHOC', cakupan: 'SEMUA' })
  for (const s of ['PICKING', 'PACKED', 'SHIPPED']) await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: s })
  return b.id as number
}
async function expectError(p: Promise<unknown>, re: string) { await expect(p).rejects.toThrow(new RegExp(re)) }

beforeEach(async () => {
  db = await freshDb()
  hashN = 0
  await rpc(db, 'admin', 'fn_branch_upsert', { rows: [{ kode_cabang: 'JKT01', nama: 'Alpro Kemang', area: 'Jaksel' }] })
  await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [{ jabatan: 'Kasir', package_code: 'STD' }] })
  const skus = (await db.query<{ sku_code: string }>('select sku_code from seragam.sku')).rows
  await rpc(db, 'admin', 'fn_sku_bulk_update', { rows: skus.map((s) => ({ sku_code: s.sku_code, price: '95000', valid_from: '2026-01-01' })) })
  await opname({ 'KMJ-W-L': 20, 'KMJ-W-M': 5, 'POLO-U-M': 10 })
}, 60000)

describe('hak eksekusi fungsi', () => {
  it('pengguna login hanya bisa memanggil fn_* dan helper view/RLS', async () => {
    const exec = (await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'seragam' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')`)).rows.map((r) => r.proname)
    const allowed = new Set(['cfg', 'cfg_int', 'cfg_num', 'app_role', 'is_app_user', 'today', 'apa_cabang', 'apa_boleh_unggah'])
    expect(exec.filter((n) => !n.startsWith('fn_') && !allowed.has(n))).toEqual([])
    await expectError(as(db, 'staf', `select seragam._ledger_insert('IN', 'KMJ-W-L', 99, 'LAYAK')`), 'permission denied')
    await expectError(as(db, 'asing', `select seragam.write_audit('X', 'y', 'z', null, null)`), 'permission denied')
  })

  it('fungsi memakai zona waktu WIB', async () => {
    const bad = (await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'seragam' and p.prokind = 'f' and p.proname <> 'today'
        and not coalesce('TimeZone=Asia/Jakarta' = any (p.proconfig) or 'timezone=Asia/Jakarta' = any (p.proconfig), false)`)).rows
    expect(bad).toEqual([])
    const [{ ok }] = (await db.query<{ ok: boolean }>(`select seragam.today() = (now() at time zone 'Asia/Jakarta')::date as ok`)).rows
    expect(ok).toBe(true)
  })
})

describe('retur & QC', () => {
  it('retur menolak item ganda; SKU default mengikuti barang pengganti tukar', async () => {
    await importRows([row({})])
    await ship()
    await rpc(db, 'staf', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-M', qty: 2, alasan: 'DEVIASI_SPEK_VENDOR', approver: 'Bu Rina' })
    await importRows([row({ status: 'RESIGN', resign_date: day(1) })])
    const ob = (await select(db, 'admin', 'v_return_obligation', `where nik = 'E1' and item_code = 'KMJ'`))[0]
    expect(ob.sku_code).toBe('KMJ-W-M') // bukan KMJ-W-L dari ISSUE
    await expectError(rpc(db, 'staf', 'fn_return_receive', { nik: 'E1', tanggal: day(0), lines: [{ item_code: 'KMJ', qty: 2 }, { item_code: 'KMJ', qty: 2 }] }), 'lebih dari sekali')
  })

  it('selisih opname negatif di karantina mengurangi lot tertua', async () => {
    await importRows([row({})])
    await ship()
    await importRows([row({ status: 'RESIGN', resign_date: day(1) })])
    await rpc(db, 'staf', 'fn_return_receive', { nik: 'E1', tanggal: day(0), lines: [{ item_code: 'KMJ', qty: 2 }] })
    await opname({ 'KMJ-W-L': 1 }, 'KARANTINA') // fisik karantina hanya 1
    const lots = await select(db, 'admin', 'v_karantina_lot', `where sku_code = 'KMJ-W-L'`)
    expect(lots.reduce((a: number, l: any) => a + l.sisa, 0)).toBe(1)
    await rpc(db, 'staf', 'fn_qc', { lines: [{ lot_id: lots[0].lot_id, a: 1 }] })
    expect(await select(db, 'admin', 'v_karantina_lot', `where sku_code = 'KMJ-W-L'`)).toHaveLength(0)
  })
})

describe('koreksi pembelian', () => {
  it('semua baris SALE dikoreksi → pembelian ditandai dibatalkan', async () => {
    await importRows([row({})])
    const s = await rpc(db, 'staf', 'fn_sale_create', { nik: 'E1', periode_potong: '2099-10', lines: [{ sku_code: 'POLO-U-M', qty: 1 }] })
    const [l] = await select(db, 'admin', 'v_ledger', `where tx_type = 'SALE'`)
    await rpc(db, 'admin', 'fn_ledger_reverse', { id: l.id, alasan: 'salah input pembelian' })
    expect((await select(db, 'admin', 'v_sale', 'where id = $1', [s.id]))[0].dibatalkan).toBe(true)
  })
})

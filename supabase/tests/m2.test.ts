import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb, rpc, select } from './harness'

let db: PGlite

function row(o: Record<string, unknown>) {
  return {
    nik: 'A001', nama: 'Siti', gender: 'Wanita', jabatan: 'Kasir', kode_cabang: 'JKT01',
    status: 'AKTIF', join_date: '2025-01-10', size_kemeja: 'L', size_polo: 'M', size_blazer: 'XL', ...o,
  }
}
let hashN = 0
async function importRows(rows: unknown[], periode = '2026-09-05') {
  const prev = await rpc(db, 'admin', 'fn_import_preview', { file_name: 'x.xlsx', file_hash: `h${hashN++}`, periode, rows })
  await rpc(db, 'admin', 'fn_import_commit', { import_id: prev.id })
}
/** Saldo awal lewat opname pertama. */
async function stock(qty: Record<string, number>) {
  const o = await rpc(db, 'admin', 'fn_opname_create', { tanggal: '2026-08-01' })
  const lines = await select(db, 'admin', 'v_opname_line', 'where opname_id = $1', [o.id])
  await rpc(db, 'admin', 'fn_opname_save_lines', { opname_id: o.id, lines: lines.map((l: any) => ({ sku_code: l.sku_code, qty_fisik: qty[l.sku_code] ?? 0 })) })
  await rpc(db, 'admin', 'fn_opname_submit', { opname_id: o.id })
  await rpc(db, 'admin', 'fn_opname_approve', { opname_id: o.id })
}
const avail = async (sku: string) => (await select(db, 'admin', 'v_stock_sku', 'where sku_code = $1', [sku]))[0]
const queue = (nik: string) => select(db, 'admin', 'v_queue', 'where nik = $1 order by item_code', [nik])
async function expectError(p: Promise<unknown>, kode: string) {
  await expect(p).rejects.toThrow(new RegExp(kode))
}
async function ship(id: number, tanggal?: string) {
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: id, status: 'PICKING' })
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: id, status: 'PACKED' })
  return rpc(db, 'staf', 'fn_batch_set_status', { batch_id: id, status: 'SHIPPED', tanggal })
}

beforeEach(async () => {
  db = await freshDb()
  hashN = 0
  await rpc(db, 'admin', 'fn_branch_upsert', { rows: [
    { kode_cabang: 'JKT01', nama: 'Alpro Kemang', area: 'Jaksel' },
    { kode_cabang: 'JKT02', nama: 'Alpro Tebet', area: 'Jaksel' },
    { kode_cabang: 'NEW01', nama: 'Alpro Baru', area: 'Bogor', is_new_opening: true, go_date: '2026-11-01' },
  ] })
  await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [
    { jabatan: 'Kasir', package_code: 'STD' }, { jabatan: 'TTK', package_code: 'STD-TTK' }, { jabatan: 'Apoteker', package_code: 'STD-APT' },
  ] })
}, 60000)

describe('batch distribusi', () => {
  it('AC3: batch tidak melebihi Available; kekurangan masuk shortage dan tetap di antrian', async () => {
    await importRows([
      row({ nik: 'E1', join_date: '2025-01-01' }),
      row({ nik: 'E2', join_date: '2025-02-01' }),
    ])
    await stock({ 'KMJ-W-L': 3, 'POLO-U-M': 5 }) // E1 butuh 2 kemeja, E2 butuh 2 → hanya E1 dapat
    const pv = await rpc(db, 'staf', 'fn_batch_preview', { jenis: 'REGULER' })
    expect(pv.baris).toBe(3)
    expect(pv.shortage).toEqual([{ sku_code: 'KMJ-W-L', label: 'Kemeja Panjang Wanita L', dibutuhkan: 2, available: 3 }])
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER' })
    expect(b.kode).toBe('BT-202609-REG')
    const lines = await select(db, 'admin', 'batch_line', 'where batch_id = $1 order by nik, item_code', [b.id])
    expect(lines.map((l: any) => `${l.nik}:${l.sku_code}:${l.qty}`)).toEqual(['E1:KMJ-W-L:2', 'E1:POLO-U-M:1', 'E2:POLO-U-M:1'])
    // reserve: available berkurang, layak tetap
    const s = await avail('KMJ-W-L')
    expect([s.layak, s.reserved, s.available]).toEqual([3, 2, 1])
    // antrian: E2 kemeja masih sisa, yang sudah di batch tidak dihitung lagi
    const q2 = await queue('E2')
    expect(q2.map((x: any) => `${x.item_code}:${x.sisa}`)).toEqual(['KMJ:2', 'POLO:0'])
    const sh = await select(db, 'admin', 'v_batch_shortage', 'where batch_id = $1', [b.id])
    expect(sh.map((x: any) => x.nik)).toEqual(['E2'])
  })

  it('AC4: SHIPPED membuat ISSUE otomatis, outstanding berkurang, stok & reserve turun', async () => {
    await importRows([row({ nik: 'E1' })])
    await stock({ 'KMJ-W-L': 5, 'POLO-U-M': 5 })
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER' })
    const r = await ship(b.id)
    expect(r.issue).toBe(2)
    const led = await select(db, 'admin', 'ledger', `where tx_type = 'ISSUE' order by sku_code`)
    expect(led.map((l: any) => [l.sku_code, l.qty, l.nik, Number(l.batch_id)])).toEqual([['KMJ-W-L', -2, 'E1', b.id], ['POLO-U-M', -1, 'E1', b.id]])
    expect(await select(db, 'admin', 'v_outstanding', `where nik = 'E1'`)).toHaveLength(0)
    const s = await avail('KMJ-W-L')
    expect([s.layak, s.reserved, s.available]).toEqual([3, 0, 3])
  })

  it('AC11: joiner di data Feb (join 10 Mar) masuk batch Feb; setelah SHIPPED tidak masuk batch Mar', async () => {
    await importRows([row({ nik: 'J1', status: 'OFFERING', join_date: '', planned_join_date: '2026-03-10' })], '2026-02-05')
    await stock({ 'KMJ-W-L': 10, 'POLO-U-M': 10 })
    const feb = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER', periode: '2026-02-05' })
    expect(feb.baris).toBe(2)
    await ship(feb.id)
    await importRows([row({ nik: 'J1', status: 'OFFERING', join_date: '', planned_join_date: '2026-03-10' })], '2026-03-05')
    await expectError(rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER', periode: '2026-03-05' }), 'KOSONG')
  })

  it('AC13: hire mendadak → is_late_hire, masuk batch ad-hoc cakupan hire mendadak saja', async () => {
    await importRows([row({ nik: 'E1' })])
    await stock({ 'KMJ-P-XL': 5, 'POLO-U-L': 5, 'KMJ-W-L': 5, 'POLO-U-M': 5 })
    await rpc(db, 'staf', 'fn_hire_event', { nik: 'H1', nama: 'Hire Cepat', gender: 'P', jabatan: 'Kasir', kode_cabang: 'JKT02', planned_join_date: '2026-09-28', size_kemeja: 'XL', size_polo: 'L' })
    const e = (await select(db, 'admin', 'employee', `where nik = 'H1'`))[0]
    expect([e.status, e.is_late_hire]).toEqual(['OFFERING', true])
    await expectError(rpc(db, 'staf', 'fn_hire_event', { nik: 'E1', nama: 'x', gender: 'P', jabatan: 'Kasir', kode_cabang: 'JKT01', planned_join_date: '2026-09-28' }), 'DUPLIKAT')
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'ADHOC', cakupan: 'HIRE_MENDADAK' })
    expect(b.kode).toBe('BT-202609-ADH-01')
    const lines = await select(db, 'admin', 'batch_line', 'where batch_id = $1', [b.id])
    expect([...new Set(lines.map((l: any) => l.nik))]).toEqual(['H1'])
    const alert = await select(db, 'admin', 'v_alert', `where kode = 'HIRE_MENDADAK'`)
    expect(alert).toHaveLength(0) // sudah masuk batch
  })

  it('satu batch reguler per periode; batal melepas reserve dan membuka lagi periode', async () => {
    await importRows([row({ nik: 'E1' })])
    await stock({ 'KMJ-W-L': 5, 'POLO-U-M': 5 })
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER' })
    await expectError(rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER' }), 'DUPLIKAT')
    await expectError(rpc(db, 'staf', 'fn_batch_cancel', { batch_id: b.id, alasan: '' }), 'VALIDASI')
    await rpc(db, 'staf', 'fn_batch_cancel', { batch_id: b.id, alasan: 'Salah cakupan' })
    expect((await avail('KMJ-W-L')).reserved).toBe(0)
    const b2 = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER' })
    expect(b2.kode).toBe('BT-202609-REG-2')
  })

  it('status: maju/mundur sebelum kirim, tidak bisa lompat; viewer ditolak', async () => {
    await importRows([row({ nik: 'E1' })])
    await stock({ 'KMJ-W-L': 5, 'POLO-U-M': 5 })
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER' })
    await expectError(rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'SHIPPED' }), 'STATUS')
    await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'PICKING' })
    await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'DRAFT' })
    await expectError(rpc(db, 'viewer', 'fn_batch_set_status', { batch_id: b.id, status: 'PICKING' }), 'AKSES_DITOLAK')
    await expectError(ship(b.id, '2099-01-01'), 'masa depan')
  })

  it('karyawan resign sebelum kirim → SHIPPED ditolak sampai barisnya dikeluarkan', async () => {
    await importRows([row({ nik: 'E1' }), row({ nik: 'E2' })])
    await stock({ 'KMJ-W-L': 10, 'POLO-U-M': 10 })
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER' })
    await importRows([row({ nik: 'E1' }), row({ nik: 'E2', status: 'RESIGN', resign_date: '2026-09-10' })])
    await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'PICKING' })
    await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'PACKED' })
    await expectError(rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'SHIPPED' }), 'sudah tidak aktif')
    const ids = (await select(db, 'admin', 'batch_line', `where batch_id = $1 and nik = 'E2'`, [b.id])).map((l: any) => l.id)
    await rpc(db, 'staf', 'fn_batch_remove_lines', { batch_id: b.id, line_ids: ids })
    const r = await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'SHIPPED' })
    expect(r.issue).toBe(2)
  })

  it('konfirmasi terima per cabang → SELESAI; joiner OFFERING = ditahan APA; batch terlambat terdeteksi', async () => {
    await importRows([
      row({ nik: 'E1', kode_cabang: 'JKT01' }),
      row({ nik: 'J1', kode_cabang: 'JKT02', status: 'OFFERING', join_date: '', planned_join_date: '2026-12-01' }),
    ])
    await stock({ 'KMJ-W-L': 10, 'POLO-U-M': 10 })
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'REGULER', deadline_kirim: '2026-09-01' })
    expect((await select(db, 'admin', 'v_alert', `where kode = 'BATCH_TERLAMBAT'`))).toHaveLength(1)
    await ship(b.id)
    await expectError(rpc(db, 'staf', 'fn_batch_receive', { batch_id: b.id, kode_cabang: 'JKT01', tanggal: '2000-01-01' }), 'sebelum tanggal kirim')
    const r1 = await rpc(db, 'staf', 'fn_batch_receive', { batch_id: b.id, kode_cabang: 'JKT01', bast_path: 'batch-1/JKT01.pdf' })
    expect(r1.selesai).toBe(false)
    const r2 = await rpc(db, 'staf', 'fn_batch_receive', { batch_id: b.id, kode_cabang: 'JKT02' })
    expect(r2.selesai).toBe(true)
    const vb = (await select(db, 'admin', 'v_batch', 'where id = $1', [b.id]))[0]
    expect([vb.status, vb.cabang_diterima, vb.terlambat]).toEqual(['SELESAI', 2, true])
    const lines = await select(db, 'admin', 'v_batch_line', `where batch_id = $1 order by nik`, [b.id])
    expect([...new Set(lines.map((l: any) => `${l.nik}:${l.penyerahan}`))]).toEqual(['E1:DITERIMA', 'J1:DITAHAN_APA'])
    await rpc(db, 'admin', 'fn_batch_unreceive', { batch_id: b.id, kode_cabang: 'JKT02' })
    expect((await select(db, 'admin', 'batch', 'where id = $1', [b.id]))[0].status).toBe('SHIPPED')
  })

  it('cakupan cabang baru hanya mengambil cabang is_new_opening', async () => {
    await importRows([row({ nik: 'E1' }), row({ nik: 'N1', kode_cabang: 'NEW01' })])
    await stock({ 'KMJ-W-L': 10, 'POLO-U-M': 10 })
    const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'CABANG_BARU', cakupan: 'CABANG_BARU' })
    const lines = await select(db, 'admin', 'batch_line', 'where batch_id = $1', [b.id])
    expect([...new Set(lines.map((l: any) => l.kode_cabang))]).toEqual(['NEW01'])
  })
})

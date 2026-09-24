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
async function importRows(rows: unknown[]) {
  const prev = await rpc(db, 'admin', 'fn_import_preview', { file_name: 'x.xlsx', file_hash: `h${hashN++}`, periode: '2026-09-05', rows })
  await rpc(db, 'admin', 'fn_import_commit', { import_id: prev.id })
}
async function stock(qty: Record<string, number>) {
  const o = await rpc(db, 'admin', 'fn_opname_create', { tanggal: '2026-08-01' })
  const lines = await select(db, 'admin', 'v_opname_line', 'where opname_id = $1', [o.id])
  await rpc(db, 'admin', 'fn_opname_save_lines', { opname_id: o.id, lines: lines.map((l: any) => ({ sku_code: l.sku_code, qty_fisik: qty[l.sku_code] ?? 0 })) })
  await rpc(db, 'admin', 'fn_opname_submit', { opname_id: o.id })
  await rpc(db, 'admin', 'fn_opname_approve', { opname_id: o.id })
}
/** Batch reguler lalu kirim; daysAgo > 0 = tanggal kirim di masa lalu. */
async function shipAll(daysAgo = 0) {
  const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'ADHOC', cakupan: 'SEMUA' })
  const d = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
  if (daysAgo) await db.query('update seragam.batch set created_at = $1::date where id = $2', [d, b.id])
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'PICKING' })
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'PACKED' })
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'SHIPPED', tanggal: d })
  return b.id as number
}
const today = () => new Date().toISOString().slice(0, 10)
const sku = async (s: string) => (await select(db, 'admin', 'v_stock_sku', 'where sku_code = $1', [s]))[0]
const outstanding = async (nik: string, item: string) =>
  (await select(db, 'admin', 'v_employee_item', 'where nik = $1 and item_code = $2', [nik, item]))[0]?.outstanding ?? 0
const obligation = (nik: string) => select(db, 'admin', 'v_return_obligation', 'where nik = $1 order by item_sort', [nik])
async function expectError(p: Promise<unknown>, kode: string) {
  await expect(p).rejects.toThrow(new RegExp(kode))
}

beforeEach(async () => {
  db = await freshDb()
  hashN = 0
  await rpc(db, 'admin', 'fn_branch_upsert', { rows: [{ kode_cabang: 'JKT01', nama: 'Alpro Kemang', area: 'Jaksel' }] })
  await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [
    { jabatan: 'Kasir', package_code: 'STD' }, { jabatan: 'TTK', package_code: 'STD-TTK' }, { jabatan: 'Apoteker', package_code: 'STD-APT' },
  ] })
  const skus = (await db.query<{ sku_code: string; item_code: string }>('select sku_code, item_code from seragam.sku')).rows
  await rpc(db, 'admin', 'fn_sku_bulk_update', { rows: skus.map((s) => ({ sku_code: s.sku_code, price: s.item_code === 'POLO' ? '65000' : '95000', valid_from: '2026-01-01' })) })
  await stock({ 'KMJ-W-L': 20, 'KMJ-W-M': 5, 'POLO-U-M': 10, 'POLO-U-L': 5, 'BLZ-TTK-W-XL': 3, 'BLZ-APT-W-XL': 3 })
}, 60000)

describe('tukar (PRD §4.3)', () => {
  it('AC5: > 14 hari atau alasan salah ukuran ditolak dan diarahkan ke pembelian', async () => {
    await importRows([row({ nik: 'E1' })])
    await shipAll(20)
    const chk = await rpc(db, 'staf', 'fn_exchange_check', { nik: 'E1', item_code: 'KMJ' })
    expect(chk.ok).toBe(false)
    expect(chk.hari).toBe(20)
    const p = { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-L', qty: 1, alasan: 'CACAT_PRODUKSI', approver: 'Bu Rina (AM)' }
    await expectError(rpc(db, 'staf', 'fn_exchange_create', p), 'TUKAR_DITOLAK.*20 hari.*pembelian')
  })

  it('dalam 14 hari: EXC_IN ke karantina, EXC_OUT dari layak, hak tidak berubah', async () => {
    await importRows([row({ nik: 'E1' })])
    await shipAll(3)
    await expectError(rpc(db, 'staf', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-M', qty: 1, alasan: 'SALAH_UKURAN', approver: 'Bu Rina' }), 'TUKAR_DITOLAK.*pembelian')
    await expectError(rpc(db, 'staf', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-M', qty: 1, alasan: 'DEVIASI_SPEK_VENDOR', approver: '' }), 'atasan')
    await expectError(rpc(db, 'staf', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-M', qty: 3, alasan: 'DEVIASI_SPEK_VENDOR', approver: 'Bu Rina' }), 'melebihi')
    await expectError(rpc(db, 'staf', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'POLO-U-M', qty: 1, alasan: 'DEVIASI_SPEK_VENDOR', approver: 'Bu Rina' }), 'item yang sama')
    await expectError(rpc(db, 'viewer', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-M', qty: 1, alasan: 'DEVIASI_SPEK_VENDOR', approver: 'Bu Rina' }), 'AKSES_DITOLAK')
    const r = await rpc(db, 'staf', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-M', qty: 1, alasan: 'DEVIASI_SPEK_VENDOR', approver: 'Bu Rina' })
    expect(r.kode).toMatch(/^TK-\d{6}-001$/)
    expect((await sku('KMJ-W-L')).karantina).toBe(1)
    expect((await sku('KMJ-W-M')).layak).toBe(4)
    expect(await outstanding('E1', 'KMJ')).toBe(0)
    const rekap = await select(db, 'admin', 'v_exchange_rekap')
    expect(rekap[0]).toMatchObject({ sku_code: 'KMJ-W-L', qty_tukar: 1, deviasi: 1, qty_issue: 2 })
    // Koreksi satu baris membalik pasangannya juga
    const [exIn] = await select(db, 'admin', 'v_ledger', `where tx_type = 'EXC_IN'`)
    const rev = await rpc(db, 'admin', 'fn_ledger_reverse', { id: exIn.id, alasan: 'salah input tukar' })
    expect(rev.pasangan).toBeTruthy()
    expect((await sku('KMJ-W-L')).karantina).toBe(0)
    expect((await sku('KMJ-W-M')).layak).toBe(5)
  })
})

describe('pembelian & potong gaji (PRD §4.4)', () => {
  it('AC7 & AC10: SALE tidak mengurangi outstanding, tidak wajib kembali, export per periode', async () => {
    await importRows([row({ nik: 'E1' }), row({ nik: 'E2', nama: 'Dewi' })])
    await expectError(rpc(db, 'staf', 'fn_sale_create', { nik: 'E1', lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] }), 'Periode potong')
    await expectError(rpc(db, 'staf', 'fn_sale_create', { nik: 'E1', periode_potong: '2026-10', lines: [{ sku_code: 'KMJ-W-L', qty: 99 }] }), 'STOK_TIDAK_CUKUP')
    const s1 = await rpc(db, 'staf', 'fn_sale_create', { nik: 'E1', periode_potong: '2099-10', lines: [{ sku_code: 'KMJ-W-L', qty: 1 }, { sku_code: 'POLO-U-M', qty: 2 }] })
    expect(s1).toMatchObject({ pcs: 3, nilai: 95000 + 2 * 65000 })
    const s2 = await rpc(db, 'staf', 'fn_sale_create', { nik: 'E2', periode_potong: '2099-11-15', lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] })
    expect(await outstanding('E1', 'KMJ')).toBe(2) // pembelian bukan pemenuhan hak
    expect((await sku('KMJ-W-L')).layak).toBe(18)

    const okt = await select(db, 'viewer', 'v_payroll_deduction', `where periode_potong = '2099-10-01'`)
    expect(okt.map((r: any) => [r.nik, r.sku_code, r.qty, Number(r.nilai)])).toEqual(expect.arrayContaining([
      ['E1', 'KMJ-W-L', 1, 95000], ['E1', 'POLO-U-M', 2, 130000],
    ]))
    expect(okt).toHaveLength(2)
    await expectError(rpc(db, 'staf', 'fn_sale_cancel', { id: s2.id, alasan: 'salah' }), 'AKSES_DITOLAK')
    await rpc(db, 'admin', 'fn_sale_cancel', { id: s2.id, alasan: 'dobel input' })
    expect(await select(db, 'admin', 'v_payroll_deduction', `where periode_potong = '2099-11-01'`)).toHaveLength(0)
    expect((await sku('KMJ-W-L')).layak).toBe(19)

    // Setelah resign, barang beli tidak masuk wajib kembali
    await importRows([row({ nik: 'E1', status: 'RESIGN', resign_date: '2026-09-01' }), row({ nik: 'E2', nama: 'Dewi' })])
    expect(await obligation('E1')).toHaveLength(0) // belum pernah menerima alokasi
  })
})

describe('retur & QC (PRD §4.6–4.9)', () => {
  it('AC1 & AC8: resign & promosi → kewajiban retur; RET masuk karantina dan tidak bisa dialokasikan', async () => {
    await importRows([row({ nik: 'E1' }), row({ nik: 'E2', jabatan: 'TTK' })])
    await shipAll(2)
    await rpc(db, 'staf', 'fn_sale_create', { nik: 'E1', periode_potong: '2099-10', lines: [{ sku_code: 'POLO-U-M', qty: 1 }] })
    await importRows([
      row({ nik: 'E1', status: 'RESIGN', resign_date: '2026-09-01' }),
      row({ nik: 'E2', jabatan: 'Apoteker' }),
    ])
    const o1 = await obligation('E1')
    expect(o1.map((o: any) => [o.item_code, o.sumber, o.sisa, o.status])).toEqual([
      ['KMJ', 'RESIGN', 2, 'BELUM'], ['POLO', 'RESIGN', 1, 'BELUM'], // polo beli tidak dihitung
    ])
    const o2 = await obligation('E2')
    expect(o2.map((o: any) => [o.item_code, o.sumber, o.sisa])).toEqual([['BLZ-TTK', 'MUTASI', 1]])
    expect(await outstanding('E2', 'BLZ-APT')).toBe(1)

    await expectError(rpc(db, 'staf', 'fn_return_receive', { nik: 'E1', tanggal: today(), lines: [{ item_code: 'KMJ', qty: 3 }] }), 'melebihi')
    await expectError(rpc(db, 'staf', 'fn_return_receive', { nik: 'E1', tanggal: today(), lines: [{ item_code: 'BLZ-APT', qty: 1 }] }), 'tidak punya kewajiban')
    const before = await sku('KMJ-W-L')
    const r = await rpc(db, 'staf', 'fn_return_receive', { nik: 'E1', tanggal: today(), lines: [{ item_code: 'KMJ', qty: 1 }, { item_code: 'POLO', qty: 0 }] })
    expect(r.kode).toMatch(/^RT-/)
    const after = await sku('KMJ-W-L')
    expect(after.karantina).toBe(before.karantina + 1)
    expect(after.available).toBe(before.available) // AC8: karantina tidak bisa dialokasikan
    expect((await obligation('E1'))[0]).toMatchObject({ sisa: 1, dikembalikan: 1, status: 'SEBAGIAN' })

    // Hapuskan sisa (admin) → DIHAPUSKAN; staf tidak boleh
    await expectError(rpc(db, 'staf', 'fn_return_writeoff', { nik: 'E1', item_code: 'KMJ', qty: 1, alasan: 'hilang di cabang' }), 'AKSES_DITOLAK')
    await rpc(db, 'admin', 'fn_return_writeoff', { nik: 'E1', item_code: 'KMJ', qty: 1, alasan: 'hilang di cabang, disetujui AM' })
    expect((await obligation('E1'))[0]).toMatchObject({ sisa: 0, status: 'DIHAPUSKAN' })
    const emp = (await select(db, 'admin', 'v_return_employee', `where nik = 'E1'`))[0]
    expect(emp).toMatchObject({ sisa: 1, status: 'SEBAGIAN' })
    const kpi = (await select(db, 'admin', 'v_kpi_return'))[0]
    expect(kpi).toMatchObject({ dikembalikan: 1, sisa: 1, dihapuskan: 1 })

    // QC barang bekas pakai: grade A → CADANGAN (allow_reissue_grade_a = false)
    const [lot] = await select(db, 'admin', 'v_karantina_lot', `where nik = 'E1'`)
    expect(lot).toMatchObject({ sumber: 'RESIGN', bekas_pakai: true, tujuan_grade_a: 'CADANGAN', sisa: 1 })
    await expectError(rpc(db, 'staf', 'fn_qc', { lines: [{ lot_id: lot.lot_id, a: 2 }] }), 'melebihi')
    const q = await rpc(db, 'staf', 'fn_qc', { lines: [{ lot_id: lot.lot_id, a: 1 }] })
    expect(q.hasil).toMatchObject({ CADANGAN: 1 })
    expect((await sku('KMJ-W-L')).cadangan).toBe(1)
    expect(await select(db, 'admin', 'v_karantina_lot', `where nik = 'E1'`)).toHaveLength(0)
    // RET yang sudah di-QC tidak bisa dikoreksi
    const [ret] = await select(db, 'admin', 'v_ledger', `where tx_type = 'RET'`)
    await expectError(rpc(db, 'admin', 'fn_ledger_reverse', { id: ret.id, alasan: 'salah catat retur' }), 'sudah di-QC')
  })

  it('AC12: batal join setelah paket dikirim → permintaan retur; lolos QC → kembali LAYAK', async () => {
    await importRows([row({ nik: 'J1', status: 'OFFERING', join_date: '', planned_join_date: '2026-12-01' })])
    await shipAll(1)
    await importRows([row({ nik: 'J1', status: 'BATAL_JOIN', join_date: '', planned_join_date: '2026-12-01' })])
    const o = await obligation('J1')
    expect(o.map((x: any) => [x.item_code, x.sumber, x.sisa])).toEqual([['KMJ', 'BATAL_JOIN', 2], ['POLO', 'BATAL_JOIN', 1]])
    const alerts = await select(db, 'admin', 'v_alert')
    expect(alerts.find((a: any) => a.kode === 'PERMINTAAN_RETUR')?.jumlah).toBe(1)

    const layak = (await sku('KMJ-W-L')).layak
    await rpc(db, 'staf', 'fn_return_receive', { nik: 'J1', tanggal: today(), lines: [{ item_code: 'KMJ', qty: 2 }, { item_code: 'POLO', qty: 1 }] })
    const lots = await select(db, 'admin', 'v_karantina_lot', `where nik = 'J1' order by sku_code`)
    expect(lots.every((l: any) => l.sumber === 'BATAL_JOIN' && !l.bekas_pakai && l.tujuan_grade_a === 'LAYAK')).toBe(true)
    expect((await select(db, 'admin', 'v_alert')).find((a: any) => a.kode === 'QC_MENUNGGU')?.jumlah).toBe(3)
    await rpc(db, 'staf', 'fn_qc', { lines: lots.map((l: any) => ({ lot_id: l.lot_id, a: l.sisa })) })
    expect((await sku('KMJ-W-L')).layak).toBe(layak + 2)
    expect((await obligation('J1')).every((x: any) => x.status === 'LENGKAP')).toBe(true)
  })

  it('no-show lewat masa tunggu terdeteksi; QC grade C → afkir → pemusnahan', async () => {
    await importRows([row({ nik: 'N1', status: 'OFFERING', join_date: '', planned_join_date: today() })])
    await shipAll(0)
    expect(await obligation('N1')).toHaveLength(0) // masih dalam masa tunggu
    await db.query(`update seragam.employee set planned_join_date = current_date - 10 where nik = 'N1'`)
    expect((await obligation('N1'))[0]).toMatchObject({ sumber: 'NOSHOW', sisa: 2 })
    await rpc(db, 'staf', 'fn_return_receive', { nik: 'N1', tanggal: today(), lines: [{ item_code: 'KMJ', qty: 2 }] })
    const [lot] = await select(db, 'admin', 'v_karantina_lot', `where nik = 'N1'`)
    await rpc(db, 'staf', 'fn_qc', { lines: [{ lot_id: lot.lot_id, a: 1, c: 1 }] })
    expect((await sku('KMJ-W-L')).afkir).toBe(1)
    // Koreksi satu sisi QC membalik kedua baris (karantina kembali)
    const qc = await select(db, 'admin', 'v_ledger', `where tx_type = 'QC_MOVE' and stock_status = 'AFKIR'`)
    await rpc(db, 'admin', 'fn_ledger_reverse', { id: qc[0].id, alasan: 'salah grade, seharusnya B' })
    expect((await sku('KMJ-W-L')).afkir).toBe(0)
    expect((await select(db, 'admin', 'v_karantina_lot', `where nik = 'N1'`))[0].sisa).toBe(1)
    await rpc(db, 'staf', 'fn_qc', { lines: [{ lot_id: lot.lot_id, c: 1 }] })
    await expectError(rpc(db, 'staf', 'fn_dispose', { tanggal: today(), catatan: '', lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] }), 'pemusnahan')
    await expectError(rpc(db, 'staf', 'fn_dispose', { tanggal: today(), catatan: 'Logo digunting, saksi Budi', lines: [{ sku_code: 'KMJ-W-L', qty: 2 }] }), 'STOK_TIDAK_CUKUP')
    await rpc(db, 'staf', 'fn_dispose', { tanggal: today(), catatan: 'Logo digunting, saksi Budi', lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] })
    expect((await sku('KMJ-W-L')).afkir).toBe(0)
  })

  it('akan resign & alert retur terlambat', async () => {
    await importRows([row({ nik: 'E1' }), row({ nik: 'E2' })])
    await shipAll(40)
    await importRows([row({ nik: 'E1', planned_resign_date: '2099-01-31' }), row({ nik: 'E2', status: 'RESIGN', resign_date: '2026-01-01' })])
    const ar = await select(db, 'admin', 'v_akan_resign')
    expect(ar.map((r: any) => [r.nik, r.pcs])).toEqual([['E1', 3]])
    const alerts = await select(db, 'admin', 'v_alert')
    expect(alerts.find((a: any) => a.kode === 'RETUR_TERLAMBAT')?.jumlah).toBe(1)
  })
})

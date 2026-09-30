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
const plan = async (sku: string) => (await select(db, 'admin', 'v_sku_planning', 'where sku_code = $1', [sku]))[0]
const po = async (id: number) => (await select(db, 'admin', 'v_po', 'where id = $1', [id]))[0]
/** Kebutuhan antrian di perencanaan harus sama dengan Σ sisa v_queue (ukuran valid) untuk semua SKU. */
async function expectPipelineMatchesQueue() {
  const q = await select(db, 'admin', 'v_queue', `where size_status = 'OK'`)
  const want: Record<string, number> = {}
  for (const r of q) want[r.sku_target] = (want[r.sku_target] ?? 0) + r.sisa
  const got = Object.fromEntries((await select(db, 'admin', 'v_sku_planning', 'where pipeline_demand > 0')).map((r: any) => [r.sku_code, r.pipeline_demand]))
  expect(got).toEqual(Object.fromEntries(Object.entries(want).filter(([, v]) => v > 0)))
}
const cfg = (key: string, value: unknown) => rpc(db, 'admin', 'fn_config_set', { key, value })
async function expectError(p: Promise<unknown>, kode: string) {
  await expect(p).rejects.toThrow(new RegExp(kode))
}
async function ship(id: number) {
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: id, status: 'PICKING' })
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: id, status: 'PACKED' })
  return rpc(db, 'staf', 'fn_batch_set_status', { batch_id: id, status: 'SHIPPED' })
}
let vendor: number

beforeEach(async () => {
  db = await freshDb()
  hashN = 0
  await rpc(db, 'admin', 'fn_branch_upsert', { rows: [{ kode_cabang: 'JKT01', nama: 'Alpro Kemang', area: 'Jaksel' }] })
  await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [{ jabatan: 'Kasir', package_code: 'STD' }] })
  vendor = (await rpc(db, 'admin', 'fn_vendor_save', { nama: 'PT Konveksi', lead_time_default: 30 })).id
  await rpc(db, 'admin', 'fn_sku_bulk_update', { rows: [
    { sku_code: 'KMJ-W-L', vendor: 'PT Konveksi', moq: 12, price: '95000' },
    { sku_code: 'KMJ-W-M', vendor: 'PT Konveksi', moq: 1, price: '95000' },
    { sku_code: 'POLO-U-M', vendor: 'PT Konveksi', moq: 1, price: '65000' },
  ] })
}, 60000)

describe('perencanaan stok (PRD §6)', () => {
  it('AC6: saran order dibulatkan ke atas ke kelipatan MOQ; status KRITIS bila available < kebutuhan antrian', async () => {
    await cfg('planned_hires_per_month', 0) // tanpa histori & tanpa forecast → murni kebutuhan antrian
    await importRows([row({ nik: 'E1' }), row({ nik: 'E2' })]) // 2 × 2 kemeja wanita L
    let p = await plan('KMJ-W-L')
    expect(p.pipeline_demand).toBe(4)
    expect(Number(p.avg_demand)).toBe(0)
    expect(Number(p.kebutuhan_order)).toBe(4)
    expect(p.suggested_order).toBe(12) // 4 → MOQ 12
    expect(p.status).toBe('KRITIS')

    await rpc(db, 'admin', 'fn_sku_update', { sku_code: 'KMJ-W-L', moq: 5 })
    expect((await plan('KMJ-W-L')).suggested_order).toBe(5)
    await rpc(db, 'admin', 'fn_sku_update', { sku_code: 'KMJ-W-L', moq: 4 })
    expect((await plan('KMJ-W-L')).suggested_order).toBe(4) // tepat kelipatan: tidak dibulatkan naik

    // Stok cukup untuk antrian + tanpa permintaan rata-rata → AMAN, saran 0
    await stock({ 'KMJ-W-L': 4 })
    p = await plan('KMJ-W-L')
    expect(p.status).toBe('AMAN')
    expect(p.suggested_order).toBe(0)
  })

  /** Transaksi keluar bertanggal lampau (tanggal = ekspresi SQL relatif terhadap hari ini WIB). */
  async function out(tx: string, sku: string, qty: number, nik: string | null, tgl: string) {
    const r = await db.query<{ id: number }>(
      `select seragam._ledger_insert($1::seragam.tx_type, $2, $3, 'LAYAK', $4, 'test', 'TEST', (${tgl})::date) as id`, [tx, sku, -qty, nik])
    return Number(r.rows[0].id)
  }
  const past = (m: number, d = 0) => `seragam.today() - interval '${m} months' - interval '${d} days'`

  it('AvgDemand hanya dari permintaan rutin: karyawan baru, tukar, beli — bukan migrasi atau tunggakan', async () => {
    await cfg('planned_hires_per_month', 0)
    await importRows([row({ nik: 'E1' }), row({ nik: 'E2' })]) // karyawan lama (join 2025)
    await db.query(`update seragam.employee set join_date = (${past(4, 20)})::date where nik = 'E2'`) // E2 = karyawan baru
    await stock({ 'KMJ-W-L': 40, 'POLO-U-M': 10 })

    // Tidak dihitung: riwayat migrasi & kiriman tunggakan ke karyawan lama
    await rpc(db, 'admin', 'fn_issue_history_import', { rows: [{ nik: 'E1', item_code: 'KMJ', size: 'L', qty: 2, tanggal: '2026-08-15' }] })
    await out('ISSUE', 'KMJ-W-L', 2, 'E1', past(0, 3))
    let p = await plan('KMJ-W-L')
    expect(p.demand_histori).toBe(0)
    expect(Number(p.avg_demand)).toBe(0)
    expect(p.demand_sumber).toBe('TIDAK_ADA')

    // Dihitung: kiriman ke karyawan baru (≤ 60 hari setelah join), beli, tukar
    await out('ISSUE', 'KMJ-W-L', 2, 'E2', past(4, 5))
    await out('SALE', 'KMJ-W-L', 1, 'E1', past(1))
    await out('EXC_OUT', 'KMJ-W-L', 1, 'E1', past(0, 2))
    // Koreksi dinilai dari transaksi aslinya: kiriman rutin yang dikoreksi hilang dari histori
    const salah = await out('ISSUE', 'KMJ-W-L', 2, 'E2', past(4, 1))
    await rpc(db, 'admin', 'fn_ledger_reverse', { id: salah, alasan: 'salah input kiriman' })
    p = await plan('KMJ-W-L')
    expect(p.histori_cukup).toBe(true) // transaksi rutin pertama > 3 bulan lalu
    expect(p.demand_sumber).toBe('HISTORI')
    expect(p.demand_histori).toBe(4) // 2 + 1 + 1
    expect(p.demand_bulan).toBe(5) // histori 4 bulan 5 hari → 5 bulan
    expect(Number(p.avg_demand)).toBe(0.8)
    expect(Number(p.safety_stock)).toBe(0.4)
  })

  it('joiner sejak sistem dipakai tetap dihitung walau dikirim > 60 hari setelah join', async () => {
    await cfg('planned_hires_per_month', 0)
    await importRows([row({ nik: 'E1' }), row({ nik: 'E3' })])
    await db.query(`update seragam.import_log set committed_at = (${past(6)})::timestamptz`) // go-live 6 bulan lalu
    await db.query(`update seragam.employee set join_date = (${past(5)})::date where nik = 'E3'`)
    await stock({ 'KMJ-W-L': 20 })
    await out('ISSUE', 'KMJ-W-L', 2, 'E3', past(1)) // terlambat ±4 bulan (stok habis)
    await out('ISSUE', 'KMJ-W-L', 2, 'E1', past(1)) // tunggakan karyawan sebelum go-live
    expect((await plan('KMJ-W-L')).demand_histori).toBe(2)
  })

  it('histori < 3 bulan belum dipakai: tetap memakai rencana hire', async () => {
    await cfg('planned_hires_per_month', 10)
    await importRows([row({ nik: 'E1', join_date: '' , status: 'OFFERING', planned_join_date: '2026-10-20' })])
    await stock({ 'KMJ-W-L': 20 })
    await out('ISSUE', 'KMJ-W-L', 2, 'E1', past(0, 5)) // joiner: rutin, tetapi baru beberapa hari
    const p = await plan('KMJ-W-L')
    expect(p.demand_histori).toBe(2)
    expect(p.histori_cukup).toBe(false)
    expect(p.demand_sumber).toBe('RENCANA_HIRE')
    expect(Number(p.avg_demand)).toBe(Number(p.avg_rencana))
  })

  it('kiriman karena mutasi jabatan dihitung sebagai permintaan rutin', async () => {
    await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [{ jabatan: 'TTK', package_code: 'STD-TTK' }] })
    await importRows([row({ nik: 'E1' })])
    await importRows([row({ nik: 'E1', jabatan: 'TTK' })]) // mutasi Kasir → TTK
    await stock({ 'BLZ-TTK-W-XL': 5 })
    await out('ISSUE', 'BLZ-TTK-W-XL', 1, 'E1', 'seragam.today()')
    expect((await plan('BLZ-TTK-W-XL')).demand_histori).toBe(1)
  })

  it('sebaran ukuran dari data karyawan bila ≥ 20 orang', async () => {
    await cfg('planned_hires_per_month', 10)
    await importRows(Array.from({ length: 20 }, (_, i) => row({ nik: `E${i}`, size_kemeja: i < 15 ? 'L' : 'M' })))
    const l = await plan('KMJ-W-L')
    // qty kemeja wanita per karyawan = 2; sebaran L = 30/40 = 0,75 → 10 × 2 × 0,75
    expect(l.proporsi_sumber).toBe('DATA_KARYAWAN')
    expect(Number(l.avg_rencana)).toBe(15)
    expect(Number((await plan('KMJ-W-M')).avg_rencana)).toBe(5)
    expect(Number((await plan('KMJ-W-S')).avg_rencana)).toBe(0) // tidak ada karyawan ukuran S
    expect((await plan('KMJ-P-L')).proporsi_sumber).toBe('SIZE_CURVE') // belum ada data pria
  })

  it('alert SKU kritis muncul di beranda', async () => {
    await cfg('planned_hires_per_month', 0)
    await importRows([row({ nik: 'E1' })])
    const alerts = await select(db, 'viewer', 'v_alert')
    expect(alerts.find((a: any) => a.kode === 'SKU_KRITIS')?.jumlah).toBe(2) // KMJ-W-L & POLO-U-M
    expect(alerts.find((a: any) => a.kode === 'STOK_KURANG')).toBeUndefined()
  })
})

describe('purchase order', () => {
  async function createPo(lines: unknown[], extra: Record<string, unknown> = {}) {
    const r = await rpc(db, 'admin', 'fn_po_create', { pos: [{ vendor_id: vendor, lines, ...extra }] })
    return r.ids[0] as number
  }

  it('hanya admin yang membuat PO; kode per bulan; validasi baris', async () => {
    await expectError(rpc(db, 'staf', 'fn_po_create', { pos: [{ vendor_id: vendor, lines: [{ sku_code: 'KMJ-W-L', qty: 12 }] }] }), 'AKSES_DITOLAK')
    await expectError(createPo([]), 'VALIDASI')
    await expectError(createPo([{ sku_code: 'KMJ-W-L', qty: 0 }]), 'VALIDASI')
    await expectError(createPo([{ sku_code: 'KMJ-W-L', qty: 1 }, { sku_code: 'kmj-w-l', qty: 2 }]), 'lebih dari sekali')
    await expectError(createPo([{ sku_code: 'XXX', qty: 1 }]), 'tidak dikenal')
    const r = await rpc(db, 'admin', 'fn_po_create', { pos: [
      { vendor_id: vendor, tanggal: '2026-09-10', lines: [{ sku_code: 'KMJ-W-L', qty: 12, saran: 12 }] },
      { vendor_id: vendor, tanggal: '2026-09-11', lines: [{ sku_code: 'POLO-U-M', qty: 5 }] },
    ] })
    expect(r.kode).toEqual(['PO-202609-001', 'PO-202609-002'])
    const p = await po(r.ids[0])
    expect(p.status).toBe('DRAFT')
    expect(Number(p.nilai)).toBe(12 * 95000) // harga default dari price list
    // PO draft tidak dihitung sebagai "dalam pemesanan", tapi ditampilkan
    const pl = await plan('KMJ-W-L')
    expect(pl.on_order).toBe(0)
    expect(pl.qty_po_draft).toBe(12)
  })

  it('kirim → terima sebagian (ledger IN) → lengkap; kelebihan ditolak', async () => {
    const id = await createPo([{ sku_code: 'KMJ-W-L', qty: 12 }, { sku_code: 'POLO-U-M', qty: 6 }])
    await expectError(rpc(db, 'staf', 'fn_po_receive', { id, tanggal: '2026-09-20', lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] }), 'masih draft')
    await expectError(rpc(db, 'staf', 'fn_po_send', { id }), 'AKSES_DITOLAK')
    const s = await rpc(db, 'admin', 'fn_po_send', { id })
    expect(s.eta).toBeTruthy() // otomatis tanggal kirim + lead time
    expect((await po(id)).status).toBe('SENT')
    expect((await plan('KMJ-W-L')).on_order).toBe(12)

    const today = new Date().toISOString().slice(0, 10)
    await expectError(rpc(db, 'viewer', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] }), 'AKSES_DITOLAK')
    await expectError(rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 13 }] }), 'melebihi sisa')
    await expectError(rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 0 }] }), 'KOSONG')
    const r1 = await rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, no_surat_jalan: 'SJ-001', lines: [{ sku_code: 'KMJ-W-L', qty: 8 }, { sku_code: 'POLO-U-M', qty: 6 }] })
    expect(r1).toMatchObject({ pcs: 14, status: 'PARTIAL' })
    let pl = await plan('KMJ-W-L')
    expect(pl.layak).toBe(8)
    expect(pl.on_order).toBe(4)
    const ins = await select(db, 'admin', 'v_ledger', `where tx_type = 'IN' and po_id = $1`, [id])
    expect(ins).toHaveLength(2)
    expect(ins[0].ref_doc).toBe('SJ SJ-001')

    // PO yang sudah ada penerimaan tidak bisa dibatalkan / kembali ke draft
    await expectError(rpc(db, 'admin', 'fn_po_cancel', { id, alasan: 'salah' }), 'Tutup PO')
    await expectError(rpc(db, 'admin', 'fn_po_unsend', { id }), 'STATUS')

    const r2 = await rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 4 }] })
    expect(r2.status).toBe('RECEIVED')
    pl = await plan('KMJ-W-L')
    expect(pl.layak).toBe(12)
    expect(pl.on_order).toBe(0)
    await expectError(rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] }), 'melebihi sisa')
    const rc = await select(db, 'admin', 'v_po_receipt', 'where po_id = $1 order by id', [id])
    expect(rc.map((r: any) => r.pcs)).toEqual([14, 4])
  })

  it('koreksi penerimaan (REVERSAL) mengembalikan sisa pesanan', async () => {
    const id = await createPo([{ sku_code: 'KMJ-W-L', qty: 12 }])
    await rpc(db, 'admin', 'fn_po_send', { id })
    const today = new Date().toISOString().slice(0, 10)
    await rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 12 }] })
    expect((await po(id)).status).toBe('RECEIVED')
    const [ln] = await select(db, 'admin', 'v_ledger', `where tx_type = 'IN' and po_id = $1`, [id])
    await rpc(db, 'admin', 'fn_ledger_reverse', { id: ln.id, alasan: 'salah hitung, seharusnya 10' })
    const p = await po(id)
    expect(p.status).toBe('SENT')
    expect(p.sisa).toBe(12)
    expect((await plan('KMJ-W-L')).on_order).toBe(12)
    await rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 10 }] })
    expect((await po(id)).status).toBe('PARTIAL')
  })

  it('tutup PO sisa; batal & kembali ke draft sebelum ada penerimaan; ubah draft', async () => {
    const id = await createPo([{ sku_code: 'KMJ-W-L', qty: 12 }])
    await rpc(db, 'admin', 'fn_po_update', { id, eta: '2026-12-01', lines: [{ sku_code: 'KMJ-W-L', qty: 24 }, { sku_code: 'KMJ-W-M', qty: 3 }] })
    expect((await po(id)).qty_order).toBe(27)
    await rpc(db, 'admin', 'fn_po_send', { id })
    expect((await po(id)).eta.toISOString().slice(0, 10)).toBe('2026-12-01') // ETA isian tidak ditimpa
    await expectError(rpc(db, 'admin', 'fn_po_update', { id, lines: [{ sku_code: 'KMJ-W-L', qty: 1 }] }), 'STATUS')
    await expectError(rpc(db, 'admin', 'fn_po_close', { id, alasan: 'vendor stop' }), 'Batalkan PO')
    await rpc(db, 'admin', 'fn_po_unsend', { id })
    expect((await po(id)).status).toBe('DRAFT')
    await rpc(db, 'admin', 'fn_po_send', { id })

    const today = new Date().toISOString().slice(0, 10)
    await rpc(db, 'staf', 'fn_po_receive', { id, tanggal: today, lines: [{ sku_code: 'KMJ-W-L', qty: 20 }] })
    await expectError(rpc(db, 'admin', 'fn_po_close', { id, alasan: '' }), 'VALIDASI')
    const c = await rpc(db, 'admin', 'fn_po_close', { id, alasan: 'Vendor tidak sanggup kirim sisa' })
    expect(c.sisa_dilepas).toBe(7)
    const p = await po(id)
    expect(p.status).toBe('RECEIVED')
    expect(p.ditutup_kurang).toBe(true)
    expect((await plan('KMJ-W-M')).on_order).toBe(0)

    const id2 = await createPo([{ sku_code: 'POLO-U-M', qty: 2 }])
    await expectError(rpc(db, 'admin', 'fn_po_cancel', { id: id2, alasan: '' }), 'VALIDASI')
    await rpc(db, 'admin', 'fn_po_cancel', { id: id2, alasan: 'dobel' })
    expect((await po(id2)).status).toBe('CANCELLED')
    expect((await plan('POLO-U-M')).qty_po_draft).toBe(0)
  })

  it('PO lewat ETA ditandai terlambat dan muncul di alert', async () => {
    const id = await createPo([{ sku_code: 'KMJ-W-L', qty: 12 }], { tanggal: '2026-01-05', eta: '2026-02-01' })
    await rpc(db, 'admin', 'fn_po_send', { id, tanggal: '2026-01-06' })
    expect((await po(id)).terlambat).toBe(true)
    const alerts = await select(db, 'admin', 'v_alert')
    expect(alerts.find((a: any) => a.kode === 'PO_TERLAMBAT')?.jumlah).toBe(1)
  })
})

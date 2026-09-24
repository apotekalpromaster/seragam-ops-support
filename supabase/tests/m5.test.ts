import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb, rpc, select, service } from './harness'

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
async function opname(qty: Record<string, number>, tanggal: string) {
  const o = await rpc(db, 'admin', 'fn_opname_create', { tanggal })
  const lines = await select(db, 'admin', 'v_opname_line', 'where opname_id = $1', [o.id])
  await rpc(db, 'admin', 'fn_opname_save_lines', { opname_id: o.id, lines: lines.map((l: any) => ({ sku_code: l.sku_code, qty_fisik: qty[l.sku_code] ?? l.qty_sistem, alasan: 'hitung ulang' })) })
  await rpc(db, 'admin', 'fn_opname_submit', { opname_id: o.id })
  await rpc(db, 'admin', 'fn_opname_approve', { opname_id: o.id })
}
const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10)
async function shipAll(daysAgo = 0) {
  const b = await rpc(db, 'staf', 'fn_batch_create', { jenis: 'ADHOC', cakupan: 'SEMUA' })
  if (daysAgo) await db.query('update seragam.batch set created_at = $1::date where id = $2', [day(daysAgo), b.id])
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'PICKING' })
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'PACKED' })
  await rpc(db, 'staf', 'fn_batch_set_status', { batch_id: b.id, status: 'SHIPPED', tanggal: day(daysAgo) })
  return b.id as number
}
async function expectError(p: Promise<unknown>, kode: string) {
  await expect(p).rejects.toThrow(new RegExp(kode))
}

beforeEach(async () => {
  db = await freshDb()
  hashN = 0
  await rpc(db, 'admin', 'fn_branch_upsert', { rows: [
    { kode_cabang: 'JKT01', nama: 'Alpro Kemang', area: 'Jaksel' }, { kode_cabang: 'JKT02', nama: 'Alpro Tebet', area: 'Jaksel' },
  ] })
  await rpc(db, 'admin', 'fn_mapping_bulk', { rows: [{ jabatan: 'Kasir', package_code: 'STD' }] })
  await opname({ 'KMJ-W-L': 20, 'POLO-U-M': 10 }, '2026-08-01')
}, 60000)

describe('APA / Branch Manager (PRD §3)', () => {
  it('APA terikat cabang: tidak bisa membaca data lain, hanya konfirmasi terima cabangnya dengan BAST', async () => {
    await expectError(rpc(db, 'admin', 'fn_user_upsert', { email: 'apa@alpro.test', nama: 'Yuni', role: 'apa' }), 'Pilih cabang')
    await rpc(db, 'admin', 'fn_user_upsert', { email: 'apa@alpro.test', nama: 'Yuni', role: 'apa', kode_cabang: 'JKT01' })
    expect((await rpc(db, 'apa', 'fn_me')).kode_cabang).toBe('JKT01')

    await importRows([row({ nik: 'E1' }), row({ nik: 'E2', nama: 'Dewi', kode_cabang: 'JKT02' })])
    const batchId = await shipAll(1)

    // Tidak ada akses baca langsung ke view/tabel (NIK seluruh karyawan tidak terlihat)
    expect(await select(db, 'apa', 'v_employee_list')).toHaveLength(0)
    expect(await select(db, 'apa', 'v_batch')).toHaveLength(0)
    await expectError(rpc(db, 'apa', 'fn_import_preview', { file_name: 'x', file_hash: 'x', periode: '2026-09-01', rows: [] }), 'AKSES_DITOLAK')

    const home = await rpc(db, 'apa', 'fn_apa_home')
    expect(home.cabang.kode_cabang).toBe('JKT01')
    expect(home.pengiriman).toHaveLength(1)
    expect(home.pengiriman[0].karyawan.map((k: any) => k.nama)).toEqual(['Siti']) // karyawan JKT02 tidak ikut
    expect(JSON.stringify(home)).not.toContain('E1') // NIK tidak dikirim ke APA

    await expectError(rpc(db, 'apa', 'fn_batch_receive', { batch_id: batchId, kode_cabang: 'JKT02', bast_path: 'x' }), 'AKSES_DITOLAK')
    await expectError(rpc(db, 'apa', 'fn_batch_receive', { batch_id: batchId }), 'BAST')
    const r = await rpc(db, 'apa', 'fn_batch_receive', { batch_id: batchId, bast_path: `batch-${batchId}/JKT01-1.jpg` })
    expect(r.cabang_belum).toBe(1)
    await expectError(rpc(db, 'apa', 'fn_batch_receive', { batch_id: batchId, bast_path: 'y' }), 'sudah dikonfirmasi')
    expect((await rpc(db, 'apa', 'fn_apa_home')).pengiriman[0].received_at).toBeTruthy()
    // Admin tetap bisa melihat tampilan APA cabang mana pun
    expect((await rpc(db, 'admin', 'fn_apa_home', { kode_cabang: 'JKT02' })).pengiriman[0].karyawan[0].nama).toBe('Dewi')
  })
})

describe('batas tukar dari tanggal diterima cabang', () => {
  it('dikirim 20 hari lalu tetapi diterima 3 hari lalu → masih boleh tukar', async () => {
    await importRows([row({ nik: 'E1' })])
    const b = await shipAll(20)
    let chk = await rpc(db, 'staf', 'fn_exchange_check', { nik: 'E1', item_code: 'KMJ' })
    expect(chk).toMatchObject({ ok: false, acuan: 'DIKIRIM', hari: 20 }) // belum dikonfirmasi → pakai tanggal kirim
    await rpc(db, 'staf', 'fn_batch_receive', { batch_id: b, kode_cabang: 'JKT01', tanggal: day(3) })
    chk = await rpc(db, 'staf', 'fn_exchange_check', { nik: 'E1', item_code: 'KMJ' })
    expect(chk).toMatchObject({ ok: true, acuan: 'DITERIMA', hari: 3 })
    const ex = await rpc(db, 'staf', 'fn_exchange_create', { nik: 'E1', item_code: 'KMJ', sku_out: 'KMJ-W-L', qty: 1, alasan: 'CACAT_PRODUKSI', approver: 'Bu Rina' })
    expect((await select(db, 'admin', 'v_exchange', 'where id = $1', [ex.id]))[0].hari_sejak_issue).toBe(3)
  })
})

describe('monitoring', () => {
  it('snapshot KPI harian, KPI bulanan (akurasi stok), dan alert konfirmasi tertunda', async () => {
    await importRows([row({ nik: 'E1' })])
    await shipAll(10)
    await expectError(rpc(db, 'staf', 'fn_kpi_snapshot'), 'AKSES_DITOLAK')
    await service(db, 'fn_kpi_snapshot')
    await opname({ 'POLO-U-M': 8 }, day(0)) // sistem 9 (1 terkirim), fisik 8
    const now = (await select(db, 'viewer', 'v_kpi_monthly', 'order by periode desc limit 1'))[0]
    expect(now).toMatchObject({ karyawan_aktif: 1, aktif_lengkap: 1, opname_selisih: 1 })
    expect(now.opname_stok_sistem).toBeGreaterThan(0)
    expect(now.issue).toBe(3)
    const alerts = await select(db, 'admin', 'v_alert')
    expect(alerts.find((a: any) => a.kode === 'KONFIRMASI_TERTUNDA')?.jumlah).toBe(1)
  })

  it('isi email harian hanya untuk admin / Edge Function; log pengiriman', async () => {
    await expectError(rpc(db, 'staf', 'fn_digest'), 'AKSES_DITOLAK')
    const d = await rpc(db, 'admin', 'fn_digest')
    expect(d.penerima).toBe('operation@apotekalpro.id')
    expect(d.aktif).toBe(true)
    expect(Array.isArray(d.alerts)).toBe(true)
    const ds = await service(db, 'fn_digest')
    expect(ds.kpi).toBeTruthy()
    await expectError(rpc(db, 'staf', 'fn_notification_log', { status: 'TERKIRIM' }), 'AKSES_DITOLAK')
    await service(db, 'fn_notification_log', { pemicu: 'JADWAL', penerima: 'operation@apotekalpro.id', subjek: 'Ringkasan', status: 'TERKIRIM', provider_id: 'abc' })
    const log = await select(db, 'admin', 'v_notification_log')
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ status: 'TERKIRIM', pemicu: 'JADWAL' })
  })
})

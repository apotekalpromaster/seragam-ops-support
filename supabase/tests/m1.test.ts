import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { as, freshDb, rpc, select } from './harness'

let db: PGlite

const cabang = [
  { kode_cabang: 'JKT01', nama: 'Alpro Kemang', area: 'Jakarta Selatan' },
  { kode_cabang: 'JKT02', nama: 'Alpro Tebet', area: 'Jakarta Selatan' },
]
const mapping = [
  { jabatan: 'Kasir', package_code: 'STD' },
  { jabatan: 'TTK', package_code: 'STD-TTK' },
  { jabatan: 'Apoteker', package_code: 'STD-APT' },
]

function row(o: Record<string, unknown>) {
  return {
    nik: 'A001', nama: 'Siti', gender: 'Wanita', jabatan: 'Kasir', kode_cabang: 'JKT01',
    status: 'AKTIF', join_date: '2025-01-10', size_kemeja: 'L', size_polo: 'M', size_blazer: 'XL', ...o,
  }
}

async function importRows(rows: unknown[], hash: string) {
  const prev = await rpc(db, 'admin', 'fn_import_preview', { file_name: `${hash}.xlsx`, file_hash: hash, periode: '2026-09-05', rows })
  const res = await rpc(db, 'admin', 'fn_import_commit', { import_id: prev.id })
  return { prev, res }
}

async function outstanding(nik: string) {
  return select(db, 'admin', 'v_outstanding', 'where nik = $1 order by item_code', [nik])
}

async function expectError(p: Promise<unknown>, kode: string) {
  await expect(p).rejects.toThrow(new RegExp(kode))
}

beforeEach(async () => {
  db = await freshDb()
  await rpc(db, 'admin', 'fn_branch_upsert', { rows: cabang })
  await rpc(db, 'admin', 'fn_mapping_bulk', { rows: mapping })
}, 60000)

describe('seed', () => {
  it('membentuk 54 SKU (PRD menulis 55, tapi polo S–3XL = 6 ukuran)', async () => {
    expect((await select(db, 'admin', 'v_sku')).length).toBe(54)
  })
})

describe('keamanan & integritas', () => {
  it('AC2: ledger tidak bisa diubah/dihapus, bahkan oleh superuser', async () => {
    const o = await rpc(db, 'admin', 'fn_opname_create', {})
    const lines = await select(db, 'admin', 'v_opname_line', 'where opname_id = $1', [o.id])
    await rpc(db, 'admin', 'fn_opname_save_lines', {
      opname_id: o.id,
      lines: lines.map((l: any) => ({ sku_code: l.sku_code, qty_fisik: l.sku_code === 'KMJ-P-L' ? 10 : 0 })),
    })
    await rpc(db, 'admin', 'fn_opname_submit', { opname_id: o.id })
    await rpc(db, 'admin', 'fn_opname_approve', { opname_id: o.id })
    await expectError(db.query('update seragam.ledger set qty = 99'), 'IMMUTABLE')
    await expectError(db.query('delete from seragam.ledger'), 'IMMUTABLE')
    await expectError(
      as(db, 'admin', 'insert into seragam.ledger (tx_type, sku_code, qty, stock_status) values ($1,$2,$3,$4)', ['IN', 'KMJ-P-L', 5, 'LAYAK']),
      'permission denied',
    )
  })

  it('user tanpa registrasi tidak bisa membaca apa pun; viewer/staf tidak bisa ubah master', async () => {
    expect(await select(db, 'asing', 'v_sku')).toHaveLength(0)
    await expectError(rpc(db, 'asing', 'fn_package_create', {}), 'AKSES_DITOLAK')
    await expectError(rpc(db, 'viewer', 'fn_mapping_set', { jabatan: ['Kasir'], package_code: 'GA-B' }), 'AKSES_DITOLAK')
    await expectError(rpc(db, 'staf', 'fn_config_set', { key: 'cutoff_day', value: 6 }), 'AKSES_DITOLAK')
  })

  it('perubahan master tercatat di audit_log', async () => {
    await rpc(db, 'admin', 'fn_config_set', { key: 'cutoff_day', value: 6 })
    const log = await select(db, 'admin', 'v_audit_log', `where entitas = 'config' and entitas_id = 'cutoff_day' and aksi = 'UPDATE'`)
    expect(log).toHaveLength(1)
    expect(log[0].user_nama).toBe('User admin')
    expect(log[0].before.value).toBe(5)
    expect(log[0].after.value).toBe(6)
  })
})

describe('import PPM', () => {
  it('AC14: wanita TTK L/M/XL → KMJ-W-L ×2, POLO-U-M ×1, BLZ-TTK-W-XL ×1', async () => {
    await importRows([row({ nik: 'T001', jabatan: 'TTK' })], 'h1')
    const o = await outstanding('T001')
    expect(o.map((x: any) => [x.sku_target, x.outstanding])).toEqual([
      ['BLZ-TTK-W-XL', 1], ['KMJ-W-L', 2], ['POLO-U-M', 1],
    ])
  })

  it('AC15: polo 4XL ditandai Ukuran Tidak Tersedia, item lain tetap jalan', async () => {
    const { prev } = await importRows([row({ nik: 'P001', size_polo: '4XL' })], 'h2')
    expect(prev.n_warning).toBe(1)
    const st = await select(db, 'admin', 'v_import_staging', 'where import_id = $1', [prev.id])
    expect(st[0].warnings[0].kode).toBe('UKURAN_TIDAK_TERSEDIA')
    const o = await outstanding('P001')
    const polo = o.find((x: any) => x.item_code === 'POLO')
    expect(polo.size_status).toBe('TIDAK_TERSEDIA')
    expect(polo.sku_target).toBeNull()
    expect(o.find((x: any) => x.item_code === 'KMJ').sku_target).toBe('KMJ-W-L')
    const alert = await select(db, 'admin', 'v_alert', `where kode = 'UKURAN_TIDAK_TERSEDIA'`)
    expect(alert[0].jumlah).toBe(1)
  })

  it('AC9: file yang sama tidak bisa di-commit dua kali; data tidak dobel', async () => {
    await importRows([row({})], 'same')
    await expectError(
      rpc(db, 'admin', 'fn_import_preview', { file_name: 'x', file_hash: 'same', periode: '2026-09-05', rows: [row({})] }),
      'IMPORT_DUPLIKAT',
    )
    // file berbeda dengan isi sama → TIDAK_BERUBAH, tidak ada diff
    const { prev } = await importRows([row({})], 'same-content-new-hash')
    const st = await select(db, 'admin', 'v_import_staging', 'where import_id = $1', [prev.id])
    expect(st[0].diff_types).toEqual(['TIDAK_BERUBAH'])
    expect((await select(db, 'admin', 'employee')).length).toBe(1)
    expect((await select(db, 'admin', 'import_diff', 'where import_id = $1', [prev.id])).length).toBe(0)
  })

  it('validasi: NIK duplikat, cabang tak dikenal, gender kosong → baris dilewati', async () => {
    const { prev, res } = await importRows([
      row({ nik: 'D1' }), row({ nik: 'D1', nama: 'Dobel' }),
      row({ nik: 'C1', kode_cabang: 'XXX' }), row({ nik: 'G1', gender: '' }), row({ nik: 'OK1' }),
    ], 'h3')
    expect(prev.n_error).toBe(4)
    expect(res.baris_diproses).toBe(1)
    const st = await select(db, 'admin', 'import_staging', 'where import_id = $1 order by row_no', [prev.id])
    expect(st[0].errors[0].message).toMatch(/lebih dari sekali/)
    expect(st[2].errors[0].message).toMatch(/belum terdaftar/)
    expect(st[3].errors[0].message).toMatch(/Gender kosong/)
  })

  it('gender L/P: bila file memakai L, maka P = Perempuan', async () => {
    await importRows([row({ nik: 'L1', gender: 'L' }), row({ nik: 'P1', gender: 'P' })], 'lp')
    const e = await select(db, 'admin', 'employee', 'order by nik')
    expect(e.map((x: any) => [x.nik, x.gender])).toEqual([['L1', 'P'], ['P1', 'W']])
  })

  it('jabatan belum dimapping → peringatan, tidak masuk antrian sampai dimapping', async () => {
    await importRows([row({ nik: 'U1', jabatan: 'Driver' })], 'h4')
    expect(await outstanding('U1')).toHaveLength(0)
    expect((await select(db, 'admin', 'v_unmapped_position'))[0].jabatan).toBe('Driver')
    await rpc(db, 'admin', 'fn_mapping_set', { jabatan: ['Driver'], package_code: 'GA-B' })
    const o = await outstanding('U1')
    expect(o.map((x: any) => [x.sku_target, x.outstanding])).toEqual([['POLO-U-M', 2]])
  })

  it('diff: joined, mutasi, pindah cabang, ubah ukuran, resign, rencana resign', async () => {
    await importRows([
      row({ nik: 'J1', status: 'OFFERING', join_date: '', planned_join_date: '2026-10-10' }),
      row({ nik: 'M1', jabatan: 'TTK' }),
      row({ nik: 'R1' }), row({ nik: 'N1' }),
    ], 'd1')
    const { prev } = await importRows([
      row({ nik: 'J1', status: 'AKTIF', join_date: '', planned_join_date: '2026-10-10' }),
      row({ nik: 'M1', jabatan: 'Apoteker', kode_cabang: 'JKT02', size_kemeja: 'XL' }),
      row({ nik: 'R1', status: 'RESIGN', resign_date: '2026-09-01' }),
      row({ nik: 'N1', planned_resign_date: '2026-10-31' }),
    ], 'd2')
    const diffs = await select(db, 'admin', 'import_diff', 'where import_id = $1 order by nik, change_type', [prev.id])
    expect(diffs.map((d: any) => `${d.nik}:${d.change_type}`)).toEqual([
      'J1:JOINED', 'M1:MUTASI_JABATAN', 'M1:PINDAH_CABANG', 'M1:UBAH_UKURAN', 'N1:RENCANA_RESIGN', 'R1:RESIGN',
    ])
    const j1 = (await select(db, 'admin', 'employee', `where nik = 'J1'`))[0]
    expect(j1.join_date.toISOString().slice(0, 10)).toBe('2026-10-10')
    const log = (await select(db, 'admin', 'import_log', 'where id = $1', [prev.id]))[0]
    expect(log.n_resign).toBe(1)
    expect(log.n_mutasi).toBe(1)
  })

  it('AC1 (bagian M1): promosi TTK → Apoteker memunculkan antrian Blazer Apoteker', async () => {
    await importRows([row({ nik: 'M1', jabatan: 'TTK' })], 'p1')
    // hak lama sudah diterima (riwayat migrasi)
    await rpc(db, 'admin', 'fn_issue_history_import', { rows: [
      { nik: 'M1', item_code: 'KMJ', size: 'L', qty: 2, tanggal: '2025-02-01' },
      { nik: 'M1', item_code: 'POLO', size: 'M', qty: 1, tanggal: '2025-02-01' },
      { nik: 'M1', item_code: 'BLZ-TTK', size: 'XL', qty: 1, tanggal: '2025-02-01' },
    ] })
    expect(await outstanding('M1')).toHaveLength(0)
    await importRows([row({ nik: 'M1', jabatan: 'Apoteker' })], 'p2')
    const o = await outstanding('M1')
    expect(o.map((x: any) => [x.sku_target, x.outstanding])).toEqual([['BLZ-APT-W-XL', 1]])
    const over = await select(db, 'admin', 'v_employee_item', `where nik = 'M1' and over_issued > 0`)
    expect(over.map((x: any) => x.item_code)).toEqual(['BLZ-TTK']) // calon daftar retur (M4)
  })

  it('import hanya untuk admin', async () => {
    await expectError(rpc(db, 'staf', 'fn_import_preview', { file_hash: 'z', rows: [row({})] }), 'AKSES_DITOLAK')
  })
})

describe('paket', () => {
  it('AC16: paket baru GA-C dipetakan ke jabatan → antrian berubah', async () => {
    await importRows([row({ nik: 'G1', jabatan: 'Staf GA' })], 'g1')
    await rpc(db, 'admin', 'fn_package_create', { package_code: 'GA-C', nama: 'GA C', items: { KMJ: 1, POLO: 1 } })
    const prev = await rpc(db, 'admin', 'fn_mapping_preview', { jabatan: ['Staf GA'], package_code: 'GA-C' })
    expect(prev.karyawan_terdampak).toBe(1)
    expect(prev.total_tambahan_pcs).toBe(2)
    await rpc(db, 'admin', 'fn_mapping_set', { jabatan: ['Staf GA'], package_code: 'GA-C' })
    const o = await outstanding('G1')
    expect(o.map((x: any) => [x.sku_target, x.outstanding])).toEqual([['KMJ-W-L', 1], ['POLO-U-M', 1]])
  })

  it('AC17: STD kemeja 2→3 "hanya karyawan baru" tidak menambah outstanding karyawan lama', async () => {
    await importRows([
      row({ nik: 'OLD' }),
      row({ nik: 'NEW', status: 'OFFERING', join_date: '', planned_join_date: '2026-11-10' }),
    ], 'v1')
    await rpc(db, 'admin', 'fn_issue_history_import', { rows: [
      { nik: 'OLD', item_code: 'KMJ', size: 'L', qty: 2, tanggal: '2025-02-01' },
      { nik: 'OLD', item_code: 'POLO', size: 'M', qty: 1, tanggal: '2025-02-01' },
    ] })
    const pv = await rpc(db, 'admin', 'fn_package_preview', { package_code: 'STD', items: { KMJ: 3, POLO: 1 }, scope: 'KARYAWAN_BARU', effective_date: '2026-11-01' })
    expect(pv.karyawan_terdampak).toBe(1)
    await rpc(db, 'admin', 'fn_package_new_version', { package_code: 'STD', items: { KMJ: 3, POLO: 1 }, scope: 'KARYAWAN_BARU', effective_date: '2026-11-01' })
    expect(await outstanding('OLD')).toHaveLength(0)
    const n = await outstanding('NEW')
    expect(n.find((x: any) => x.item_code === 'KMJ').outstanding).toBe(3)
    const pvAll = await rpc(db, 'admin', 'fn_package_preview', { package_code: 'STD', items: { KMJ: 1, POLO: 1 }, scope: 'SEMUA_AKTIF' })
    expect(pvAll.karyawan_over_issued).toBe(1) // OLD sudah terima 2 kemeja
    await expectError(
      rpc(db, 'admin', 'fn_package_new_version', { package_code: 'STD', items: { KMJ: 3, POLO: 1, 'BLZ-TTK': 0 }, scope: 'SEMUA_AKTIF' }),
      'TIDAK_BERUBAH',
    )
  })

  it('AC18: paket yang dipakai tidak bisa dihapus/nonaktif; paket baru belum dipakai boleh dihapus', async () => {
    await expectError(rpc(db, 'admin', 'fn_package_delete', { package_code: 'STD' }), 'PAKET_DIPAKAI')
    await expectError(rpc(db, 'admin', 'fn_package_set_active', { package_code: 'STD', active: false }), 'PAKET_DIPAKAI')
    await rpc(db, 'admin', 'fn_package_create', { package_code: 'TMP', nama: 'Temp', items: { POLO: 1 } })
    await rpc(db, 'admin', 'fn_package_delete', { package_code: 'TMP' })
    expect(await select(db, 'admin', 'package', `where package_code = 'TMP'`)).toHaveLength(0)
  })

  it('AC19: item baru (rompi) otomatis punya SKU dan bisa masuk paket', async () => {
    const r = await rpc(db, 'admin', 'fn_item_save', { is_new: true, item_code: 'RMP', nama: 'Rompi', gender_specific: false, size_group: 'KEMEJA', sizes: ['M', 'L', 'XL'] })
    expect(r.sku_aktif_baru).toBe(3)
    await importRows([row({ nik: 'R1' })], 'r1')
    await rpc(db, 'admin', 'fn_package_new_version', { package_code: 'STD', items: { KMJ: 2, POLO: 1, RMP: 1 }, scope: 'SEMUA_AKTIF' })
    const o = await outstanding('R1')
    expect(o.find((x: any) => x.item_code === 'RMP').sku_target).toBe('RMP-U-L')
  })

  it('override per karyawan mengalahkan mapping jabatan dan wajib alasan', async () => {
    await importRows([row({ nik: 'O1' })], 'o1')
    await expectError(rpc(db, 'admin', 'fn_override_set', { nik: 'O1', package_code: 'GA-B', alasan: '' }), 'VALIDASI')
    await rpc(db, 'admin', 'fn_override_set', { nik: 'O1', package_code: 'GA-B', alasan: 'Tugas lapangan khusus' })
    const o = await outstanding('O1')
    expect(o.map((x: any) => x.item_code)).toEqual(['POLO'])
  })
})

describe('stok & opname', () => {
  async function opname(lines: Record<string, number>, alasan?: string) {
    const c = await rpc(db, 'staf', 'fn_opname_create', { tanggal: '2026-09-20' })
    const all = await select(db, 'admin', 'v_opname_line', 'where opname_id = $1', [c.id])
    await rpc(db, 'staf', 'fn_opname_save_lines', {
      opname_id: c.id,
      lines: all.map((l: any) => ({
        sku_code: l.sku_code, stock_status: l.stock_status,
        qty_fisik: lines[l.sku_code] ?? l.qty_sistem,
        alasan: lines[l.sku_code] !== undefined ? alasan : undefined,
      })),
    })
    return c
  }

  it('opname pertama = OPENING; opname berikut = ADJ dengan alasan & approval admin', async () => {
    const c1 = await opname({ 'KMJ-P-L': 10, 'POLO-U-M': 4 })
    expect(c1.is_opening).toBe(true)
    await rpc(db, 'staf', 'fn_opname_submit', { opname_id: c1.id })
    await expectError(rpc(db, 'staf', 'fn_opname_approve', { opname_id: c1.id }), 'AKSES_DITOLAK')
    await rpc(db, 'admin', 'fn_opname_approve', { opname_id: c1.id })
    let s = await select(db, 'admin', 'v_stock_sku', `where sku_code in ('KMJ-P-L','POLO-U-M') order by sku_code`)
    expect(s.map((x: any) => x.available)).toEqual([10, 4])

    const c2 = await opname({ 'KMJ-P-L': 8 })
    expect(c2.is_opening).toBe(false)
    await expectError(rpc(db, 'staf', 'fn_opname_submit', { opname_id: c2.id }), 'tanpa alasan')
    await rpc(db, 'staf', 'fn_opname_cancel', { opname_id: c2.id })
    const c3 = await opname({ 'KMJ-P-L': 8 }, 'Hilang saat pindah gudang')
    await rpc(db, 'staf', 'fn_opname_submit', { opname_id: c3.id })
    await rpc(db, 'admin', 'fn_opname_approve', { opname_id: c3.id })
    s = await select(db, 'admin', 'v_stock_sku', `where sku_code = 'KMJ-P-L'`)
    expect(s[0].layak).toBe(8)
    const adj = await select(db, 'admin', 'ledger', `where tx_type = 'ADJ'`)
    expect(adj.map((x: any) => x.qty)).toEqual([-2])
  })

  it('reversal membalik transaksi dan tidak bisa dua kali', async () => {
    const c = await opname({ 'KMJ-P-L': 5 })
    await rpc(db, 'staf', 'fn_opname_submit', { opname_id: c.id })
    await rpc(db, 'admin', 'fn_opname_approve', { opname_id: c.id })
    const l = (await select(db, 'admin', 'ledger', `where tx_type = 'OPENING'`))[0]
    await rpc(db, 'admin', 'fn_ledger_reverse', { id: l.id, alasan: 'Salah input saldo awal' })
    expect((await select(db, 'admin', 'v_stock_sku', `where sku_code = 'KMJ-P-L'`))[0].layak).toBe(0)
    await expectError(rpc(db, 'admin', 'fn_ledger_reverse', { id: l.id, alasan: 'dua kali' }), 'sudah pernah dikoreksi')
  })

  it('ISSUE historis mengurangi outstanding tanpa mengurangi stok; ada error → tidak ada yang tersimpan', async () => {
    await importRows([row({ nik: 'H1' })], 'hh')
    const bad = await rpc(db, 'admin', 'fn_issue_history_import', { rows: [
      { nik: 'H1', item_code: 'KMJ', size: 'L', qty: 2, tanggal: '2025-01-01' },
      { nik: 'H1', item_code: 'POLO', size: '4XL', qty: 1, tanggal: '2025-01-01' },
    ] })
    expect(bad.ok).toBe(false)
    expect(bad.errors[0].baris).toBe(2)
    expect(await select(db, 'admin', 'ledger')).toHaveLength(0)
    await rpc(db, 'admin', 'fn_issue_history_import', { rows: [{ nik: 'H1', item_code: 'KMJ', size: 'L', qty: 2, tanggal: '2025-01-01' }] })
    expect((await outstanding('H1')).map((x: any) => x.item_code)).toEqual(['POLO'])
    expect((await select(db, 'admin', 'v_stock_sku', `where sku_code = 'KMJ-W-L'`))[0].layak).toBe(0)
  })
})

describe('overview', () => {
  it('alert & KPI terbentuk', async () => {
    await importRows([row({ nik: 'K1', size_polo: '' }), row({ nik: 'K2', jabatan: 'Driver' })], 'ov')
    const alert = await select(db, 'admin', 'v_alert', 'order by urutan')
    const kode = alert.map((a: any) => a.kode)
    expect(kode).toContain('JABATAN_BELUM_DIMAPPING')
    expect(kode).toContain('UKURAN_KOSONG')
    expect(kode).toContain('STOK_KURANG')
    expect(kode).toContain('STOK_AWAL_BELUM')
    const kpi = (await select(db, 'admin', 'v_kpi_current'))[0]
    expect(kpi.karyawan_aktif).toBe(2)
    expect(kpi.sku_aktif).toBe(54)
    expect(await select(db, 'admin', 'v_kpi_import_monthly')).toHaveLength(6)
  })
})

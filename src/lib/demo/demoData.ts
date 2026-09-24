import type { PGliteInterface } from '@electric-sql/pglite'

/**
 * Data contoh untuk mode demo: cabang, vendor & harga, mapping jabatan,
 * dua snapshot PPM (Agustus & September), riwayat distribusi, dan stok awal.
 * Deterministik (PRNG ber-seed) supaya tampilan demo konsisten.
 */
type Call = (fn: string, p: unknown) => Promise<any>

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const AREAS: [string, string[]][] = [
  ['Jakarta Selatan', ['Kemang', 'Tebet', 'Pasar Minggu', 'Cilandak']],
  ['Jakarta Barat', ['Kebon Jeruk', 'Grogol', 'Cengkareng']],
  ['Tangerang', ['BSD', 'Karawaci', 'Ciledug']],
  ['Bekasi', ['Summarecon', 'Jatiasih', 'Cikarang']],
  ['Depok', ['Margonda', 'Cinere']],
  ['Bandung', ['Dago', 'Buah Batu', 'Antapani']],
  ['Surabaya', ['Darmo', 'Rungkut', 'Kenjeran']],
]

const DEPAN_P = ['Andi', 'Budi', 'Rizky', 'Agus', 'Fajar', 'Dimas', 'Yoga', 'Hendra', 'Arief', 'Bayu', 'Eko', 'Galih', 'Ilham', 'Joko', 'Reza']
const DEPAN_W = ['Siti', 'Dewi', 'Rina', 'Ayu', 'Putri', 'Nadia', 'Maya', 'Lestari', 'Fitri', 'Wulan', 'Indah', 'Sari', 'Tika', 'Yuni', 'Anisa']
const BELAKANG = ['Pratama', 'Saputra', 'Wijaya', 'Hidayat', 'Santoso', 'Kusuma', 'Nugroho', 'Lestari', 'Rahmawati', 'Permata', 'Setiawan', 'Ramadhan', 'Utami', 'Siregar', 'Nasution']

export async function loadDemoData(db: PGliteInterface, call: Call, onProgress?: (m: string) => void) {
  const rnd = prng(20260924)
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]

  // Cabang
  const branches: { kode_cabang: string; nama: string; area: string; alamat: string }[] = []
  let n = 1
  for (const [area, list] of AREAS) {
    for (const nm of list) {
      branches.push({ kode_cabang: `ALP-${String(n).padStart(3, '0')}`, nama: `Alpro ${nm}`, area, alamat: `Jl. Raya ${nm} No. ${10 + n}` })
      n++
    }
  }
  await call('fn_branch_upsert', { rows: branches })

  // Vendor, harga, MOQ
  const price: Record<string, number> = { KMJ: 95000, POLO: 65000, 'BLZ-TTK': 185000, 'BLZ-APT': 210000 }
  const skus = (await db.query<{ sku_code: string; item_code: string }>('select sku_code, item_code from seragam.sku')).rows
  await call('fn_sku_bulk_update', {
    rows: skus.map((s) => ({
      sku_code: s.sku_code, price: price[s.item_code], valid_from: '2026-01-01',
      vendor: s.item_code === 'POLO' ? 'CV Polo Nusantara' : 'PT Konveksi Sinar Jaya',
      lead_time_days: s.item_code.startsWith('BLZ') ? 45 : 30,
      moq: s.item_code.startsWith('BLZ') ? 6 : 12,
    })),
  })

  // Mapping jabatan ("Admin Gudang" sengaja belum dimapping)
  await call('fn_mapping_bulk', { rows: [
    { jabatan: 'Kasir', package_code: 'STD' },
    { jabatan: 'Branch Manager', package_code: 'STD' },
    { jabatan: 'Supervisor Area', package_code: 'STD' },
    { jabatan: 'TTK', package_code: 'STD-TTK' },
    { jabatan: 'Apoteker', package_code: 'STD-APT' },
    { jabatan: 'Staf GA', package_code: 'GA-A' },
    { jabatan: 'Driver', package_code: 'GA-B' },
  ] })

  // Karyawan
  onProgress?.('Membuat snapshot PPM contoh…')
  const jabatan = ['Kasir', 'Kasir', 'Kasir', 'TTK', 'TTK', 'TTK', 'Apoteker', 'Apoteker', 'Branch Manager', 'Staf GA', 'Driver']
  const sizesP = ['M', 'L', 'L', 'XL', 'XL', 'XXL', '3XL']
  const sizesW = ['S', 'M', 'M', 'L', 'L', 'XL', 'XXL']
  type Row = Record<string, string>
  const aug: Row[] = []
  for (let i = 1; i <= 132; i++) {
    const w = rnd() < 0.62
    const sz = w ? sizesW : sizesP
    const joinY = 2023 + Math.floor(rnd() * 3)
    aug.push({
      nik: `2${String(joinY).slice(2)}${String(i).padStart(4, '0')}`,
      nama: `${pick(w ? DEPAN_W : DEPAN_P)} ${pick(BELAKANG)}`,
      gender: w ? 'Wanita' : 'Pria',
      jabatan: i === 131 ? 'Admin Gudang' : pick(jabatan),
      kode_cabang: pick(branches).kode_cabang,
      status_karyawan: rnd() < 0.7 ? 'TETAP' : 'KONTRAK',
      status: 'AKTIF',
      join_date: `${joinY}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
      size_kemeja: pick(sz), size_polo: pick(sz.slice(0, 6)), size_blazer: pick(sz),
    })
  }
  aug.push({
    nik: '2250201', nama: 'Rudi Hartono', gender: 'Pria', jabatan: 'Kasir', kode_cabang: branches[2].kode_cabang,
    status_karyawan: 'PKL', status: 'AKTIF', join_date: '2026-07-01', size_kemeja: 'L', size_polo: 'L', size_blazer: '',
  })
  const p1 = await call('fn_import_preview', { file_name: 'snapshot_ppm_2026-08-05.xlsx', file_hash: 'demo-aug', periode: '2026-08-05', rows: aug })
  await call('fn_import_commit', { import_id: p1.id })
  await db.query(`update seragam.import_log set created_at = '2026-08-05 09:12+07', committed_at = '2026-08-05 09:20+07' where id = $1`, [p1.id])

  // Riwayat distribusi lama: sebagian besar karyawan lama sudah menerima paket lengkap.
  onProgress?.('Mengisi riwayat distribusi…')
  const ent = (await db.query<{ nik: string; item_code: string; size_code: string; qty: number }>(
    `select nik, item_code, size_code, qty from seragam.v_entitlement where size_status = 'OK'`)).rows
  const skipNik = new Set(aug.filter(() => rnd() < 0.12).map((r) => r.nik))
  const hist = ent.filter((e) => !skipNik.has(e.nik)).map((e) => ({
    nik: e.nik, item_code: e.item_code, size: e.size_code, qty: e.qty, tanggal: '2025-06-15',
  }))
  await call('fn_issue_history_import', { rows: hist })

  // Snapshot September: joiner baru (OFFERING), resign, promosi, pindah cabang
  const sep: Row[] = aug.map((r) => ({ ...r }))
  sep[3].status = 'RESIGN'; (sep[3] as Row).resign_date = '2026-08-28'
  sep[17].status = 'RESIGN'; (sep[17] as Row).resign_date = '2026-09-02'
  sep[25].planned_resign_date = '2026-10-15'
  const promo = sep.findIndex((r) => r.jabatan === 'TTK')
  sep[promo].jabatan = 'Apoteker'
  sep[40].kode_cabang = branches[5].kode_cabang
  const joiners: Row[] = [
    { nama: 'Salsa Amelia', gender: 'Wanita', jabatan: 'Kasir', size_kemeja: 'M', size_polo: 'M', planned: '2026-10-01' },
    { nama: 'Kevin Prasetyo', gender: 'Pria', jabatan: 'TTK', size_kemeja: 'L', size_polo: 'L', size_blazer: 'L', planned: '2026-10-06' },
    { nama: 'Nurul Aini', gender: 'Wanita', jabatan: 'TTK', size_kemeja: 'L', size_polo: '4XL', size_blazer: 'XL', planned: '2026-10-13' },
    { nama: 'Dian Puspita', gender: 'Wanita', jabatan: 'Apoteker', size_kemeja: '', size_polo: '', size_blazer: '', planned: '2026-10-20' },
    { nama: 'Aditya Firmansyah', gender: 'Pria', jabatan: 'Kasir', size_kemeja: 'XL', size_polo: 'XL', planned: '2026-09-29' },
    { nama: 'Melati Sukma', gender: 'Wanita', jabatan: 'Kasir', size_kemeja: 'S', size_polo: 'S', planned: '2026-11-03' },
  ].map((j, i) => ({
    nik: `2260${String(900 + i)}`, nama: j.nama, gender: j.gender, jabatan: j.jabatan,
    kode_cabang: branches[(i * 3) % branches.length].kode_cabang, status_karyawan: 'PROBATION', status: 'OFFERING',
    planned_join_date: j.planned, size_kemeja: j.size_kemeja, size_polo: j.size_polo, size_blazer: j.size_blazer ?? '',
  }))
  const p2 = await call('fn_import_preview', { file_name: 'snapshot_ppm_2026-09-05.xlsx', file_hash: 'demo-sep', periode: '2026-09-05', rows: [...sep, ...joiners] })
  await call('fn_import_commit', { import_id: p2.id })
  await db.query(`update seragam.import_log set created_at = '2026-09-05 08:40+07', committed_at = '2026-09-05 08:55+07' where id = $1`, [p2.id])

  // Stok awal dari opname pertama
  onProgress?.('Membentuk stok awal…')
  const op = await call('fn_opname_create', { tanggal: '2026-08-01', catatan: 'Opname awal gudang Ops Support HQ' })
  const lines = (await db.query<{ sku_code: string; size_order: number; item_code: string }>(
    `select l.sku_code, s.size_order, s.item_code from seragam.v_opname_line l join seragam.v_sku s using (sku_code) where opname_id = $1`, [op.id])).rows
  await call('fn_opname_save_lines', {
    opname_id: op.id,
    lines: lines.map((l) => {
      const base = l.item_code === 'POLO' || l.item_code === 'KMJ' ? 14 : 4
      const curve = [0.4, 1, 1.2, 0.9, 0.6, 0.3, 0.1, 0.05][l.size_order - 1] ?? 0.1
      const q = Math.max(0, Math.round(base * curve + (rnd() - 0.5) * 4))
      return { sku_code: l.sku_code, qty_fisik: l.sku_code === 'KMJ-W-M' ? 1 : q }
    }),
  })
  await call('fn_opname_submit', { opname_id: op.id })
  await call('fn_opname_approve', { opname_id: op.id })

  // Satu contoh riwayat perubahan paket
  await call('fn_package_new_version', {
    package_code: 'GA-A', items: { KMJ: 1, POLO: 3 }, scope: 'KARYAWAN_BARU', effective_date: '2026-09-01',
    catatan: 'Contoh: polo GA-A jadi 3 untuk joiner mulai 1 Sep 2026',
  })
}

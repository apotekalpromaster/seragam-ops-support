import type { PGliteInterface } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { buildSelectSql, type Db, type SelectOpts } from '../db'
import stubSql from './stub-supabase.sql?raw'
import seedSql from '../../../supabase/seed.sql?raw'
import { loadDemoData } from './demoData'

/**
 * Mode demo: Postgres (PGlite/WASM) berjalan di browser dengan migration yang
 * SAMA PERSIS dengan Supabase, termasuk RLS dan RPC. Data tersimpan di
 * IndexedDB browser ini saja.
 */
const migrations = import.meta.glob('../../../supabase/migrations/*.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

export const DEMO_USERS = [
  { id: '00000000-0000-0000-0000-00000000000a', email: 'rina@alpro.demo', nama: 'Rina Kusuma', role: 'admin', jabatan: 'Admin Ops Support' },
  { id: '00000000-0000-0000-0000-00000000000b', email: 'budi@alpro.demo', nama: 'Budi Santoso', role: 'staf', jabatan: 'Staf Ops Support' },
  { id: '00000000-0000-0000-0000-00000000000c', email: 'dewi@alpro.demo', nama: 'Dewi Lestari', role: 'viewer', jabatan: 'Finance (Viewer)' },
] as const

// Versi berubah bila isi migration, seed, atau data contoh berubah → database demo dibuat ulang.
function schemaVersion() {
  const all = Object.keys(migrations).sort().map((k) => migrations[k]).join('\n') + seedSql + loadDemoData.toString()
  let h = 0
  for (let i = 0; i < all.length; i++) h = (Math.imul(31, h) + all.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const pgDate = (v: string) => v
const pgTs = (v: string) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString()
// Samakan bentuk data dengan respons Supabase: tanggal sebagai string, numeric/bigint sebagai number.
const PARSERS = { 1082: pgDate, 1114: pgTs, 1184: pgTs, 1700: Number, 20: Number }

let current: { db: PGliteInterface; version: string } | null = null
let userId: string | null = null

export function setDemoUser(id: string | null) {
  userId = id
}

let opening: Promise<PGliteInterface> | null = null

// Satu promise bersama: React StrictMode (dev) memanggil efek dua kali; tanpa ini migration
// bisa berjalan ganda pada database yang sama.
function open(onProgress?: (msg: string) => void): Promise<PGliteInterface> {
  const version = schemaVersion()
  if (current?.version === version) return Promise.resolve(current.db)
  opening ??= init(version, onProgress).finally(() => { opening = null })
  return opening
}

async function init(version: string, onProgress?: (msg: string) => void): Promise<PGliteInterface> {
  const dataDir = `idb://seragam-demo-${version}`
  const db = await PGliteWorker.create(
    new Worker(new URL('./pglite.worker.ts', import.meta.url), { type: 'module' }),
    { dataDir },
  )
  const st = (await db.query<{ ready: boolean; partial: boolean }>(
    `select to_regclass('demo_store.ready') is not null as ready, to_regnamespace('seragam') is not null as partial`)).rows[0]
  if (!st.ready) {
    if (st.partial) {
      // Inisialisasi sebelumnya terputus: buang dan mulai ulang dari kosong.
      onProgress?.('Memperbaiki database demo…')
      await db.exec('drop schema if exists seragam cascade; drop schema if exists auth cascade; drop schema if exists demo_store cascade;')
    }
    onProgress?.('Membuat struktur database…')
    await db.exec(stubSql)
    for (const k of Object.keys(migrations).sort()) await db.exec(migrations[k])
    await db.exec(seedSql)
    for (const u of DEMO_USERS) {
      await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email])
      await db.query('insert into seragam.app_user (user_id, email, nama, role) values ($1, $2, $3, $4)', [u.id, u.email, u.nama, u.role])
    }
    onProgress?.('Mengisi data contoh…')
    await loadDemoData(db, (fn, p) => call(db, DEMO_USERS[0].id, fn, p), onProgress)
    await db.exec('create table demo_store.ready (at timestamptz default now())')
  }
  current = { db, version }
  return db
}

async function call<T>(db: PGliteInterface, uid: string, fn: string, p: unknown): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    await tx.exec('set local role authenticated')
    const res = await tx.query<{ r: T }>(`select seragam.${fn}($1::jsonb) as r`, [JSON.stringify(p ?? {})], { parsers: PARSERS })
    return res.rows[0].r
  })
}

export async function createDemoDb(onProgress?: (msg: string) => void): Promise<Db> {
  const db = await open(onProgress)
  return {
    mode: 'demo',
    async select<T>(view: string, opts?: SelectOpts) {
      const { sql, params } = buildSelectSql(view, opts)
      return db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
        await tx.exec('set local role authenticated')
        return (await tx.query<T>(sql, params, { parsers: PARSERS })).rows
      })
    },
    async rpc<T>(fn: string, p?: unknown) {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error('Nama fungsi tidak valid')
      return call<T>(db, userId ?? '', fn, p)
    },
    async uploadFile(bucket, path, file) {
      const data = new Uint8Array(await file.arrayBuffer())
      await db.query('insert into demo_store.files (path, mime, data) values ($1, $2, $3)', [`${bucket}/${path}`, file.type, data])
    },
    async fileUrl(bucket, path) {
      const r = await db.query<{ mime: string; data: Uint8Array }>('select mime, data from demo_store.files where path = $1', [`${bucket}/${path}`])
      if (!r.rows[0]) throw new Error('TIDAK_DITEMUKAN: File tidak ditemukan.')
      return URL.createObjectURL(new Blob([r.rows[0].data as BlobPart], { type: r.rows[0].mime }))
    },
    async invoke() {
      throw new Error('DEMO: Pengiriman email tidak tersedia di mode demo. Di Supabase, tombol ini mengirim email tes lewat Gmail.')
    },
  }
}

/** Hapus database demo dan mulai dari data contoh awal. */
export async function resetDemo() {
  if (current) await current.db.close()
  current = null
  const dbs = (await indexedDB.databases?.()) ?? []
  await Promise.all(
    dbs.filter((d) => d.name?.includes('seragam-demo')).map(
      (d) => new Promise((res) => { const r = indexedDB.deleteDatabase(d.name!); r.onsuccess = r.onerror = r.onblocked = res }),
    ),
  )
}

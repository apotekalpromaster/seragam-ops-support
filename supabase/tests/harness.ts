import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')

export const USERS = {
  admin: '00000000-0000-0000-0000-00000000000a',
  staf: '00000000-0000-0000-0000-00000000000b',
  viewer: '00000000-0000-0000-0000-00000000000c',
  asing: '00000000-0000-0000-0000-00000000000d', // login tapi tidak terdaftar di app_user
  apa: '00000000-0000-0000-0000-00000000000e', // didaftarkan per test (butuh cabang) lewat fn_user_upsert
} as const
export type Who = keyof typeof USERS

/** Database baru berisi stub Supabase + semua migration + seed + 3 user. */
export async function freshDb() {
  const db = new PGlite()
  await db.exec(readFileSync(join(root, 'src/lib/demo/stub-supabase.sql'), 'utf8'))
  const dir = join(root, 'supabase/migrations')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, f), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${f} gagal: ${(e as Error).message}`)
    }
  }
  await db.exec(readFileSync(join(root, 'supabase/seed.sql'), 'utf8'))
  for (const [role, id] of Object.entries(USERS)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${role}@alpro.test`])
    if (role !== 'asing' && role !== 'apa') {
      await db.query(
        'insert into seragam.app_user (user_id, email, nama, role) values ($1, $2, $3, $4)',
        [id, `${role}@alpro.test`, `User ${role}`, role],
      )
    }
  }
  return db
}

/** Jalankan query sebagai user tertentu (role authenticated + RLS aktif). */
export async function as<T = Record<string, unknown>>(db: PGlite, who: Who, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USERS[who]])
    await tx.exec('set local role authenticated')
    const res = await tx.query<T>(sql, params)
    return res.rows
  })
}

/** Panggil RPC seragam.fn_x(p jsonb) sebagai user. */
export async function rpc<T = any>(db: PGlite, who: Who, fn: string, p: unknown = {}) {
  const rows = await as<{ r: T }>(db, who, `select seragam.${fn}($1::jsonb) as r`, [JSON.stringify(p)])
  return rows[0].r
}

export async function select<T = any>(db: PGlite, who: Who, view: string, where = '', params: unknown[] = []) {
  return as<T>(db, who, `select * from seragam.${view} ${where}`, params)
}

/** Panggil RPC sebagai Edge Function (service role key). */
export async function service<T = any>(db: PGlite, fn: string, p: unknown = {}) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.role', 'service_role', true)`)
    await tx.exec('set local role service_role')
    const res = await tx.query<{ r: T }>(`select seragam.${fn}($1::jsonb) as r`, [JSON.stringify(p)])
    return res.rows[0].r
  })
}

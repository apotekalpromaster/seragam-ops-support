import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lapisan akses data. Semua fitur membaca lewat `select` (view/tabel di schema
 * seragam) dan menulis HANYA lewat `rpc` (fungsi seragam.fn_*). Ada dua
 * implementasi: Supabase (produksi) dan PGlite di browser (mode demo).
 */
export type FilterOp = 'eq' | 'neq' | 'in' | 'ilike' | 'gt' | 'gte' | 'lt' | 'lte' | 'is'
export type Filter = [column: string, op: FilterOp, value: unknown]
export interface SelectOpts {
  columns?: string
  filters?: Filter[]
  order?: [column: string, dir: 'asc' | 'desc'][]
  limit?: number
}

export interface Db {
  mode: 'supabase' | 'demo'
  select<T>(view: string, opts?: SelectOpts): Promise<T[]>
  rpc<T>(fn: string, p?: unknown): Promise<T>
  /** Simpan file (mis. foto/scan BAST) di bucket privat. */
  uploadFile(bucket: string, path: string, file: File): Promise<void>
  /** URL sementara untuk membuka file privat. */
  fileUrl(bucket: string, path: string): Promise<string>
  /** Panggil Supabase Edge Function (mis. kirim email tes). Tidak tersedia di mode demo. */
  invoke<T>(fn: string, body?: unknown): Promise<T>
}

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY

const IDENT = /^[a-z_][a-z0-9_]*$/
function ident(s: string) {
  if (!IDENT.test(s)) throw new Error(`Nama kolom/view tidak valid: ${s}`)
  return s
}

// ---------- Supabase ----------
export function supabaseDb(client: SupabaseClient): Db {
  const PAGE = 1000
  return {
    mode: 'supabase',
    async select<T>(view: string, opts: SelectOpts = {}) {
      const out: T[] = []
      for (let from = 0; ; from += PAGE) {
        let q = client.schema('seragam').from(ident(view)).select(opts.columns ?? '*')
        for (const [col, op, val] of opts.filters ?? []) {
          if (op === 'in') q = q.in(col, val as unknown[])
          else if (op === 'is') q = q.is(col, val as null | boolean)
          else q = q.filter(col, op, val as string)
        }
        for (const [col, dir] of opts.order ?? []) q = q.order(col, { ascending: dir === 'asc' })
        const to = opts.limit ? Math.min(from + PAGE, opts.limit) - 1 : from + PAGE - 1
        const { data, error } = await q.range(from, to)
        if (error) throw new Error(error.message)
        out.push(...(data as T[]))
        if (!data || data.length < PAGE || (opts.limit && out.length >= opts.limit)) break
      }
      return out
    },
    async rpc<T>(fn: string, p: unknown = {}) {
      const { data, error } = await client.schema('seragam').rpc(ident(fn), { p })
      if (error) throw new Error(error.message)
      return data as T
    },
    async uploadFile(bucket, path, file) {
      const { error } = await client.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type })
      if (error) throw new Error(`UPLOAD: ${error.message}`)
    },
    async fileUrl(bucket, path) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 300)
      if (error || !data) throw new Error('TIDAK_DITEMUKAN: File tidak bisa dibuka.')
      return data.signedUrl
    },
    async invoke<T>(fn: string, body: unknown = {}) {
      const { data, error } = await client.functions.invoke(fn, { body: body as Record<string, unknown> })
      if (error) {
        // Pesan dari fungsi (mis. "AKSES_DITOLAK: …") ada di body respons
        const res = (error as { context?: Response }).context
        const msg = res ? await res.json().then((j) => j.error ?? j.pesan).catch(() => null) : null
        throw new Error(msg ?? (/not found|404/i.test(error.message) ? 'FUNGSI_TIDAK_ADA: Edge Function belum di-deploy. Lihat docs/SETUP-email-harian.md.' : error.message))
      }
      return data as T
    },
  }
}

// ---------- SQL builder untuk mode demo ----------
export function buildSelectSql(view: string, opts: SelectOpts = {}): { sql: string; params: unknown[] } {
  const cols = opts.columns ?? '*'
  if (!/^[a-z0-9_,\s*]+$/.test(cols)) throw new Error('Kolom tidak valid')
  const params: unknown[] = []
  const where: string[] = []
  const opSql: Record<Exclude<FilterOp, 'in' | 'is'>, string> = {
    eq: '=', neq: '<>', ilike: 'ilike', gt: '>', gte: '>=', lt: '<', lte: '<=',
  }
  for (const [col, op, val] of opts.filters ?? []) {
    const c = ident(col)
    if (op === 'in') {
      params.push(val)
      where.push(`${c}::text = any ($${params.length}::text[])`)
    } else if (op === 'is') {
      where.push(`${c} is ${val === null ? 'null' : val ? 'true' : 'false'}`)
    } else {
      params.push(val)
      where.push(`${c} ${opSql[op]} $${params.length}`)
    }
  }
  let sql = `select ${cols} from seragam.${ident(view)}`
  if (where.length) sql += ` where ${where.join(' and ')}`
  if (opts.order?.length) sql += ` order by ${opts.order.map(([c, d]) => `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`).join(', ')}`
  if (opts.limit) sql += ` limit ${Math.floor(opts.limit)}`
  return { sql, params }
}

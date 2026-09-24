import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Db, SelectOpts } from './db'
import { toAppError } from './errors'

const DbContext = createContext<Db | null>(null)

export function DbProvider({ db, children }: { db: Db; children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

export function useDb() {
  const db = useContext(DbContext)
  if (!db) throw new Error('DbProvider belum dipasang')
  return db
}

/** Baca view/tabel di schema seragam. */
export function useView<T>(view: string, opts?: SelectOpts, enabled = true) {
  const db = useDb()
  return useQuery({
    queryKey: ['view', view, opts ?? null],
    queryFn: () => db.select<T>(view, opts),
    enabled,
  })
}

interface RpcOptions<R> {
  /** Pesan toast sukses; fungsi menerima hasil RPC. */
  success?: string | ((r: R) => string)
  /** Default: semua query di-refresh, karena hampir semua view saling terkait. */
  invalidate?: boolean
  /** Jangan tampilkan toast error (mis. saat error ditampilkan inline). */
  silentError?: boolean
}

/** Tulis lewat RPC seragam.fn_*. Error dipetakan ke pesan ramah pengguna. */
export function useRpc<P = unknown, R = any>(fn: string, options: RpcOptions<R> = {}) {
  const db = useDb()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: P) => db.rpc<R>(fn, p),
    onSuccess: (r) => {
      // Tidak ditunggu: dialog langsung tertutup, data diperbarui di latar (tabel menampilkan indikator muat).
      if (options.invalidate !== false) void qc.invalidateQueries()
      if (options.success) toast.success(typeof options.success === 'function' ? options.success(r) : options.success)
    },
    onError: (e) => {
      if (options.silentError) return
      const err = toAppError(e)
      toast.error(err.title, { description: err.message, duration: 8000 })
    },
  })
}

/** Panggil RPC baca-saja (mis. preview dampak) sebagai query. */
export function useRpcQuery<R>(fn: string, p: unknown, enabled = true) {
  const db = useDb()
  return useQuery({
    queryKey: ['rpc', fn, p],
    queryFn: () => db.rpc<R>(fn, p),
    enabled,
    retry: false,
  })
}

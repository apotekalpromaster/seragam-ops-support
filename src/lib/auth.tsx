import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL, supabaseDb, type Db } from './db'

export type Role = 'admin' | 'staf' | 'viewer' | 'apa'
export interface Me {
  user_id: string
  email: string
  nama: string
  role: Role | null
}

interface AuthState {
  db: Db | null
  me: Me | null
  loading: boolean
  loadingMsg: string
  signIn: (email: string, password: string) => Promise<void>
  signInDemo: (userId: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const DEMO_KEY = 'seragam-demo-user'

let supabase: SupabaseClient | null = null
function getSupabase() {
  if (!supabase) supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  return supabase
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState('Memuat…')
  // Cache data dibuang setiap ganti akun supaya data sesi sebelumnya tidak terlihat.
  const qc = useQueryClient()

  const loadMe = useCallback(async (d: Db) => {
    const m = await d.rpc<Me>('fn_me', {})
    setMe(m.user_id ? m : null)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (IS_DEMO) {
        setLoadingMsg('Menyiapkan database demo di browser…')
        const { createDemoDb, setDemoUser } = await import('./demo/demoDb')
        const saved = sessionStorage.getItem(DEMO_KEY)
        setDemoUser(saved)
        const d = await createDemoDb((m) => !cancelled && setLoadingMsg(m))
        if (cancelled) return
        setDb(d)
        if (saved) await loadMe(d)
        setLoading(false)
        return
      }
      const client = getSupabase()
      const d = supabaseDb(client)
      setDb(d)
      const { data } = await client.auth.getSession()
      if (data.session) await loadMe(d).catch(() => setMe(null))
      setLoading(false)
      client.auth.onAuthStateChange((_e, session: Session | null) => {
        if (!session) setMe(null)
      })
    })().catch((e) => {
      console.error(e)
      setLoadingMsg('Gagal memuat aplikasi. Muat ulang halaman.')
    })
    return () => {
      cancelled = true
    }
  }, [loadMe])

  const value = useMemo<AuthState>(() => ({
    db, me, loading, loadingMsg,
    async signIn(email, password) {
      const client = getSupabase()
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      qc.clear()
      await loadMe(db!)
    },
    async signInDemo(userId) {
      const { setDemoUser } = await import('./demo/demoDb')
      sessionStorage.setItem(DEMO_KEY, userId)
      setDemoUser(userId)
      qc.clear()
      await loadMe(db!)
    },
    async signOut() {
      if (IS_DEMO) {
        const { setDemoUser } = await import('./demo/demoDb')
        sessionStorage.removeItem(DEMO_KEY)
        setDemoUser(null)
      } else {
        await getSupabase().auth.signOut()
      }
      qc.clear()
      setMe(null)
    },
  }), [db, me, loading, loadingMsg, loadMe, qc])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const a = useContext(AuthContext)
  if (!a) throw new Error('AuthProvider belum dipasang')
  return a
}

/** Role pengguna aktif + helper izin. */
export function usePerm() {
  const { me } = useAuth()
  const role = me?.role ?? null
  return {
    role,
    isAdmin: role === 'admin',
    canWrite: role === 'admin' || role === 'staf',
  }
}

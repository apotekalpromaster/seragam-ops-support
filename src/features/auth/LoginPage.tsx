import { ArrowRight, FlaskConical, Lock, Mail, Shirt, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Callout, Field, Input } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { IS_DEMO } from '../../lib/db'
import { toAppError } from '../../lib/errors'
import { ROLE_LABEL } from '../../lib/labels'

const DEMO = [
  { id: '00000000-0000-0000-0000-00000000000a', nama: 'Rina Kusuma', role: 'admin', desc: 'Semua fitur: import, master & config, approval opname.' },
  { id: '00000000-0000-0000-0000-00000000000b', nama: 'Budi Santoso', role: 'staf', desc: 'Input transaksi & opname. Tidak bisa ubah master/config.' },
  { id: '00000000-0000-0000-0000-00000000000c', nama: 'Dewi Lestari', role: 'viewer', desc: 'Read-only + export (Division Lead, PPM, Finance).' },
]

export default function LoginPage() {
  const { signIn, signInDemo } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!email || !password) { setErr('Isi email dan password.'); return }
    setBusy('login')
    try { await signIn(email.trim(), password) } catch (x) { setErr(toAppError(x).message) } finally { setBusy(null) }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30"><Shirt className="size-6" /></div>
          <div>
            <p className="text-lg font-extrabold leading-tight">Apotek Alpro</p>
            <p className="text-sm text-white/80">Seragam Ops Support</p>
          </div>
        </div>
        <div className="mt-auto max-w-md">
          <h1 className="text-4xl font-extrabold leading-tight">Satu dashboard untuk alokasi, stok, dan retur seragam.</h1>
          <p className="mt-4 text-white/85">Siapa dikirimi apa, ukuran berapa, ke cabang mana — dihitung otomatis dari data PPM. Stok selalu berasal dari transaksi, tidak pernah diketik manual.</p>
          <p className="mt-8 flex items-center gap-2 text-sm text-white/80"><ShieldCheck className="size-4" /> Data karyawan hanya untuk pengguna terdaftar.</p>
        </div>
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-32 right-20 size-72 rounded-full bg-white/5" />
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-11 items-center justify-center rounded-full bg-brand-500 text-white"><Shirt className="size-5" /></div>
            <div><p className="font-extrabold">Apotek Alpro</p><p className="text-sm font-semibold text-brand-600">Seragam Ops Support</p></div>
          </div>

          {IS_DEMO ? (
            <>
              <h2 className="text-2xl font-extrabold">Masuk ke mode demo</h2>
              <p className="mt-1 text-sm text-muted">Pilih peran untuk mencoba dashboard. Data contoh disimpan di browser ini saja.</p>
              <Callout tone="brand" icon={<FlaskConical className="size-4" />} >
                Supabase belum dihubungkan. Isi <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> di file <code>.env</code> untuk memakai login email.
              </Callout>
              <div className="mt-5 space-y-3">
                {DEMO.map((u) => (
                  <button key={u.id} onClick={async () => { setBusy(u.id); try { await signInDemo(u.id) } finally { setBusy(null) } }}
                    disabled={!!busy}
                    className="group flex w-full items-center gap-4 rounded-2xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md disabled:opacity-60">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
                      {u.nama.split(' ').map((w) => w[0]).join('')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{u.nama} <span className="ml-1 text-xs font-semibold text-brand-600">{ROLE_LABEL[u.role]}</span></p>
                      <p className="mt-0.5 text-xs text-muted">{u.desc}</p>
                    </div>
                    <ArrowRight className="size-4 text-slate-300 group-hover:text-brand-500" />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <h2 className="text-2xl font-extrabold">Masuk</h2>
              <p className="mt-1 text-sm text-muted">Gunakan akun yang dibuat admin Ops Support.</p>
              <div className="mt-6 space-y-4">
                <Field label="Email" htmlFor="email">
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" placeholder="nama@alpro.co.id" autoFocus />
                  </div>
                </Field>
                <Field label="Password" htmlFor="password">
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" />
                  </div>
                </Field>
                {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
                <Button type="submit" variant="primary" className="w-full" loading={busy === 'login'}>Masuk</Button>
                <p className="text-center text-xs text-muted">Lupa password atau belum punya akun? Hubungi admin Ops Support.</p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

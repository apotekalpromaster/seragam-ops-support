import clsx from 'clsx'
import { CheckCircle2, ChevronDown, LogOut, PackageCheck, Shirt, Upload, Undo2, UserRoundCheck } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/dialog'
import { Button, Callout, Chip, ErrorBlock, Field, Input, LoadingBlock, Textarea } from '../../components/ui'
import { useDb, useRpc, useRpcQuery } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { toAppError } from '../../lib/errors'
import { fmtDate, isoToday } from '../../lib/format'
import { RETUR_SUMBER_LABEL } from '../../lib/labels'
import { BAST_BUCKET } from '../batch/BatchDetailPage'

interface Kiriman {
  batch_id: number; kode: string; shipped_at: string; received_at: string | null; ada_bast: boolean; pcs: number
  karyawan: { nama: string; jabatan: string; status: string; planned_join_date: string | null; items: { label: string; qty: number }[] }[]
}
interface Home {
  cabang: { kode_cabang: string; nama: string; area: string | null; alamat: string | null }
  pengiriman: Kiriman[]
  ditahan: { nama: string; jabatan: string; planned_join_date: string | null; pcs: number }[]
  retur: { nama: string; jabatan: string; sumber: string; tanggal_acuan: string | null; items: { item_nama: string; qty: number }[] }[]
  akan_resign: { nama: string; jabatan: string; planned_resign_date: string; items: { item_nama: string; qty: number }[] }[]
}

/** Tampilan APA / Branch Manager (PRD §3): hanya data cabangnya, dirancang untuk HP. */
export default function ApaApp() {
  const { me, signOut } = useAuth()
  const q = useRpcQuery<Home>('fn_apa_home', {})
  const [params] = useSearchParams()
  const focus = Number(params.get('batch')) || null
  const [recv, setRecv] = useState<Kiriman | null>(null)
  const pending = q.data?.pengiriman.filter((k) => !k.received_at) ?? []
  const done = q.data?.pengiriman.filter((k) => k.received_at) ?? []
  const focusDone = focus ? done.find((k) => k.batch_id === focus) : undefined

  return (
    <div className="min-h-full bg-page">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white"><Shirt className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">Seragam · {q.data?.cabang.nama ?? me?.cabang_nama ?? 'Cabang'}</p>
            <p className="truncate text-xs text-muted">{me?.nama} · APA / Branch Manager</p>
          </div>
          <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>Keluar</Button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-5">
        {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
          <>
            {focusDone && <Callout tone="green" icon={<CheckCircle2 className="size-4" />}>Kiriman {focusDone.kode} sudah dikonfirmasi diterima {fmtDate(focusDone.received_at)}. Terima kasih!</Callout>}

            <Section icon={<PackageCheck className="size-4" />} title="Kiriman perlu dikonfirmasi" count={pending.length}>
              {!pending.length ? <Empty>Tidak ada kiriman yang menunggu konfirmasi.</Empty> : pending.map((k) => (
                <KirimanCard key={k.batch_id} k={k} focus={k.batch_id === focus} action={<Button variant="primary" className="w-full" icon={<PackageCheck className="size-4" />} onClick={() => setRecv(k)}>Konfirmasi terima & unggah BAST</Button>} />
              ))}
            </Section>

            <Section icon={<UserRoundCheck className="size-4" />} title="Paket joiner disimpan di cabang" count={q.data.ditahan.length}>
              {!q.data.ditahan.length ? <Empty>Belum ada paket joiner yang sudah diterima dan menunggu hari join.</Empty> : (
                <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
                  {q.data.ditahan.map((d, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div><p className="font-semibold">{d.nama}</p><p className="text-xs text-muted">{d.jabatan} · {d.pcs} pcs</p></div>
                      <Chip tone="violet">serahkan saat join {fmtDate(d.planned_join_date)}</Chip>
                    </li>
                  ))}
                </ul>
              )}
              {!!q.data.ditahan.length && <p className="text-xs text-muted">Simpan paket bertanda "SIMPAN DI APA". Serahkan pada hari pertama kerja. Bila joiner batal, kabari Ops Support.</p>}
            </Section>

            <Section icon={<Undo2 className="size-4" />} title="Seragam yang harus dikembalikan ke gudang" count={q.data.retur.length}>
              {!q.data.retur.length ? <Empty>Tidak ada seragam yang perlu dikembalikan.</Empty> : (
                <>
                  <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
                    {q.data.retur.map((r, i) => (
                      <li key={i} className="px-4 py-3 text-sm">
                        <div className="flex items-start justify-between gap-2"><p className="font-semibold">{r.nama}</p><Chip tone={['BATAL_JOIN', 'NOSHOW'].includes(r.sumber) ? 'violet' : 'slate'}>{RETUR_SUMBER_LABEL[r.sumber]}</Chip></div>
                        <p className="text-xs text-muted">{r.jabatan}{r.tanggal_acuan ? ` · sejak ${fmtDate(r.tanggal_acuan)}` : ''}</p>
                        <p className="mt-1">{r.items.map((it) => `${it.item_nama} × ${it.qty}`).join(', ')}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">Kemas dan kirim ke Gudang Ops Support HQ. Tulis nama karyawan di paket supaya mudah dicatat.</p>
                </>
              )}
            </Section>

            {!!q.data.akan_resign.length && (
              <Section title="Akan resign — ambil seragam di hari terakhir" count={q.data.akan_resign.length}>
                <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
                  {q.data.akan_resign.map((r, i) => (
                    <li key={i} className="px-4 py-3 text-sm">
                      <p className="font-semibold">{r.nama} <span className="font-normal text-muted">· hari terakhir {fmtDate(r.planned_resign_date)}</span></p>
                      <p className="mt-0.5">{r.items.map((it) => `${it.item_nama} × ${it.qty}`).join(', ')}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {!!done.length && (
              <Section title="Sudah diterima (60 hari terakhir)" count={done.length}>
                {done.map((k) => <KirimanCard key={k.batch_id} k={k} focus={false} />)}
              </Section>
            )}
          </>
        )}
        <p className="pb-6 text-center text-xs text-muted">Ada kiriman yang kurang atau salah? Hubungi Ops Support HQ.</p>
      </main>
      {recv && q.data && <ReceiveModal k={recv} kodeCabang={q.data.cabang.kode_cabang} onClose={() => setRecv(null)} />}
    </div>
  )
}

function Section({ title, count, icon, children }: { title: string; count?: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">{icon}{title}{!!count && <span className="rounded-full bg-brand-100 px-2 text-xs text-brand-700">{count}</span>}</h2>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-3 text-sm text-muted">{children}</p>
}

function KirimanCard({ k, focus, action }: { k: Kiriman; focus: boolean; action?: ReactNode }) {
  const [open, setOpen] = useState(focus)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [focus])
  const joiner = k.karyawan.filter((e) => e.status === 'OFFERING').length
  return (
    <div ref={ref} className={clsx('rounded-2xl border bg-white p-4 shadow-sm', focus ? 'border-brand-300 ring-4 ring-brand-100' : 'border-line')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">{k.kode}</p>
          <p className="text-sm text-muted">Dikirim {fmtDate(k.shipped_at)} · {k.karyawan.length} karyawan · {k.pcs} pcs</p>
        </div>
        {k.received_at ? <Chip tone="green"><CheckCircle2 className="size-3" /> Diterima {fmtDate(k.received_at)}</Chip> : <Chip tone="blue">Dalam pengiriman</Chip>}
      </div>
      {joiner > 0 && !k.received_at && <p className="mt-2 text-xs font-semibold text-violet-700">{joiner} paket joiner: simpan di APA sampai hari join.</p>}
      <button className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Sembunyikan' : 'Lihat'} isi per karyawan <ChevronDown className={clsx('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
          {k.karyawan.map((e, i) => (
            <li key={i} className="px-3 py-2">
              <p className="font-semibold">{e.nama} {e.status === 'OFFERING' && <Chip tone="violet">joiner · {fmtDate(e.planned_join_date)}</Chip>}</p>
              <p className="text-xs text-muted">{e.jabatan} — {e.items.map((it) => `${it.label} × ${it.qty}`).join(', ')}</p>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

function ReceiveModal({ k, kodeCabang, onClose }: { k: Kiriman; kodeCabang: string; onClose: () => void }) {
  const db = useDb()
  const [tgl, setTgl] = useState(isoToday())
  const [file, setFile] = useState<File | null>(null)
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const m = useRpc('fn_batch_receive', { success: `Kiriman ${k.kode} dikonfirmasi diterima. Terima kasih!` })
  const fileErr = file && file.size > 10 * 1024 * 1024 ? 'Ukuran file maksimal 10 MB.' : file && !/^(image\/|application\/pdf)/.test(file.type) ? 'Gunakan foto (JPG/PNG) atau PDF.' : null
  async function save() {
    if (!file) return
    setBusy(true)
    try {
      const path = `batch-${k.batch_id}/${kodeCabang}-${Date.now()}.${(file.name.split('.').pop() ?? 'jpg').toLowerCase()}`
      try { await db.uploadFile(BAST_BUCKET, path, file) } catch (e) {
        toast.error('Upload BAST gagal', { description: `${toAppError(e).message} Konfirmasi belum disimpan; coba lagi.` })
        return
      }
      await m.mutateAsync({ batch_id: k.batch_id, tanggal: tgl, bast_path: path, catatan })
      onClose()
    } catch { /* toast */ } finally { setBusy(false) }
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Konfirmasi terima — ${k.kode}`}
      description={`${k.karyawan.length} karyawan · ${k.pcs} pcs. Cocokkan isi paket dengan packing list sebelum menandatangani BAST.`}
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} disabled={!file || !!fileErr} onClick={() => void save()}>Kirim konfirmasi</Button></>}>
      <div className="space-y-4">
        <Field label="Foto / scan BAST yang sudah ditandatangani" required error={fileErr ?? undefined} hint={!file ? 'Wajib. JPG, PNG, atau PDF maks. 10 MB.' : undefined}>
          <div className="flex items-center gap-3">
            <Button icon={<Upload className="size-4" />} onClick={() => ref.current?.click()}>{file ? 'Ganti foto' : 'Ambil / pilih foto'}</Button>
            <span className="min-w-0 truncate text-sm text-muted">{file?.name ?? 'Belum ada file'}</span>
          </div>
          <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Tanggal paket diterima" required>
          <Input type="date" value={tgl} min={k.shipped_at} max={isoToday()} onChange={(e) => setTgl(e.target.value)} />
        </Field>
        <Field label="Catatan (bila ada yang kurang/rusak)"><Textarea className="min-h-14" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. 1 polo M kurang" /></Field>
        <p className="text-xs text-muted">Konfirmasi hanya bisa dikirim sekali. Bila keliru, hubungi Ops Support HQ.</p>
      </div>
    </Modal>
  )
}

import clsx from 'clsx'
import { AlertTriangle, PackagePlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../components/dialog'
import { Button, Callout, Chip, Field, Input, LoadingBlock, Textarea } from '../../components/ui'
import { useRpc, useRpcQuery, useView } from '../../lib/api'
import { fmtDate, fmtNum, isoToday } from '../../lib/format'
import { BATCH_JENIS_LABEL } from '../../lib/labels'

interface Preview {
  jenis: string; periode: string; deadline_kirim: string; baris: number; pcs: number; karyawan: number; cabang: number
  baris_shortage: number; shortage: { sku_code: string; label: string; dibutuhkan: number; available: number }[]; reguler_sudah_ada: string | null
}
type Jenis = 'REGULER' | 'ADHOC' | 'CABANG_BARU'
type Cakupan = 'SEMUA' | 'HIRE_MENDADAK' | 'CABANG' | 'KARYAWAN' | 'CABANG_BARU'

/** Buat batch dari antrian. Stok dicek otomatis: yang kurang masuk daftar shortage (PRD §7.4). */
export function CreateBatchModal({ onClose, niks, initialJenis, initialCakupan }: {
  onClose: () => void; niks?: string[]; initialJenis?: Jenis; initialCakupan?: Cakupan
}) {
  const nav = useNavigate()
  const [jenis, setJenis] = useState<Jenis>(initialJenis ?? (niks?.length ? 'ADHOC' : 'REGULER'))
  const [cakupan, setCakupan] = useState<Cakupan>(initialCakupan ?? (niks?.length ? 'KARYAWAN' : 'SEMUA'))
  const [periode, setPeriode] = useState(isoToday().slice(0, 7))
  const [deadline, setDeadline] = useState('')
  const [catatan, setCatatan] = useState('')
  const [cabang, setCabang] = useState<string[]>([])
  const [cabQ, setCabQ] = useState('')
  const branches = useView<{ kode_cabang: string; nama: string; area: string | null; is_new_opening: boolean }>('branch', { filters: [['active', 'eq', true]], order: [['nama', 'asc']] })

  useEffect(() => {
    if (niks?.length) return
    if (jenis === 'REGULER') setCakupan('SEMUA')
    if (jenis === 'CABANG_BARU') setCakupan('CABANG_BARU')
    if (jenis === 'ADHOC' && (cakupan === 'SEMUA' || cakupan === 'CABANG_BARU')) setCakupan('HIRE_MENDADAK')
  }, [jenis]) // eslint-disable-line react-hooks/exhaustive-deps

  const params = useMemo(() => ({
    jenis, cakupan, periode: `${periode}-01`,
    ...(cakupan === 'CABANG' ? { kode_cabang: cabang } : {}),
    ...(cakupan === 'KARYAWAN' ? { nik: niks ?? [] } : {}),
  }), [jenis, cakupan, periode, cabang, niks])
  const [debounced, setDebounced] = useState(params)
  useEffect(() => { const t = setTimeout(() => setDebounced(params), 300); return () => clearTimeout(t) }, [params])
  const pv = useRpcQuery<Preview>('fn_batch_preview', debounced, !(cakupan === 'CABANG' && !cabang.length))
  const create = useRpc<unknown, { id: number; kode: string; baris: number; baris_shortage: number }>('fn_batch_create', {
    success: (r) => `Batch ${r.kode} dibuat: ${r.baris} baris${r.baris_shortage ? `, ${r.baris_shortage} baris kurang stok` : ''}. Stok sudah dipesan (reserved).`,
  })
  const p = pv.data
  const dl = deadline || p?.deadline_kirim || ''
  const blocked = !p || p.baris === 0 || !!p.reguler_sudah_ada

  const cabList = (branches.data ?? []).filter((b) => !cabQ || `${b.kode_cabang} ${b.nama} ${b.area ?? ''}`.toLowerCase().includes(cabQ.toLowerCase()))

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Buat batch distribusi" size="lg"
      description="Sistem mengambil antrian yang ukurannya valid, mendahulukan tanggal join paling awal, dan memesan stok. Baris yang stoknya kurang tetap di antrian."
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" icon={<PackagePlus className="size-4" />} loading={create.isPending} disabled={blocked}
          onClick={async () => {
            try {
              const r = await create.mutateAsync({ ...params, deadline_kirim: dl, catatan })
              onClose(); nav(`/batch/${r.id}`)
            } catch { /* toast */ }
          }}>{p && p.baris > 0 ? `Buat batch (${fmtNum(p.baris)} baris)` : 'Buat batch'}</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          {niks?.length ? (
            <Callout tone="brand">Batch ad-hoc untuk <b>{niks.length} karyawan terpilih</b> dari antrian.</Callout>
          ) : (
            <Field label="Jenis batch">
              <div className="grid gap-2">
                {(['REGULER', 'ADHOC', 'CABANG_BARU'] as Jenis[]).map((j) => (
                  <label key={j} className={clsx('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', jenis === j ? 'border-brand-300 bg-brand-50' : 'border-line')}>
                    <input type="radio" className="mt-0.5 accent-brand-500" checked={jenis === j} onChange={() => setJenis(j)} />
                    <span><b>{BATCH_JENIS_LABEL[j]}</b>
                      <span className="block text-muted">{{
                        REGULER: 'Satu per periode cutoff. Semua antrian yang siap kirim.',
                        ADHOC: 'Susulan atau hire mendadak (mingguan).',
                        CABANG_BARU: 'Karyawan di cabang yang akan Grand Opening.',
                      }[j]}</span></span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          {jenis === 'ADHOC' && !niks?.length && (
            <Field label="Cakupan">
              <div className="flex flex-wrap gap-2">
                {(['HIRE_MENDADAK', 'CABANG', 'SEMUA'] as Cakupan[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCakupan(c)} aria-pressed={cakupan === c}
                    className={clsx('rounded-xl border px-3 py-1.5 text-sm font-semibold', cakupan === c ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line text-slate-600')}>
                    {{ HIRE_MENDADAK: 'Hire mendadak', CABANG: 'Cabang tertentu', SEMUA: 'Semua sisa antrian' }[c as 'HIRE_MENDADAK']}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {cakupan === 'CABANG' && (
            <Field label={`Pilih cabang (${cabang.length} dipilih)`}>
              <Input value={cabQ} onChange={(e) => setCabQ(e.target.value)} placeholder="Cari cabang…" className="mb-2" />
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {cabList.map((b) => (
                  <label key={b.kode_cabang} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                    <input type="checkbox" className="accent-brand-500" checked={cabang.includes(b.kode_cabang)}
                      onChange={(e) => setCabang(e.target.checked ? [...cabang, b.kode_cabang] : cabang.filter((x) => x !== b.kode_cabang))} />
                    {b.nama} <span className="text-xs text-muted">{b.kode_cabang} · {b.area}</span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {jenis === 'REGULER' && (
              <Field label="Periode cutoff" required><Input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} /></Field>
            )}
            <Field label="Deadline kirim" required hint={jenis === 'REGULER' ? 'Default dari parameter tanggal deadline.' : 'Default 7 hari dari hari ini.'}>
              <Input type="date" value={dl} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          </div>
          <Field label="Catatan"><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} className="min-h-14" placeholder="Opsional" /></Field>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-bold">Preview batch</p>
          {cakupan === 'CABANG' && !cabang.length ? <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Pilih minimal satu cabang.</p>
            : pv.isLoading || !p ? <LoadingBlock rows={3} /> : (
            <>
              {p.reguler_sudah_ada && (
                <Callout tone="amber" icon={<AlertTriangle className="size-4" />} title={`Batch reguler periode ini sudah ada (${p.reguler_sudah_ada})`}>
                  Gunakan jenis Ad-hoc untuk susulan, atau batalkan batch reguler tersebut dulu.
                </Callout>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Baris (karyawan × item)" value={p.baris} />
                <Stat label="Total pcs" value={p.pcs} />
                <Stat label="Karyawan" value={p.karyawan} />
                <Stat label="Cabang tujuan" value={p.cabang} />
              </div>
              <p className="text-xs text-muted">Deadline kirim: <b>{fmtDate(dl)}</b></p>
              {p.baris === 0 && <Callout tone="amber">Tidak ada baris yang bisa dikirim: antrian kosong untuk cakupan ini, atau semua kekurangan stok.</Callout>}
              {p.baris_shortage > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
                  <p className="font-bold text-red-800">{p.baris_shortage} baris tidak masuk karena stok kurang</p>
                  <p className="mt-0.5 text-xs text-red-700">Tetap di antrian dan akan ikut batch berikutnya setelah stok masuk.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.shortage.map((s) => <Chip key={s.sku_code} tone="red">{s.label}: butuh {s.dibutuhkan}, tersisa {Math.max(0, s.available)}</Chip>)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-line bg-slate-50/60 px-3 py-2"><p className="text-xs text-muted">{label}</p><p className="text-lg font-bold num">{fmtNum(value)}</p></div>
}

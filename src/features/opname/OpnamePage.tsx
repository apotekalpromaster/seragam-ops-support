import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { CheckCircle2, ClipboardCheck, Download, Eye, EyeOff, Loader2, Plus, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog, Modal } from '../../components/dialog'
import { Stepper } from '../../components/Stepper'
import { Button, Callout, Card, Chip, EmptyState, Field, Input, LoadingBlock, Textarea } from '../../components/ui'
import { useDb, useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { toAppError } from '../../lib/errors'
import { fmtDate, fmtDateTime, fmtNum, isoToday } from '../../lib/format'
import { OPNAME_STATUS_LABEL, STOCK_STATUS_LABEL } from '../../lib/labels'
import { exportXlsx, readSheet } from '../../lib/xlsx'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

interface Opname {
  id: number; tanggal: string; status: string; is_opening: boolean; catatan: string | null; created_by_nama: string | null; created_at: string
  approved_by_nama: string | null; approved_at: string | null; submitted_at: string | null; jumlah_baris: number; jumlah_terisi: number; jumlah_selisih: number
}
interface Line {
  opname_id: number; sku_code: string; stock_status: string; qty_sistem: number; qty_fisik: number | null; alasan: string | null
  sku_label: string; item_code: string; size_order: number; item_sort: number; gender: string; selisih: number | null
}

export default function OpnamePage() {
  const list = useView<Opname>('v_opname', { order: [['id', 'desc']] })
  const active = list.data?.find((o) => o.status === 'DRAFT' || o.status === 'SUBMITTED')
  const { canWrite } = usePerm()
  const [creating, setCreating] = useState(false)

  return (
    <Page title="Stock Opname" subtitle="Hitung fisik → selisih → approval admin → penyesuaian otomatis" help="opname"
>
      {list.isLoading ? <Card><LoadingBlock /></Card> : active ? <ActiveOpname o={active} /> : (
        <Card>
          <EmptyState icon={<ClipboardCheck className="size-5" />} title="Tidak ada opname yang sedang berjalan"
            action={canWrite && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Buat lembar opname</Button>}>
            {list.data?.some((o) => o.status === 'APPROVED')
              ? 'Selisih opname yang disetujui otomatis menjadi transaksi penyesuaian (ADJ).'
              : 'Opname pertama membentuk saldo awal stok (OPENING). Hitung semua barang di gudang Ops Support.'}
          </EmptyState>
        </Card>
      )}
      <HistoryCard rows={list.data} loading={list.isLoading} />
      {creating && <CreateModal first={!list.data?.some((o) => o.status === 'APPROVED')} onClose={() => setCreating(false)} />}
    </Page>
  )
}

function CreateModal({ first, onClose }: { first: boolean; onClose: () => void }) {
  const [tanggal, setTanggal] = useState(isoToday())
  const [catatan, setCatatan] = useState('')
  const m = useRpc('fn_opname_create', { success: (r: { is_opening: boolean }) => r.is_opening ? 'Lembar opname awal dibuat.' : 'Lembar opname dibuat.' })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Buat lembar opname" size="sm"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={m.isPending} onClick={async () => { try { await m.mutateAsync({ tanggal, catatan }); onClose() } catch { /* toast */ } }}>Buat lembar</Button></>}>
      <div className="space-y-4">
        {first && <Callout tone="brand" title="Ini opname pertama">Hasilnya menjadi saldo awal stok (OPENING). Isi semua SKU, termasuk yang jumlahnya 0.</Callout>}
        <Field label="Tanggal hitung" required><Input type="date" value={tanggal} max={isoToday()} onChange={(e) => setTanggal(e.target.value)} /></Field>
        <Field label="Catatan" hint="Opsional, mis. lokasi gudang atau tim penghitung."><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function ActiveOpname({ o }: { o: Opname }) {
  const lines = useView<Line>('v_opname_line', { filters: [['opname_id', 'eq', o.id]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc'], ['stock_status', 'asc']] })
  const { canWrite, isAdmin } = usePerm()
  const db = useDb()
  const qc = useQueryClient()
  const draft = o.status === 'DRAFT' && canWrite
  const [local, setLocal] = useState<Record<string, { qty_fisik: string; alasan: string }>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saveState, setSaveState] = useState<{ at?: Date; saving?: boolean; error?: string }>({})
  const [showSys, setShowSys] = useState(!o.is_opening)
  const [confirm, setConfirm] = useState<'submit' | 'approve' | 'cancel' | 'reopen' | 'fillzero' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const key = (l: { sku_code: string; stock_status: string }) => `${l.sku_code}|${l.stock_status}`
  const val = (l: Line) => local[key(l)] ?? { qty_fisik: l.qty_fisik === null ? '' : String(l.qty_fisik), alasan: l.alasan ?? '' }

  // Simpan otomatis 1 detik setelah berhenti mengetik (heuristik #3: draft tidak hilang)
  useEffect(() => {
    if (!dirty.size) return
    const t = setTimeout(() => void flush(), 1000)
    return () => clearTimeout(t)
  }, [dirty, local]) // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    const keys = [...dirty]
    if (!keys.length) return
    const payload = keys.map((k) => { const [sku_code, stock_status] = k.split('|'); const v = local[k]; return { sku_code, stock_status, qty_fisik: v.qty_fisik === '' ? null : Number(v.qty_fisik), alasan: v.alasan } })
    if (payload.some((p) => p.qty_fisik !== null && (!Number.isInteger(p.qty_fisik) || p.qty_fisik < 0))) {
      setSaveState({ error: 'Qty fisik harus bilangan bulat 0 atau lebih.' }); return
    }
    setSaveState({ saving: true })
    try {
      await db.rpc('fn_opname_save_lines', { opname_id: o.id, lines: payload })
      setDirty((d) => { const n = new Set(d); keys.forEach((k) => n.delete(k)); return n })
      setSaveState({ at: new Date() })
      await qc.invalidateQueries({ queryKey: ['view', 'v_opname'] })
      await qc.invalidateQueries({ queryKey: ['view', 'v_opname_line'] })
    } catch (e) {
      setSaveState({ error: toAppError(e).message })
    }
  }

  function edit(l: Line, patch: Partial<{ qty_fisik: string; alasan: string }>) {
    setLocal((s) => ({ ...s, [key(l)]: { ...val(l), ...patch } }))
    setDirty((d) => new Set(d).add(key(l)))
  }

  const rows = lines.data ?? []
  const filled = rows.filter((l) => val(l).qty_fisik !== '').length
  const diffs = rows.filter((l) => val(l).qty_fisik !== '' && Number(val(l).qty_fisik) !== l.qty_sistem)
  const plus = diffs.reduce((a, l) => a + Math.max(0, Number(val(l).qty_fisik) - l.qty_sistem), 0)
  const minus = diffs.reduce((a, l) => a + Math.max(0, l.qty_sistem - Number(val(l).qty_fisik)), 0)
  const needReason = !o.is_opening ? diffs.filter((l) => !val(l).alasan.trim()).length : 0

  const submit = useRpc('fn_opname_submit', { success: 'Opname diajukan. Menunggu approval admin.' })
  const approve = useRpc<unknown, { transaksi: number }>('fn_opname_approve', { success: (r) => `Opname disetujui. ${r.transaksi} transaksi ${o.is_opening ? 'saldo awal' : 'penyesuaian'} dibuat.` })
  const cancel = useRpc('fn_opname_cancel', { success: 'Opname dibatalkan.' })
  const reopen = useRpc('fn_opname_reopen', { success: 'Opname dikembalikan ke draft.' })

  async function runConfirm() {
    try {
      if (confirm === 'submit') { await flush(); await submit.mutateAsync({ opname_id: o.id }) }
      if (confirm === 'approve') await approve.mutateAsync({ opname_id: o.id })
      if (confirm === 'cancel') await cancel.mutateAsync({ opname_id: o.id })
      if (confirm === 'reopen') await reopen.mutateAsync({ opname_id: o.id })
      if (confirm === 'fillzero') {
        const blanks = rows.filter((l) => val(l).qty_fisik === '')
        blanks.forEach((l) => edit(l, { qty_fisik: '0' }))
        toast.success(`${blanks.length} baris kosong diisi 0.`)
      }
    } catch { /* toast */ }
    setConfirm(null)
  }

  async function uploadSheet(file: File | undefined) {
    if (!file) return
    try {
      const { rows: r } = await readSheet(file)
      const bySku = new Map(rows.map((l) => [key(l), l]))
      let n = 0; const unknown: string[] = []
      for (const x of r) {
        const k = `${(x.sku_code ?? '').toUpperCase()}|${(x.stock_status || 'LAYAK').toUpperCase()}`
        const l = bySku.get(k)
        if (!l) { if (x.sku_code) unknown.push(x.sku_code); continue }
        if (x.qty_fisik === '') continue
        edit(l, { qty_fisik: x.qty_fisik, ...(x.alasan ? { alasan: x.alasan } : {}) }); n++
      }
      toast.success(`${n} baris terisi dari file.`, { description: unknown.length ? `${unknown.length} SKU tidak dikenal dilewati: ${unknown.slice(0, 5).join(', ')}` : undefined })
    } catch { toast.error('File tidak bisa dibaca.') }
  }

  const columns = useMemo<ColumnDef<Line>[]>(() => [
    { accessorKey: 'sku_label', header: 'SKU', cell: ({ row: { original: l } }) => <div><p className="font-medium">{l.sku_label}</p><code className="text-xs text-muted">{l.sku_code}</code></div> },
    { accessorKey: 'stock_status', header: 'Status', cell: (c) => STOCK_STATUS_LABEL[c.getValue() as string] },
    ...(showSys ? [{ accessorKey: 'qty_sistem', header: 'Qty sistem', meta: { align: 'right' as const } }] : []),
    { id: 'fisik', header: 'Qty fisik', meta: { align: 'right', noExport: true }, enableSorting: false, cell: ({ row: { original: l } }) => draft ? (
      <Input type="number" min={0} step={1} inputMode="numeric" aria-label={`Qty fisik ${l.sku_code}`} value={val(l).qty_fisik}
        onChange={(e) => edit(l, { qty_fisik: e.target.value })} className={clsx('h-9 w-24 text-right num', val(l).qty_fisik === '' && 'bg-amber-50/60')}
        onKeyDown={(e) => {
          // Enter = lanjut ke baris berikutnya (input cepat saat menghitung)
          if (e.key !== 'Enter') return
          e.preventDefault()
          const all = [...document.querySelectorAll<HTMLInputElement>('input[data-opname-qty]')]
          all[all.indexOf(e.currentTarget) + 1]?.focus()
        }} data-opname-qty="" />
    ) : <span className="font-semibold">{l.qty_fisik ?? '—'}</span> },
    ...(showSys ? [{ id: 'selisih', header: 'Selisih', meta: { align: 'right' as const }, cell: ({ row: { original: l } }: { row: { original: Line } }) => {
      const v = val(l).qty_fisik; if (v === '') return <span className="text-slate-300">—</span>
      const d = Number(v) - l.qty_sistem
      return <span className={clsx('font-bold', d > 0 ? 'text-emerald-700' : d < 0 ? 'text-red-600' : 'text-slate-400')}>{d > 0 ? `+${d}` : d}</span>
    } } as ColumnDef<Line>] : []),
    ...(!o.is_opening ? [{ id: 'alasan', header: 'Alasan selisih', enableSorting: false, cell: ({ row: { original: l } }: { row: { original: Line } }) => {
      const v = val(l); const has = v.qty_fisik !== '' && Number(v.qty_fisik) !== l.qty_sistem
      if (!has) return null
      return draft ? <Input aria-label={`Alasan selisih ${l.sku_code}`} value={v.alasan} onChange={(e) => edit(l, { alasan: e.target.value })} placeholder="wajib diisi" aria-invalid={!v.alasan.trim() || undefined} className="h-9 min-w-48" />
        : <span className="text-sm">{l.alasan}</span>
    } } as ColumnDef<Line>] : []),
  ], [draft, showSys, local, o.is_opening]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = o.status === 'DRAFT' ? 1 : 2

  return (
    <Card
      title={<span className="flex items-center gap-2">{o.is_opening ? 'Opname awal (saldo awal)' : 'Stock opname'} {fmtDate(o.tanggal)} <Chip tone={o.status === 'DRAFT' ? 'amber' : 'brand'}>{OPNAME_STATUS_LABEL[o.status]}</Chip></span>}
      subtitle={`Dibuat ${o.created_by_nama ?? '—'} · ${fmtDateTime(o.created_at)}${o.catatan ? ` · ${o.catatan}` : ''}`}
      actions={<Stepper steps={['Buat lembar', 'Isi qty fisik', 'Approval admin']} current={step} />}
      bodyClass="p-0"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 text-sm">
        <span className="num"><b>{fmtNum(filled)}</b> / {fmtNum(rows.length)} baris terisi</span>
        {showSys && <span className="num text-muted">Selisih: <b className="text-emerald-700">+{fmtNum(plus)}</b> / <b className="text-red-600">−{fmtNum(minus)}</b> pcs di {diffs.length} baris</span>}
        {draft && <span className="hidden text-xs text-muted lg:inline">Tekan Enter untuk pindah ke baris berikutnya.</span>}
        {draft && (
          <span className="text-xs text-muted" aria-live="polite">
            {saveState.saving ? <><Loader2 className="mr-1 inline size-3 animate-spin" />Menyimpan…</> : saveState.error ? <span className="text-red-600">{saveState.error}</span>
              : dirty.size ? 'Perubahan belum tersimpan…' : saveState.at ? <><CheckCircle2 className="mr-1 inline size-3 text-emerald-600" />Tersimpan otomatis {fmtDateTime(saveState.at).split(', ')[1]}</> : 'Perubahan tersimpan otomatis'}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {o.is_opening && <Button size="sm" variant="ghost" icon={showSys ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} onClick={() => setShowSys(!showSys)}>{showSys ? 'Sembunyikan' : 'Tampilkan'} qty sistem</Button>}
          <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => exportXlsx(`lembar-opname-${o.id}`, rows, [
            { header: 'sku_code', value: (l) => l.sku_code }, { header: 'nama_sku', value: (l) => l.sku_label },
            { header: 'stock_status', value: (l) => l.stock_status }, { header: 'qty_fisik', value: (l) => l.qty_fisik ?? '' }, { header: 'alasan', value: (l) => l.alasan ?? '' },
          ], 'Lembar hitung')}>Unduh lembar hitung</Button>
          {draft && <>
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>Upload hasil hitung</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void uploadSheet(e.target.files?.[0]); e.target.value = '' }} />
          </>}
        </div>
      </div>

      <DataTable data={rows} columns={columns} loading={lines.isLoading} searchKeys={['sku_code', 'sku_label']} searchPlaceholder="Cari SKU…" pageSize={100} dense />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50/60 px-5 py-4">
        <div className="flex gap-2">
          {canWrite && <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirm('cancel')}>Batalkan opname</Button>}
          {draft && filled < rows.length && <Button variant="ghost" onClick={() => setConfirm('fillzero')}>Isi baris kosong dengan 0</Button>}
        </div>
        {o.status === 'DRAFT' && canWrite && (
          <div className="flex items-center gap-3">
            {(filled < rows.length || needReason > 0) && <span className="text-xs text-amber-700">{filled < rows.length ? `${rows.length - filled} baris belum diisi` : `${needReason} selisih belum ada alasan`}</span>}
            <Button variant="primary" disabled={filled < rows.length || needReason > 0 || saveState.saving} onClick={() => setConfirm('submit')}>Ajukan untuk approval</Button>
          </div>
        )}
        {o.status === 'SUBMITTED' && (isAdmin ? (
          <div className="flex gap-2">
            <Button onClick={() => setConfirm('reopen')}>Kembalikan ke draft</Button>
            <Button variant="primary" onClick={() => setConfirm('approve')}>Setujui opname</Button>
          </div>
        ) : <span className="text-sm text-muted">Menunggu approval admin Ops Support.</span>)}
      </div>

      <ConfirmDialog open={confirm === 'submit'} onOpenChange={() => setConfirm(null)} title="Ajukan opname untuk approval?" confirmLabel="Ajukan" loading={submit.isPending} onConfirm={runConfirm}>
        Setelah diajukan, qty tidak bisa diubah kecuali admin mengembalikannya ke draft.
        {showSys && <p className="mt-2">Selisih: <b>+{plus}</b> / <b>−{minus}</b> pcs di {diffs.length} baris.</p>}
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'approve'} onOpenChange={() => setConfirm(null)} title="Setujui opname?" confirmLabel="Setujui & buat transaksi" loading={approve.isPending} onConfirm={runConfirm}
        irreversible typeToConfirm="SETUJU">
        {o.is_opening
          ? <p>Sistem membuat transaksi <b>saldo awal (OPENING)</b> untuk setiap SKU dengan qty fisik &gt; 0, total <b>{fmtNum(rows.reduce((a, l) => a + (l.qty_fisik ?? 0), 0))} pcs</b>.</p>
          : <p>Sistem membuat transaksi <b>penyesuaian (ADJ)</b> untuk {diffs.length} baris: <b>+{plus}</b> / <b>−{minus}</b> pcs.</p>}
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'cancel'} onOpenChange={() => setConfirm(null)} title="Batalkan opname ini?" confirmLabel="Batalkan opname" danger loading={cancel.isPending} onConfirm={runConfirm}>
        Qty yang sudah diisi dibuang dan stok tidak berubah.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'reopen'} onOpenChange={() => setConfirm(null)} title="Kembalikan ke draft?" confirmLabel="Kembalikan" loading={reopen.isPending} onConfirm={runConfirm}>
        Staf bisa memperbaiki qty lalu mengajukan ulang.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'fillzero'} onOpenChange={() => setConfirm(null)} title={`Isi ${rows.length - filled} baris kosong dengan 0?`} confirmLabel="Isi dengan 0" onConfirm={runConfirm}>
        Gunakan hanya bila barang untuk SKU tersebut memang tidak ada di gudang.
      </ConfirmDialog>
    </Card>
  )
}

function HistoryCard({ rows, loading }: { rows?: Opname[]; loading: boolean }) {
  const columns = useMemo<ColumnDef<Opname>[]>(() => [
    { accessorKey: 'id', header: '#', meta: { align: 'right', className: 'w-14' } },
    { accessorKey: 'tanggal', header: 'Tanggal hitung', cell: (c) => fmtDate(c.getValue() as string) },
    { accessorKey: 'is_opening', header: 'Jenis', cell: (c) => (c.getValue() ? 'Saldo awal' : 'Opname berkala'), meta: { exportValue: (o) => (o.is_opening ? 'Saldo awal' : 'Opname berkala') } },
    { accessorKey: 'status', header: 'Status', cell: (c) => { const s = c.getValue() as string; return <Chip tone={s === 'APPROVED' ? 'green' : s === 'DIBATALKAN' ? 'slate' : 'amber'}>{OPNAME_STATUS_LABEL[s]}</Chip> } },
    { accessorKey: 'jumlah_selisih', header: 'Baris selisih', meta: { align: 'right' }, cell: ({ row: { original: o } }) => (o.is_opening ? <span className="text-muted">— (saldo awal)</span> : o.jumlah_selisih) },
    { accessorKey: 'created_by_nama', header: 'Dibuat oleh' },
    { accessorKey: 'approved_by_nama', header: 'Disetujui', cell: ({ row: { original: o } }) => o.approved_at ? `${o.approved_by_nama} · ${fmtDateTime(o.approved_at)}` : '—' },
  ], [])
  return (
    <Card title="Riwayat opname" bodyClass="p-0">
      <DataTable data={rows?.filter((o) => o.status === 'APPROVED' || o.status === 'DIBATALKAN')} columns={columns} loading={loading} exportName="riwayat-opname" pageSize={10}
        empty={<p className="p-8 text-center text-sm text-muted">Belum ada opname yang selesai.</p>} />
    </Card>
  )
}

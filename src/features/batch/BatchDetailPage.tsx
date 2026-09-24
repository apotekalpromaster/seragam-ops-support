import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { ArrowLeft, CheckCircle2, FileText, Link2, Paperclip, Printer, Tag, Truck, Undo2, Upload, XCircle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog, Modal } from '../../components/dialog'
import { Stepper } from '../../components/Stepper'
import { Button, Callout, Card, Chip, EmptyState, Field, Input, LoadingBlock, Tabs, Textarea } from '../../components/ui'
import { useDb, useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { toAppError } from '../../lib/errors'
import { fmtDate, fmtDateTime, fmtMonth, fmtNum, isoToday } from '../../lib/format'
import { BATCH_JENIS_LABEL, BATCH_STATUS_LABEL, CAKUPAN_LABEL, PENYERAHAN_LABEL } from '../../lib/labels'
import { EmployeeCard } from '../employee/EmployeeCard'
import type { BatchRow } from './BatchListPage'

interface Branch { batch_id: number; kode_cabang: string; cabang_nama: string; area: string | null; alamat: string | null; received_at: string | null; received_by_nama: string | null; recorded_at: string | null; bast_path: string | null; catatan: string | null; jumlah_karyawan: number; jumlah_pcs: number }
export interface Line {
  id: number; batch_id: number; nik: string; kode_cabang: string; item_code: string; sku_code: string; qty: number; nama: string; jabatan: string
  employee_status: string; planned_join_date: string | null; join_date: string | null; is_late_hire: boolean; sku_label: string; size_code: string
  item_nama: string; item_sort: number; cabang_nama: string; area: string | null; received_at: string | null; penyerahan: string; batch_kode: string
}
interface Short { nik: string; nama: string; jabatan: string; cabang_nama: string; sku_code: string; sku_label: string; qty: number; available: number }

const STEPS = ['DRAFT', 'PICKING', 'PACKED', 'SHIPPED', 'SELESAI']
const PENYERAHAN_TONE: Record<string, 'slate' | 'blue' | 'violet' | 'green'> = { DISIAPKAN: 'slate', DIKIRIM: 'blue', DITAHAN_APA: 'violet', DITERIMA: 'green', DIBATALKAN: 'slate' }
export const BAST_BUCKET = 'seragam-bast'

export default function BatchDetailPage() {
  const { id } = useParams()
  const batchId = Number(id)
  const bq = useView<BatchRow>('v_batch', { filters: [['id', 'eq', batchId]] })
  const b = bq.data?.[0]
  const { canWrite, isAdmin } = usePerm()
  const nav = useNavigate()
  const [tab, setTab] = useState<'cabang' | 'baris' | 'kurang' | 'dokumen'>('cabang')
  const [act, setAct] = useState<'next' | 'back' | 'cancel' | null>(null)
  const [tglKirim, setTglKirim] = useState(isoToday())
  const [alasan, setAlasan] = useState('')
  const setStatus = useRpc<unknown, { issue?: number }>('fn_batch_set_status', { success: (r) => (r.issue ? `Batch dikirim. ${r.issue} transaksi "Kirim ke karyawan" dicatat; stok berkurang.` : 'Status batch diperbarui.') })
  const cancel = useRpc('fn_batch_cancel', { success: 'Batch dibatalkan. Stok yang dipesan dilepas kembali ke antrian.' })

  if (bq.isLoading) return <Page title="Batch"><Card><LoadingBlock /></Card></Page>
  if (!b) return <Page title="Batch"><Card><EmptyState title="Batch tidak ditemukan" action={<Link to="/batch"><Button>Kembali ke daftar batch</Button></Link>} /></Card></Page>

  const idx = STEPS.indexOf(b.status)
  const open = ['DRAFT', 'PICKING', 'PACKED'].includes(b.status)
  const next = { DRAFT: 'PICKING', PICKING: 'PACKED', PACKED: 'SHIPPED' }[b.status as 'DRAFT']
  const prev = { PICKING: 'DRAFT', PACKED: 'PICKING' }[b.status as 'PICKING']
  const nextLabel = { DRAFT: 'Mulai picking', PICKING: 'Selesai packing', PACKED: 'Tandai sudah dikirim' }[b.status as 'DRAFT']
  const cak = (b.cakupan?.cakupan as string) ?? 'SEMUA'

  async function run() {
    try {
      if (act === 'next') await setStatus.mutateAsync({ batch_id: b!.id, status: next, tanggal: tglKirim })
      if (act === 'back') await setStatus.mutateAsync({ batch_id: b!.id, status: prev })
      if (act === 'cancel') await cancel.mutateAsync({ batch_id: b!.id, alasan })
    } catch { /* toast */ }
    setAct(null)
  }

  return (
    <Page title={`Batch ${b.kode}`} help="batch"
      subtitle={`${BATCH_JENIS_LABEL[b.jenis]} · periode ${fmtMonth(b.periode)} · cakupan ${CAKUPAN_LABEL[cak] ?? cak}`}
      actions={<Button icon={<ArrowLeft className="size-4" />} onClick={() => nav('/batch')}>Daftar batch</Button>}>
      <Card bodyClass="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            {b.status === 'DIBATALKAN' ? <Chip tone="slate">Dibatalkan — {b.alasan_batal}</Chip> : <Stepper steps={['Draft', 'Picking', 'Packed', 'Dikirim', 'Selesai']} current={b.status === 'SELESAI' ? 5 : idx} />}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Deadline kirim <b className={clsx(b.terlambat && 'text-red-600')}>{fmtDate(b.deadline_kirim)}</b>{b.terlambat && b.status !== 'DIBATALKAN' && <Chip tone="red" className="ml-1">terlambat</Chip>}</span>
              {b.shipped_at && <span>Dikirim <b>{fmtDate(b.shipped_at)}</b> oleh {b.shipped_by_nama ?? '—'}</span>}
              <span className="text-muted">Dibuat {b.created_by_nama ?? '—'} · {fmtDateTime(b.created_at)}</span>
            </div>
          </div>
          {canWrite && b.status !== 'DIBATALKAN' && (
            <div className="flex flex-wrap items-center gap-2">
              {open && <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<XCircle className="size-4" />} onClick={() => setAct('cancel')}>Batalkan batch</Button>}
              {prev && <Button icon={<Undo2 className="size-4" />} onClick={() => setAct('back')}>Kembali ke {BATCH_STATUS_LABEL[prev].toLowerCase()}</Button>}
              {next && <Button variant="primary" icon={next === 'SHIPPED' ? <Truck className="size-4" /> : undefined} onClick={() => setAct('next')}>{nextLabel}</Button>}
              {b.status === 'SHIPPED' && <span className="text-sm text-muted">Menunggu konfirmasi terima {b.jumlah_cabang - b.cabang_diterima} cabang</span>}
            </div>
          )}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          <Mini label="Karyawan" value={b.jumlah_karyawan} />
          <Mini label="Total pcs" value={b.jumlah_pcs} />
          <Mini label="Cabang" value={b.jumlah_cabang} />
          <Mini label="Cabang sudah terima" value={b.cabang_diterima} tone={b.cabang_diterima === b.jumlah_cabang && b.jumlah_cabang > 0 ? 'green' : undefined} />
          <Mini label="Baris kurang stok" value={b.jumlah_shortage} tone={b.jumlah_shortage ? 'red' : undefined} />
        </div>
        {open && <p className="mt-3 text-xs text-muted">Stok untuk batch ini sudah dipesan (reserved) dan tidak bisa dipakai batch lain. Stok baru berkurang saat ditandai dikirim.</p>}
        {b.catatan && <p className="mt-2 text-sm">Catatan: {b.catatan}</p>}
      </Card>

      <Tabs value={tab} onChange={setTab} items={[
        { value: 'cabang', label: 'Per cabang', count: b.jumlah_cabang },
        { value: 'baris', label: 'Baris karyawan', count: b.jumlah_baris },
        { value: 'kurang', label: 'Kekurangan stok', count: b.jumlah_shortage },
        { value: 'dokumen', label: 'Dokumen cetak' },
      ]} />
      {tab === 'cabang' && <BranchTab b={b} canWrite={canWrite} isAdmin={isAdmin} />}
      {tab === 'baris' && <LinesTab b={b} canWrite={canWrite && open} />}
      {tab === 'kurang' && <ShortTab id={b.id} />}
      {tab === 'dokumen' && <DocsTab b={b} />}

      <ConfirmDialog open={act === 'next' && next !== 'SHIPPED'} onOpenChange={() => setAct(null)} title={`${nextLabel}?`} confirmLabel={nextLabel ?? ''} loading={setStatus.isPending} onConfirm={run}>
        {next === 'PICKING' ? 'Tim gudang mulai mengambil barang sesuai pick list. Batch masih bisa dikembalikan ke draft.' : 'Semua paket sudah dikemas per karyawan dan diberi label.'}
      </ConfirmDialog>
      <ConfirmDialog open={act === 'next' && next === 'SHIPPED'} onOpenChange={() => setAct(null)} title="Tandai batch sudah dikirim?" confirmLabel="Tandai dikirim" loading={setStatus.isPending} onConfirm={run}
        irreversible typeToConfirm="KIRIM">
        <p>Sistem mencatat <b>{fmtNum(b.jumlah_baris)} transaksi "Kirim ke karyawan"</b> ({fmtNum(b.jumlah_pcs)} pcs) ke {fmtNum(b.jumlah_cabang)} cabang. Stok layak berkurang dan hak karyawan tercatat terpenuhi.</p>
        <Field label="Tanggal kirim" hint={`Deadline ${fmtDate(b.deadline_kirim)}. Isi tanggal barang benar-benar dikirim.`}>
          <Input type="date" value={tglKirim} max={isoToday()} onChange={(e) => setTglKirim(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={act === 'back'} onOpenChange={() => setAct(null)} title={`Kembalikan ke ${prev ? BATCH_STATUS_LABEL[prev].toLowerCase() : ''}?`} confirmLabel="Kembalikan" loading={setStatus.isPending} onConfirm={run}>
        Gunakan bila perlu mengeluarkan baris atau mengulang picking.
      </ConfirmDialog>
      <ConfirmDialog open={act === 'cancel'} onOpenChange={() => { setAct(null); setAlasan('') }} title={`Batalkan batch ${b.kode}?`} confirmLabel="Batalkan batch" danger loading={cancel.isPending} onConfirm={run}>
        <p>Stok yang dipesan dilepas dan semua karyawan kembali ke antrian.</p>
        <Field label="Alasan" required><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah cakupan cabang" /></Field>
      </ConfirmDialog>
    </Page>
  )
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'green' }) {
  return (
    <div className={clsx('rounded-xl border px-3 py-2', tone === 'red' ? 'border-red-200 bg-red-50' : tone === 'green' ? 'border-emerald-200 bg-emerald-50' : 'border-line bg-slate-50/60')}>
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('text-xl font-extrabold num', tone === 'red' && 'text-red-600', tone === 'green' && 'text-emerald-700')}>{fmtNum(value)}</p>
    </div>
  )
}

function BastLink({ path }: { path: string }) {
  const db = useDb()
  return (
    <button className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline" onClick={async (e) => {
      e.stopPropagation()
      try { window.open(await db.fileUrl(BAST_BUCKET, path), '_blank', 'noopener') } catch (x) { toast.error(toAppError(x).message) }
    }}><Paperclip className="size-3.5" /> Lihat BAST</button>
  )
}

function BranchTab({ b, canWrite, isAdmin }: { b: BatchRow; canWrite: boolean; isAdmin: boolean }) {
  const q = useView<Branch>('v_batch_branch', { filters: [['batch_id', 'eq', b.id]], order: [['cabang_nama', 'asc']] })
  const [recv, setRecv] = useState<Branch | null>(null)
  const [undo, setUndo] = useState<Branch | null>(null)
  const un = useRpc('fn_batch_unreceive', { success: 'Konfirmasi terima dibatalkan.' })
  const shipped = ['SHIPPED', 'SELESAI'].includes(b.status)
  const columns = useMemo<ColumnDef<Branch>[]>(() => [
    { accessorKey: 'cabang_nama', header: 'Cabang', cell: ({ row: { original: r } }) => <div><p className="font-semibold">{r.cabang_nama}</p><p className="text-xs text-muted">{r.kode_cabang} · {r.area}</p></div> },
    { accessorKey: 'alamat', header: 'Alamat kirim', cell: (c) => <span className="text-xs text-muted">{(c.getValue() as string) ?? '—'}</span> },
    { accessorKey: 'jumlah_karyawan', header: 'Karyawan', meta: { align: 'right' } },
    { accessorKey: 'jumlah_pcs', header: 'Pcs', meta: { align: 'right' } },
    { accessorKey: 'received_at', header: 'Status terima', cell: ({ row: { original: r } }) => r.received_at ? (
      <div><Chip tone="green"><CheckCircle2 className="size-3" /> Diterima {fmtDate(r.received_at)}</Chip><p className="mt-0.5 text-xs text-muted">dicatat {r.received_by_nama ?? '—'}</p></div>
    ) : shipped ? <Chip tone="blue">Dalam pengiriman</Chip> : <Chip tone="slate">Belum dikirim</Chip>, meta: { exportValue: (r) => (r.received_at ? `Diterima ${r.received_at}` : 'Belum') } },
    { id: 'bast', header: 'BAST', enableSorting: false, meta: { noExport: true }, cell: ({ row: { original: r } }) => r.bast_path ? <BastLink path={r.bast_path} /> : <span className="text-xs text-slate-300">—</span> },
    { id: 'aksi', header: '', enableSorting: false, meta: { noExport: true }, cell: ({ row: { original: r } }) => (
      !shipped || !canWrite ? null : !r.received_at
        ? <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />} title="Salin link konfirmasi untuk APA cabang ini"
              onClick={async (e) => {
                e.stopPropagation()
                const url = `${window.location.origin}/apa?batch=${b.id}`
                try { await navigator.clipboard.writeText(url); toast.success('Link konfirmasi disalin', { description: `Kirim ke APA ${r.cabang_nama}. APA login dengan akunnya, lalu konfirmasi terima + unggah BAST.` }) }
                catch { toast.info(url, { description: 'Salin link ini dan kirim ke APA.' }) }
              }}>Link APA</Button>
            <Button size="sm" variant="soft" onClick={() => setRecv(r)}>Konfirmasi terima</Button>
          </div>
        : isAdmin ? <Button size="sm" variant="ghost" onClick={() => setUndo(r)}>Batalkan</Button> : null
    ) },
  ], [shipped, canWrite, isAdmin])
  return (
    <Card bodyClass="p-0">
      {shipped && b.cabang_diterima < b.jumlah_cabang && (
        <div className="border-b border-line px-5 py-3 text-sm text-muted">APA mengonfirmasi sendiri lewat <b>Link APA</b> (login akun APA cabang), atau catat di sini setelah BAST bertanda tangan diterima. Batch otomatis <b>Selesai</b> saat semua cabang terkonfirmasi.</div>
      )}
      <DataTable data={q.data} columns={columns} loading={q.isLoading} searchKeys={['cabang_nama', 'kode_cabang']} searchPlaceholder="Cari cabang…" exportName={`cabang-${b.kode}`} />
      {recv && <ReceiveModal batch={b} branch={recv} onClose={() => setRecv(null)} />}
      <ConfirmDialog open={!!undo} onOpenChange={() => setUndo(null)} title={`Batalkan konfirmasi terima ${undo?.cabang_nama}?`} confirmLabel="Batalkan konfirmasi" loading={un.isPending}
        onConfirm={async () => { try { await un.mutateAsync({ batch_id: b.id, kode_cabang: undo!.kode_cabang }) } catch { /* toast */ } setUndo(null) }}>
        Gunakan bila konfirmasi tercatat ke cabang yang salah. File BAST tetap tersimpan.
      </ConfirmDialog>
    </Card>
  )
}

function ReceiveModal({ batch, branch, onClose }: { batch: BatchRow; branch: Branch; onClose: () => void }) {
  const db = useDb()
  const [tgl, setTgl] = useState(isoToday())
  const [file, setFile] = useState<File | null>(null)
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const m = useRpc<unknown, { selesai: boolean; cabang_belum: number }>('fn_batch_receive', {
    success: (r) => (r.selesai ? `${branch.cabang_nama} terkonfirmasi. Semua cabang sudah terima — batch selesai.` : `${branch.cabang_nama} terkonfirmasi. Tersisa ${r.cabang_belum} cabang.`),
  })
  const fileErr = file && file.size > 10 * 1024 * 1024 ? 'Ukuran file maksimal 10 MB.' : file && !/^(image\/|application\/pdf)/.test(file.type) ? 'Gunakan foto (JPG/PNG) atau PDF.' : null
  async function save() {
    setBusy(true)
    try {
      let path: string | undefined
      if (file) {
        path = `batch-${batch.id}/${branch.kode_cabang}-${Date.now()}.${(file.name.split('.').pop() ?? 'bin').toLowerCase()}`
        try {
          await db.uploadFile(BAST_BUCKET, path, file)
        } catch (e) {
          toast.error('Upload BAST gagal', { description: `${toAppError(e).message} Konfirmasi belum disimpan; coba lagi.` })
          return
        }
      }
      await m.mutateAsync({ batch_id: batch.id, kode_cabang: branch.kode_cabang, tanggal: tgl, bast_path: path, catatan })
      onClose()
    } catch { /* toast dari useRpc */ } finally { setBusy(false) }
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Konfirmasi terima — ${branch.cabang_nama}`} description={`${branch.jumlah_karyawan} karyawan · ${branch.jumlah_pcs} pcs · batch ${batch.kode}`}
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} disabled={!!fileErr} onClick={() => void save()}>Simpan konfirmasi</Button></>}>
      <div className="space-y-4">
        <Field label="Tanggal diterima cabang" required hint={`Tidak sebelum tanggal kirim (${fmtDate(batch.shipped_at)}).`}>
          <Input type="date" value={tgl} min={batch.shipped_at ?? undefined} max={isoToday()} onChange={(e) => setTgl(e.target.value)} />
        </Field>
        <Field label="Foto / scan BAST" hint="Dianjurkan. JPG, PNG, atau PDF maks. 10 MB." error={fileErr ?? undefined}>
          <div className="flex items-center gap-3">
            <Button icon={<Upload className="size-4" />} onClick={() => ref.current?.click()}>{file ? 'Ganti file' : 'Pilih file'}</Button>
            <span className="truncate text-sm text-muted">{file?.name ?? 'Belum ada file'}</span>
          </div>
          <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        {!file && <Callout tone="amber">Tanpa BAST, konfirmasi tetap tercatat tetapi tidak ada bukti serah terima.</Callout>}
        <Field label="Catatan"><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} className="min-h-14" placeholder="mis. 1 paket kurang label, sudah diperbaiki" /></Field>
      </div>
    </Modal>
  )
}

function LinesTab({ b, canWrite }: { b: BatchRow; canWrite: boolean }) {
  const q = useView<Line>('v_batch_line', { filters: [['batch_id', 'eq', b.id]], order: [['cabang_nama', 'asc'], ['nama', 'asc'], ['item_sort', 'asc']] })
  const [remove, setRemove] = useState<Line[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const rm = useRpc<unknown, { dikeluarkan: number }>('fn_batch_remove_lines', { success: (r) => `${r.dikeluarkan} baris dikeluarkan dan kembali ke antrian.` })
  const columns = useMemo<ColumnDef<Line>[]>(() => [
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: l } }) => (
      <div><p className="font-semibold">{l.nama} {l.is_late_hire && <Chip tone="violet">hire mendadak</Chip>}</p><p className="text-xs text-muted">{l.nik} · {l.jabatan}</p></div>
    ) },
    { accessorKey: 'nik', header: 'NIK', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'cabang_nama', header: 'Cabang' },
    { accessorKey: 'sku_label', header: 'Item', cell: ({ row: { original: l } }) => <div><p>{l.sku_label}</p><code className="text-xs text-muted">{l.sku_code}</code></div> },
    { accessorKey: 'qty', header: 'Qty', meta: { align: 'right' } },
    { accessorKey: 'penyerahan', header: 'Status', cell: ({ row: { original: l } }) => (
      <div><Chip tone={PENYERAHAN_TONE[l.penyerahan]}>{PENYERAHAN_LABEL[l.penyerahan]}</Chip>
        {l.penyerahan === 'DITAHAN_APA' && <p className="mt-0.5 text-xs text-muted">serahkan saat join {fmtDate(l.planned_join_date)}</p>}
        {l.employee_status !== 'AKTIF' && l.employee_status !== 'OFFERING' && <Chip tone="red" className="mt-0.5">karyawan {l.employee_status.toLowerCase()}</Chip>}
      </div>
    ), meta: { exportValue: (l) => PENYERAHAN_LABEL[l.penyerahan] } },
  ], [])
  return (
    <Card bodyClass="p-0">
      <DataTable data={q.data} columns={columns} loading={q.isLoading} searchKeys={['nik', 'nama', 'cabang_nama', 'sku_code']} searchPlaceholder="Cari NIK / nama / cabang / SKU…"
        exportName={`baris-${b.kode}`} dense selectable={canWrite} getRowId={(l) => String(l.id)} onRowClick={(l) => setOpen(l.nik)}
        rowClassName={(l) => (!['AKTIF', 'OFFERING'].includes(l.employee_status) ? 'bg-red-50/50' : undefined)}
        bulkActions={(rows, clear) => <Button size="sm" variant="danger" onClick={() => { setRemove(rows); clear() }}>Keluarkan {rows.length} baris dari batch</Button>} />
      <ConfirmDialog open={!!remove} onOpenChange={() => setRemove(null)} title={`Keluarkan ${remove?.length} baris?`} confirmLabel="Keluarkan" danger loading={rm.isPending}
        onConfirm={async () => { try { await rm.mutateAsync({ batch_id: b.id, line_ids: remove!.map((l) => l.id) }) } catch { /* toast */ } setRemove(null) }}>
        Stok yang dipesan untuk baris ini dilepas; karyawan kembali ke antrian dan bisa masuk batch berikutnya.
      </ConfirmDialog>
      {open && <EmployeeCard nik={open} onClose={() => setOpen(null)} />}
    </Card>
  )
}

function ShortTab({ id }: { id: number }) {
  const q = useView<Short>('v_batch_shortage', { filters: [['batch_id', 'eq', id]], order: [['sku_label', 'asc']] })
  const columns = useMemo<ColumnDef<Short>[]>(() => [
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: s } }) => <div><p className="font-semibold">{s.nama}</p><p className="text-xs text-muted">{s.nik} · {s.jabatan}</p></div> },
    { accessorKey: 'cabang_nama', header: 'Cabang' },
    { accessorKey: 'sku_label', header: 'SKU' },
    { accessorKey: 'qty', header: 'Dibutuhkan', meta: { align: 'right' } },
    { accessorKey: 'available', header: 'Tersisa saat batch dibuat', meta: { align: 'right' }, cell: (c) => Math.max(0, c.getValue() as number) },
  ], [])
  return (
    <Card bodyClass="p-0">
      <p className="border-b border-line px-5 py-3 text-sm text-muted">Baris ini <b>tidak</b> masuk batch dan tetap di antrian. Setelah stok masuk (PO diterima), buat batch ad-hoc susulan.</p>
      <DataTable data={q.data} columns={columns} loading={q.isLoading} exportName={`kekurangan-stok-${id}`} searchKeys={['nama', 'sku_label']}
        empty={<p className="p-8 text-center text-sm text-muted">Semua baris antrian tercukupi stoknya saat batch dibuat.</p>} />
    </Card>
  )
}

function DocsTab({ b }: { b: BatchRow }) {
  const docs = [
    { doc: 'pick', icon: <FileText className="size-5" />, title: 'Pick list', desc: 'Total per SKU untuk diambil dari rak gudang.' },
    { doc: 'packing', icon: <FileText className="size-5" />, title: 'Packing list per cabang', desc: 'Rincian per karyawan untuk setiap cabang (satu halaman per cabang).' },
    { doc: 'label', icon: <Tag className="size-5" />, title: 'Label nama', desc: 'Satu label per paket karyawan, ditempel di plastik paket.' },
    { doc: 'bast', icon: <FileText className="size-5" />, title: 'Form BAST', desc: 'Berita acara serah terima per cabang untuk ditandatangani APA/BM.' },
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {docs.map((d) => (
        <Card key={d.doc} bodyClass="p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{d.icon}</div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{d.title}</p>
              <p className="mt-0.5 text-sm text-muted">{d.desc}</p>
              <Link to={`/cetak/batch/${b.id}/${d.doc}`} className="mt-3 inline-block"><Button size="sm" icon={<Printer className="size-3.5" />}>Buka & cetak</Button></Link>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

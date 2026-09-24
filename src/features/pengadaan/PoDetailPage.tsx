import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { ArrowLeft, PackageCheck, Pencil, Plus, Printer, Send, Undo2, X, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog, Modal } from '../../components/dialog'
import { Stepper } from '../../components/Stepper'
import { Button, Callout, Card, Chip, EmptyState, Field, Input, LoadingBlock, Select, Tabs, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtDateTime, fmtNum, fmtRp, isoToday } from '../../lib/format'
import { PO_STATUS_LABEL } from '../../lib/labels'
import type { PoRow } from './PengadaanPage'

export interface PoLine {
  po_id: number; po_kode: string; sku_code: string; sku_label: string; item_sort: number; gender: string; size_order: number; moq: number
  qty_order: number; qty_received: number; sisa: number; harga: number | null; nilai: number | null; saran: number | null
}
interface Receipt {
  id: number; po_id: number; tanggal: string; no_surat_jalan: string | null; catatan: string | null; created_by_nama: string | null; created_at: string
  pcs: number; lines: { sku_code: string; label: string; qty: number; dikoreksi: boolean }[]
}

const STEP: Record<string, number> = { DRAFT: 0, SENT: 1, PARTIAL: 2, RECEIVED: 4 }

export default function PoDetailPage() {
  const { id } = useParams()
  const poId = Number(id)
  const q = useView<PoRow>('v_po', { filters: [['id', 'eq', poId]] })
  const lines = useView<PoLine>('v_po_line', { filters: [['po_id', 'eq', poId]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  const receipts = useView<Receipt>('v_po_receipt', { filters: [['po_id', 'eq', poId]], order: [['id', 'desc']] })
  const po = q.data?.[0]
  const { canWrite, isAdmin } = usePerm()
  const nav = useNavigate()
  const [tab, setTab] = useState<'sku' | 'terima'>('sku')
  const [act, setAct] = useState<'send' | 'unsend' | 'cancel' | 'close' | 'receive' | 'edit' | null>(null)
  const [tgl, setTgl] = useState(isoToday())
  const [alasan, setAlasan] = useState('')
  const send = useRpc<unknown, { eta: string }>('fn_po_send', { success: (r) => `PO dikirim ke vendor. Perkiraan tiba ${fmtDate(r.eta)}; qty mulai dihitung "dalam pemesanan".` })
  const unsend = useRpc('fn_po_unsend', { success: 'PO kembali ke draft.' })
  const cancel = useRpc('fn_po_cancel', { success: 'PO dibatalkan.' })
  const close = useRpc<unknown, { sisa_dilepas: number }>('fn_po_close', { success: (r) => `PO ditutup. Sisa ${r.sisa_dilepas} pcs tidak lagi dihitung dalam pemesanan.` })

  if (q.isLoading) return <Page title="Purchase order"><Card><LoadingBlock /></Card></Page>
  if (!po) return <Page title="Purchase order"><Card><EmptyState title="PO tidak ditemukan" action={<Link to="/pengadaan?tab=po"><Button>Kembali ke daftar PO</Button></Link>} /></Card></Page>

  const running = po.status === 'SENT' || po.status === 'PARTIAL'
  const close_ = () => { setAct(null); setAlasan('') }
  // Dialog hanya ditutup bila berhasil; bila gagal, isian tetap ada dan pesan error tampil sebagai toast.
  async function run(fn: () => Promise<unknown>) { try { await fn(); close_() } catch { /* toast */ } }

  return (
    <Page title={po.kode} help="pengadaan" subtitle={`Purchase order · ${po.vendor_nama}${po.vendor_kontak ? ` · ${po.vendor_kontak}` : ''}`}
      actions={<>
        <Link to={`/cetak/po/${po.id}`}><Button icon={<Printer className="size-4" />}>Cetak PO</Button></Link>
        <Button icon={<ArrowLeft className="size-4" />} onClick={() => nav('/pengadaan?tab=po')}>Daftar PO</Button>
      </>}>
      <Card bodyClass="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            {po.status === 'CANCELLED'
              ? <Chip tone="slate">Dibatalkan — {po.alasan_batal}</Chip>
              : <Stepper steps={['Draft', 'Dikirim ke vendor', 'Diterima sebagian', 'Diterima lengkap']} current={STEP[po.status]} />}
            {po.ditutup_kurang && <Callout tone="amber">PO ditutup sebelum lengkap: {po.alasan_tutup}. Sisa {fmtNum(po.sisa)} pcs tidak dihitung dalam pemesanan.</Callout>}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Tanggal PO <b>{fmtDate(po.tanggal)}</b></span>
              {po.sent_at && <span>Dikirim ke vendor <b>{fmtDate(po.sent_at)}</b>{po.sent_by_nama ? ` oleh ${po.sent_by_nama}` : ''}</span>}
              <span>Perkiraan tiba <b className={clsx(po.terlambat && 'text-red-600')}>{fmtDate(po.eta, 'otomatis saat dikirim')}</b>{po.terlambat && <Chip tone="red" className="ml-1">lewat ETA</Chip>}</span>
              <span className="text-muted">Dibuat {po.created_by_nama ?? '—'} · {fmtDateTime(po.created_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (po.status === 'DRAFT' || po.status === 'SENT') && (
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<XCircle className="size-4" />} onClick={() => setAct('cancel')}>Batalkan PO</Button>
            )}
            {isAdmin && po.status === 'SENT' && <Button icon={<Undo2 className="size-4" />} onClick={() => setAct('unsend')}>Kembali ke draft</Button>}
            {isAdmin && po.status === 'PARTIAL' && <Button icon={<XCircle className="size-4" />} onClick={() => setAct('close')}>Tutup PO (sisa tidak dikirim)</Button>}
            {isAdmin && po.status === 'DRAFT' && <Button icon={<Pencil className="size-4" />} onClick={() => setAct('edit')}>Ubah</Button>}
            {isAdmin && po.status === 'DRAFT' && <Button variant="primary" icon={<Send className="size-4" />} onClick={() => { setTgl(isoToday()); setAct('send') }}>Kirim ke vendor</Button>}
            {canWrite && running && <Button variant="primary" icon={<PackageCheck className="size-4" />} onClick={() => setAct('receive')}>Terima barang</Button>}
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          <Mini label="SKU" value={fmtNum(po.jumlah_sku)} />
          <Mini label="Dipesan" value={`${fmtNum(po.qty_order)} pcs`} />
          <Mini label="Diterima" value={`${fmtNum(po.qty_received)} pcs`} tone={po.status === 'RECEIVED' && !po.ditutup_kurang ? 'green' : undefined} />
          <Mini label="Sisa" value={`${fmtNum(po.sisa)} pcs`} tone={po.terlambat ? 'red' : undefined} />
          <Mini label="Nilai (price list)" value={fmtRp(po.nilai)} />
        </div>
        {po.status === 'DRAFT' && <p className="mt-3 text-xs text-muted">PO draft belum dihitung sebagai "dalam pemesanan" di saran order. Kirim ke vendor setelah isi PO final.</p>}
        {po.catatan && <p className="mt-2 text-sm">Catatan: {po.catatan}</p>}
      </Card>

      <Tabs value={tab} onChange={setTab} items={[
        { value: 'sku', label: 'Rincian SKU', count: po.jumlah_sku },
        { value: 'terima', label: 'Riwayat penerimaan', count: po.jumlah_penerimaan },
      ]} />
      {tab === 'sku' && <LinesTable po={po} lines={lines} />}
      {tab === 'terima' && <ReceiptList receipts={receipts} />}

      <ConfirmDialog open={act === 'send'} onOpenChange={close_} title={`Kirim ${po.kode} ke vendor?`} confirmLabel="Tandai terkirim" loading={send.isPending}
        onConfirm={() => run(() => send.mutateAsync({ id: po.id, tanggal: tgl }))}>
        <p>{fmtNum(po.qty_order)} pcs ({po.jumlah_sku} SKU) ke <b>{po.vendor_nama}</b>. Setelah ini qty dihitung "dalam pemesanan" dan PO tidak bisa diubah (kecuali dikembalikan ke draft sebelum barang datang).</p>
        <Field label="Tanggal PO dikirim ke vendor" hint={po.eta ? `Perkiraan tiba ${fmtDate(po.eta)}` : 'Perkiraan tiba otomatis = tanggal kirim + lead time terpanjang.'}>
          <Input type="date" value={tgl} min={po.tanggal} max={isoToday()} onChange={(e) => setTgl(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={act === 'unsend'} onOpenChange={close_} title="Kembalikan ke draft?" confirmLabel="Kembalikan" loading={unsend.isPending}
        onConfirm={() => run(() => unsend.mutateAsync({ id: po.id }))}>
        Gunakan bila isi PO perlu diubah sebelum vendor mengirim barang. Qty tidak lagi dihitung dalam pemesanan.
      </ConfirmDialog>
      <ConfirmDialog open={act === 'cancel'} onOpenChange={close_} title={`Batalkan ${po.kode}?`} confirmLabel="Batalkan PO" danger loading={cancel.isPending} disabled={alasan.trim().length < 3}
        onConfirm={() => run(() => cancel.mutateAsync({ id: po.id, alasan }))}>
        <p>PO tetap tersimpan sebagai riwayat dengan status dibatalkan.</p>
        <Field label="Alasan" required htmlFor="po-alasan" hint="Minimal 3 karakter."><Input id="po-alasan" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. dobel dengan PO lain" /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={act === 'close'} onOpenChange={close_} title={`Tutup ${po.kode}?`} confirmLabel="Tutup PO" danger loading={close.isPending} disabled={alasan.trim().length < 3}
        onConfirm={() => run(() => close.mutateAsync({ id: po.id, alasan }))}>
        <p>Sisa <b>{fmtNum(po.sisa)} pcs</b> dianggap tidak akan dikirim vendor dan tidak lagi dihitung dalam pemesanan. Saran order akan menghitung ulang kebutuhannya.</p>
        <Field label="Alasan" required htmlFor="po-alasan-tutup" hint="Minimal 3 karakter."><Input id="po-alasan-tutup" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. vendor kehabisan kain untuk ukuran 4XL" /></Field>
      </ConfirmDialog>
      {act === 'receive' && <ReceiveModal po={po} lines={lines.data ?? []} onClose={close_} />}
      {act === 'edit' && <EditPoModal po={po} lines={lines.data ?? []} onClose={close_} />}
    </Page>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'green' }) {
  return (
    <div className={clsx('rounded-xl border px-3 py-2', tone === 'red' ? 'border-red-200 bg-red-50' : tone === 'green' ? 'border-emerald-200 bg-emerald-50' : 'border-line bg-slate-50/60')}>
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('text-lg font-extrabold num', tone === 'red' && 'text-red-600', tone === 'green' && 'text-emerald-700')}>{value}</p>
    </div>
  )
}

function LinesTable({ po, lines }: { po: PoRow; lines: ReturnType<typeof useView<PoLine>> }) {
  const columns = useMemo<ColumnDef<PoLine>[]>(() => [
    { accessorKey: 'sku_label', header: 'SKU', cell: ({ row: { original: l } }) => <div><p className="font-semibold">{l.sku_label}</p><code className="text-xs text-muted">{l.sku_code}</code></div> },
    { accessorKey: 'sku_code', header: 'Kode', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'qty_order', header: 'Dipesan', meta: { align: 'right' }, cell: ({ row: { original: l } }) => <div>{fmtNum(l.qty_order)}{l.saran != null && l.saran !== l.qty_order && <p className="text-[11px] text-muted">saran {l.saran}</p>}</div> },
    { accessorKey: 'qty_received', header: 'Diterima', meta: { align: 'right' } },
    { accessorKey: 'sisa', header: 'Sisa', meta: { align: 'right' }, cell: (c) => (c.getValue() as number) ? <b className={clsx(po.ditutup_kurang && 'text-slate-400 line-through')}>{fmtNum(c.getValue() as number)}</b> : <Chip tone="green">lengkap</Chip> },
    { accessorKey: 'harga', header: 'Harga', meta: { align: 'right' }, cell: (c) => fmtRp(c.getValue() as number) },
    { accessorKey: 'nilai', header: 'Nilai', meta: { align: 'right' }, cell: (c) => fmtRp(c.getValue() as number) },
  ], [po.ditutup_kurang])
  return (
    <Card bodyClass="p-0">
      <DataTable data={lines.data} columns={columns} loading={lines.isLoading} exportName={`po-${po.kode}`} searchKeys={['sku_code', 'sku_label']} searchPlaceholder="Cari SKU…" dense />
    </Card>
  )
}

function ReceiptList({ receipts }: { receipts: ReturnType<typeof useView<Receipt>> }) {
  if (receipts.isLoading) return <Card><LoadingBlock rows={3} /></Card>
  if (!receipts.data?.length) return <Card><EmptyState icon={<PackageCheck className="size-5" />} title="Belum ada barang diterima">Catat penerimaan setiap kali barang dari vendor datang, sesuai surat jalan.</EmptyState></Card>
  return (
    <div className="space-y-3">
      {receipts.data.map((r) => (
        <Card key={r.id} bodyClass="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-bold">{fmtDate(r.tanggal)} · {fmtNum(r.pcs)} pcs{r.no_surat_jalan && <span className="font-normal text-muted"> · surat jalan {r.no_surat_jalan}</span>}</p>
            <p className="text-xs text-muted">dicatat {r.created_by_nama ?? '—'} · {fmtDateTime(r.created_at)}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.lines.map((l) => <Chip key={l.sku_code} tone={l.dikoreksi ? 'slate' : 'green'} title={l.dikoreksi ? 'Transaksi ini sudah dikoreksi' : undefined}>
              <span className={clsx(l.dikoreksi && 'line-through')}>{l.label} × {l.qty}</span>{l.dikoreksi && ' (dikoreksi)'}
            </Chip>)}
          </div>
          {r.catatan && <p className="mt-2 text-sm text-muted">Catatan: {r.catatan}</p>}
        </Card>
      ))}
      <p className="text-xs text-muted">Salah catat penerimaan? Admin mengoreksi lewat Stok → Riwayat transaksi → Koreksi. Sisa PO otomatis kembali.</p>
    </div>
  )
}

function ReceiveModal({ po, lines, onClose }: { po: PoRow; lines: PoLine[]; onClose: () => void }) {
  const open = lines.filter((l) => l.sisa > 0)
  const [tgl, setTgl] = useState(isoToday())
  const [sj, setSj] = useState('')
  const [catatan, setCatatan] = useState('')
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.sku_code, String(l.sisa)])))
  const m = useRpc<unknown, { pcs: number; status: string }>('fn_po_receive', {
    success: (r) => `Diterima ${r.pcs} pcs — stok layak bertambah. Status PO: ${PO_STATUS_LABEL[r.status].toLowerCase()}.`,
  })
  const errOf = (l: PoLine) => {
    const v = (qty[l.sku_code] ?? '').trim()
    if (v === '') return null
    if (!/^\d+$/.test(v)) return 'Bilangan bulat'
    if (Number(v) > l.sisa) return `Maks. ${l.sisa}`
    return null
  }
  const total = open.reduce((a, l) => a + (errOf(l) ? 0 : Number(qty[l.sku_code] || 0)), 0)
  const hasErr = open.some(errOf)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title={`Terima barang — ${po.kode}`}
      description={`${po.vendor_nama}. Isi qty yang benar-benar datang (sesuai hitungan fisik & surat jalan). Barang langsung masuk stok Layak.`}
      footer={<>
        <span className="mr-auto text-sm text-muted">Total diterima <b className="text-ink">{fmtNum(total)} pcs</b></span>
        <Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={hasErr || total === 0}
          onClick={async () => { try { await m.mutateAsync({ id: po.id, tanggal: tgl, no_surat_jalan: sj, catatan, lines: open.map((l) => ({ sku_code: l.sku_code, qty: Number(qty[l.sku_code] || 0) })) }); onClose() } catch { /* toast */ } }}>
          Simpan penerimaan
        </Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal barang diterima" required hint={`Tidak sebelum PO dikirim (${fmtDate(po.sent_at)}).`}>
            <Input type="date" value={tgl} min={po.sent_at ?? undefined} max={isoToday()} onChange={(e) => setTgl(e.target.value)} />
          </Field>
          <Field label="No. surat jalan vendor"><Input value={sj} onChange={(e) => setSj(e.target.value)} placeholder="mis. SJ/KSJ/0925/114" /></Field>
        </div>
        <div className="rounded-2xl border border-line">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <p className="text-sm font-semibold">Qty diterima per SKU</p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setQty(Object.fromEntries(open.map((l) => [l.sku_code, String(l.sisa)])))}>Isi semua sesuai sisa</Button>
              <Button size="sm" variant="ghost" onClick={() => setQty(Object.fromEntries(open.map((l) => [l.sku_code, '0'])))}>Kosongkan</Button>
            </div>
          </div>
          <div className="max-h-[45vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2">SKU</th><th className="px-2 py-2 text-right">Dipesan</th><th className="px-2 py-2 text-right">Sudah diterima</th><th className="px-2 py-2 text-right">Sisa</th><th className="w-32 px-4 py-2 text-right">Diterima sekarang</th></tr>
              </thead>
              <tbody>
                {open.map((l) => {
                  const err = errOf(l)
                  return (
                    <tr key={l.sku_code} className="border-t border-line">
                      <td className="px-4 py-2"><p className="font-semibold">{l.sku_label}</p><code className="text-xs text-muted">{l.sku_code}</code></td>
                      <td className="px-2 py-2 text-right num">{fmtNum(l.qty_order)}</td>
                      <td className="px-2 py-2 text-right num">{fmtNum(l.qty_received)}</td>
                      <td className="px-2 py-2 text-right font-semibold num">{fmtNum(l.sisa)}</td>
                      <td className="px-4 py-2 text-right">
                        <Input aria-label={`Qty diterima ${l.sku_label}`} inputMode="numeric" className="h-9 text-right num" value={qty[l.sku_code] ?? ''} aria-invalid={!!err}
                          onChange={(e) => setQty((q) => ({ ...q, [l.sku_code]: e.target.value }))} />
                        {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {hasErr && <Callout tone="amber">Qty melebihi sisa pesanan tidak bisa dicatat di PO ini. Kelebihan kirim vendor diselesaikan dengan vendor (retur) atau dicatat lewat opname.</Callout>}
        <Field label="Catatan"><Textarea className="min-h-14" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. 2 pcs kemeja L jahitan lepas, diretur ke vendor" /></Field>
      </div>
    </Modal>
  )
}

interface SkuOpt { sku_code: string; label: string; price: number | null; moq: number; item_sort: number; gender: string; size_order: number }

function EditPoModal({ po, lines, onClose }: { po: PoRow; lines: PoLine[]; onClose: () => void }) {
  const skus = useView<SkuOpt>('v_sku', { filters: [['active', 'eq', true]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  const [eta, setEta] = useState(po.eta ?? '')
  const [catatan, setCatatan] = useState(po.catatan ?? '')
  const [rows, setRows] = useState(() => lines.map((l) => ({ sku_code: l.sku_code, label: l.sku_label, moq: l.moq, qty: String(l.qty_order), harga: l.harga, saran: l.saran })))
  const [add, setAdd] = useState('')
  const m = useRpc('fn_po_update', { success: 'PO diperbarui.' })
  const bad = rows.some((r) => !/^\d+$/.test(r.qty.trim()) || Number(r.qty) <= 0)
  const avail = (skus.data ?? []).filter((s) => !rows.some((r) => r.sku_code === s.sku_code))
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title={`Ubah ${po.kode}`} description={`Vendor ${po.vendor_nama}. Vendor tidak bisa diganti; batalkan PO dan buat baru bila perlu.`}
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={bad || !rows.length}
          onClick={async () => { try { await m.mutateAsync({ id: po.id, eta: eta || null, catatan, lines: rows.map((r) => ({ sku_code: r.sku_code, qty: Number(r.qty), harga: r.harga, saran: r.saran })) }); onClose() } catch { /* toast */ } }}>
          Simpan perubahan
        </Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Perkiraan tiba (ETA)" hint="Kosongkan = otomatis saat dikirim ke vendor."><Input type="date" value={eta} min={po.tanggal} onChange={(e) => setEta(e.target.value)} /></Field>
          <Field label="Catatan untuk vendor"><Input value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="py-2">SKU</th><th className="w-32 py-2 text-right">Qty</th><th className="w-10" /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const ok = /^\d+$/.test(r.qty.trim()) && Number(r.qty) > 0
              return (
                <tr key={r.sku_code} className="border-t border-line">
                  <td className="py-2"><p className="font-semibold">{r.label}</p><p className="text-xs text-muted"><code>{r.sku_code}</code> · MOQ {r.moq}</p></td>
                  <td className="py-2 text-right">
                    <Input aria-label={`Qty ${r.label}`} inputMode="numeric" className="h-9 text-right num" value={r.qty} aria-invalid={!ok}
                      onChange={(e) => setRows((x) => x.map((y) => (y.sku_code === r.sku_code ? { ...y, qty: e.target.value } : y)))} />
                    {ok && Number(r.qty) % r.moq !== 0 && <p className="mt-0.5 text-xs text-amber-700">bukan kelipatan MOQ</p>}
                  </td>
                  <td className="py-2 pl-2"><button aria-label={`Hapus ${r.label}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setRows((x) => x.filter((y) => y.sku_code !== r.sku_code))}><X className="size-4" /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex gap-2">
          <Select aria-label="Tambah SKU" value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value="">Tambah SKU…</option>
            {avail.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.label} ({s.sku_code})</option>)}
          </Select>
          <Button icon={<Plus className="size-4" />} disabled={!add} onClick={() => {
            const s = avail.find((x) => x.sku_code === add)
            if (s) setRows((x) => [...x, { sku_code: s.sku_code, label: s.label, moq: s.moq, qty: String(s.moq), harga: s.price, saran: null }])
            setAdd('')
          }}>Tambah</Button>
        </div>
      </div>
    </Modal>
  )
}

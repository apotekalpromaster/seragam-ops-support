import type { ColumnDef } from '@tanstack/react-table'
import { ClipboardCheck, Flame } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog, Modal } from '../../components/dialog'
import { Button, Callout, Card, Chip, EmptyState, Field, Input, Tabs, Term, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtNum, isoToday } from '../../lib/format'
import { RETUR_SUMBER_LABEL, STOCK_STATUS_LABEL } from '../../lib/labels'

interface Lot {
  lot_id: number; tanggal: string; tx_type: string; sku_code: string; sku_label: string; item_sort: number; nik: string | null; nama: string | null
  sumber: string; dokumen: string | null; bekas_pakai: boolean; tujuan_grade_a: string; qty_masuk: number; qty_qc: number; sisa: number; aging_hari: number
}
interface Afkir { sku_code: string; label: string; afkir: number; item_sort: number; gender: string; size_order: number }
interface QcResult { pcs: number; hasil: Record<string, number> }

type TabKey = 'qc' | 'afkir'

const hasilText = (h: Record<string, number>) => Object.entries(h).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${STOCK_STATUS_LABEL[k].toLowerCase()}`).join(', ')

export default function QcPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) ?? 'qc'
  const lots = useView<Lot>('v_karantina_lot', { order: [['tanggal', 'asc'], ['lot_id', 'asc']] })
  const afkir = useView<Afkir>('v_stock_sku', { filters: [['afkir', 'gt', 0]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  return (
    <Page title="QC & Afkir" subtitle="Barang kembali di karantina → grade A/B/C per piece; afkir → pemusnahan logo" help="qc">
      <Tabs value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} items={[
        { value: 'qc', label: 'Menunggu QC', count: lots.data?.reduce((a, l) => a + l.sisa, 0) || undefined },
        { value: 'afkir', label: 'Afkir menunggu pemusnahan', count: afkir.data?.reduce((a, l) => a + l.afkir, 0) || undefined },
      ]} />
      {tab === 'qc' ? <QcTable q={lots} /> : <AfkirTable q={afkir} />}
    </Page>
  )
}

function QcTable({ q }: { q: ReturnType<typeof useView<Lot>> }) {
  const { canWrite } = usePerm()
  const [grade, setGrade] = useState<Lot[] | null>(null)
  const [bulkA, setBulkA] = useState<Lot[] | null>(null)
  const m = useRpc<unknown, QcResult>('fn_qc', { success: (r) => `QC ${r.pcs} pcs: ${hasilText(r.hasil)}.` })
  const columns = useMemo<ColumnDef<Lot>[]>(() => [
    { accessorKey: 'sku_label', header: 'Barang', cell: ({ row: { original: l } }) => <div><p className="font-semibold">{l.sku_label}</p><code className="text-xs text-muted">{l.sku_code}</code></div> },
    { accessorKey: 'sku_code', header: 'SKU', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'sumber', header: 'Asal', meta: { exportValue: (l) => RETUR_SUMBER_LABEL[l.sumber] }, cell: ({ row: { original: l } }) => (
      <div><Chip tone={l.bekas_pakai ? 'slate' : 'violet'}>{RETUR_SUMBER_LABEL[l.sumber]}</Chip>
        <p className="mt-0.5 text-xs text-muted">{l.nama ? `${l.nama} · ` : ''}{l.dokumen ?? ''}</p></div>
    ) },
    { accessorKey: 'tanggal', header: 'Masuk', cell: ({ row: { original: l } }) => <div>{fmtDate(l.tanggal)}<p className="text-xs text-muted">{l.aging_hari} hari</p></div> },
    { accessorKey: 'sisa', header: 'Belum di-QC', meta: { align: 'right' }, cell: ({ row: { original: l } }) => <b>{l.sisa}{l.qty_qc > 0 && <span className="font-normal text-muted">/{l.qty_masuk}</span>}</b> },
    { accessorKey: 'tujuan_grade_a', header: () => <Term tip="Barang bekas pakai grade A masuk Cadangan selama parameter 'Retur grade A boleh untuk joiner baru' = Tidak. Barang batal join / no-show (belum dipakai) langsung Layak.">Grade A menjadi</Term>,
      meta: { exportHeader: 'Grade A menjadi', exportValue: (l) => STOCK_STATUS_LABEL[l.tujuan_grade_a] },
      cell: ({ row: { original: l } }) => <Chip tone={l.tujuan_grade_a === 'LAYAK' ? 'green' : 'amber'}>{STOCK_STATUS_LABEL[l.tujuan_grade_a]}</Chip> },
    ...(canWrite ? [{
      id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: l } }: { row: { original: Lot } }) => <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); setGrade([l]) }}>QC…</Button>,
    } as ColumnDef<Lot>] : []),
  ], [canWrite])
  return (
    <Card bodyClass="p-0">
      <p className="border-b border-line px-5 py-3 text-sm text-muted">
        Barang di karantina <b>tidak bisa dikirim</b> sampai di-QC. <b>A</b> layak pakai (setelah laundry), <b>B</b> cacat minor → Cadangan (training/darurat), <b>C</b> rusak → Afkir (logo wajib dimusnahkan).
      </p>
      <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['sku_code', 'sku_label', 'nama', 'dokumen']} searchPlaceholder="Cari SKU / nama / dokumen…"
        exportName="menunggu-qc" selectable={canWrite} getRowId={(l) => String(l.lot_id)}
        bulkActions={(rows, clear) => <Button size="sm" variant="primary" onClick={() => { setBulkA(rows); clear() }}>Semua grade A ({rows.reduce((a, l) => a + l.sisa, 0)} pcs)</Button>}
        empty={<EmptyState icon={<ClipboardCheck className="size-5" />} title="Tidak ada barang menunggu QC">Barang dari pengembalian dan tukar cacat muncul di sini.</EmptyState>} />
      {grade && <GradeModal lot={grade[0]} onClose={() => setGrade(null)} />}
      <ConfirmDialog open={!!bulkA} onOpenChange={() => setBulkA(null)} title={`Grade A untuk ${bulkA?.length} baris?`} confirmLabel="Simpan QC" loading={m.isPending}
        onConfirm={async () => { try { await m.mutateAsync({ tanggal: isoToday(), lines: bulkA!.map((l) => ({ lot_id: l.lot_id, a: l.sisa })) }); setBulkA(null) } catch { /* toast */ } }}>
        <p>{fmtNum(bulkA?.reduce((a, l) => a + l.sisa, 0))} pcs dinilai layak pakai:</p>
        <ul className="list-disc pl-5">
          {bulkA && ['LAYAK', 'CADANGAN'].map((t) => { const n = bulkA.filter((l) => l.tujuan_grade_a === t).reduce((a, l) => a + l.sisa, 0); return n ? <li key={t}>{n} pcs → {STOCK_STATUS_LABEL[t]}</li> : null })}
        </ul>
        <p className="text-xs text-muted">Salah grade? Admin bisa mengoreksi di Stok → Riwayat transaksi.</p>
      </ConfirmDialog>
    </Card>
  )
}

function GradeModal({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const [v, setV] = useState({ a: String(lot.sisa), b: '0', c: '0' })
  const [tgl, setTgl] = useState(isoToday())
  const m = useRpc<unknown, QcResult>('fn_qc', { success: (r) => `QC ${r.pcs} pcs: ${hasilText(r.hasil)}.` })
  const n = (k: 'a' | 'b' | 'c') => (/^\d+$/.test(v[k].trim()) ? Number(v[k]) : NaN)
  const total = n('a') + n('b') + n('c')
  const bad = Number.isNaN(total) || total <= 0 || total > lot.sisa
  const grades: ['a' | 'b' | 'c', string, string][] = [
    ['a', 'A — layak pakai', `→ ${STOCK_STATUS_LABEL[lot.tujuan_grade_a]}`],
    ['b', 'B — cacat minor', '→ Cadangan'],
    ['c', 'C — rusak', '→ Afkir (musnahkan logo)'],
  ]
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`QC — ${lot.sku_label}`}
      description={`${RETUR_SUMBER_LABEL[lot.sumber]}${lot.nama ? ` · ${lot.nama}` : ''} · ${lot.sisa} pcs belum di-QC. Periksa per piece; boleh sebagian dulu.`}
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={bad}
          onClick={async () => { try { await m.mutateAsync({ tanggal: tgl, lines: [{ lot_id: lot.lot_id, a: n('a'), b: n('b'), c: n('c') }] }); onClose() } catch { /* toast */ } }}>Simpan QC</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {grades.map(([k, l, t]) => (
            <Field key={k} label={l} hint={t}><Input inputMode="numeric" className="text-right num" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
          ))}
        </div>
        {!Number.isNaN(total) && total > lot.sisa && <Callout tone="amber">Total {total} melebihi {lot.sisa} pcs yang belum di-QC.</Callout>}
        {lot.bekas_pakai && lot.tujuan_grade_a === 'CADANGAN' && <p className="text-xs text-muted">Grade A bekas pakai masuk Cadangan (kebijakan: retur grade A tidak untuk joiner baru). Ubah di Parameter bila kebijakan berubah.</p>}
        <Field label="Tanggal QC"><Input type="date" value={tgl} max={isoToday()} onChange={(e) => setTgl(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function AfkirTable({ q }: { q: ReturnType<typeof useView<Afkir>> }) {
  const { canWrite } = usePerm()
  const [rows, setRows] = useState<Afkir[] | null>(null)
  const columns = useMemo<ColumnDef<Afkir>[]>(() => [
    { accessorKey: 'label', header: 'Barang', cell: ({ row: { original: a } }) => <div><p className="font-semibold">{a.label}</p><code className="text-xs text-muted">{a.sku_code}</code></div> },
    { accessorKey: 'sku_code', header: 'SKU', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'afkir', header: 'Qty afkir', meta: { align: 'right' } },
  ], [])
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-muted">Barang grade C. Logo wajib dimusnahkan sebelum dibuang; catat tanggal, cara, dan saksi.</p>
        {canWrite && !!q.data?.length && <Button variant="primary" icon={<Flame className="size-4" />} onClick={() => setRows(q.data!)}>Catat pemusnahan</Button>}
      </div>
      <DataTable data={q.data} columns={columns} loading={q.isLoading} exportName="afkir" searchKeys={['sku_code', 'label']}
        empty={<p className="p-8 text-center text-sm text-muted">Tidak ada barang afkir.</p>} />
      {rows && <DisposeModal rows={rows} onClose={() => setRows(null)} />}
    </Card>
  )
}

function DisposeModal({ rows, onClose }: { rows: Afkir[]; onClose: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.sku_code, String(r.afkir)])))
  const [tgl, setTgl] = useState(isoToday())
  const [catatan, setCatatan] = useState('')
  const [doc, setDoc] = useState('')
  const m = useRpc<unknown, { pcs: number }>('fn_dispose', { success: (r) => `Pemusnahan ${r.pcs} pcs dicatat.` })
  const errOf = (r: Afkir) => { const v = (qty[r.sku_code] ?? '').trim(); return v === '' ? null : !/^\d+$/.test(v) ? 'Bilangan bulat' : Number(v) > r.afkir ? `Maks. ${r.afkir}` : null }
  const total = rows.reduce((a, r) => a + (errOf(r) ? 0 : Number(qty[r.sku_code] || 0)), 0)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title="Catat pemusnahan afkir"
      footer={<><span className="mr-auto text-sm text-muted">Dimusnahkan <b className="text-ink">{total} pcs</b></span><Button onClick={onClose}>Batal</Button>
        <Button variant="danger" loading={m.isPending} disabled={total === 0 || rows.some(errOf) || catatan.trim().length < 5}
          onClick={async () => { try { await m.mutateAsync({ tanggal: tgl, catatan, no_dokumen: doc, lines: rows.map((r) => ({ sku_code: r.sku_code, qty: Number(qty[r.sku_code] || 0) })) }); onClose() } catch { /* toast */ } }}>Simpan pemusnahan</Button></>}>
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="py-2">Barang</th><th className="py-2 text-right">Afkir</th><th className="w-28 py-2 text-right">Dimusnahkan</th></tr></thead>
          <tbody>{rows.map((r) => { const err = errOf(r); return (
            <tr key={r.sku_code} className="border-t border-line align-top"><td className="py-2">{r.label}</td><td className="py-2 text-right num">{r.afkir}</td>
              <td className="py-2 pl-2"><Input aria-label={`Qty ${r.label}`} inputMode="numeric" className="h-9 text-right num" value={qty[r.sku_code]} aria-invalid={!!err} onChange={(e) => setQty((q) => ({ ...q, [r.sku_code]: e.target.value }))} />{err && <p className="text-xs text-red-600">{err}</p>}</td></tr>
          ) })}</tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal pemusnahan" required><Input type="date" value={tgl} max={isoToday()} onChange={(e) => setTgl(e.target.value)} /></Field>
          <Field label="No. berita acara"><Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="opsional" /></Field>
        </div>
        <Field label="Cara & saksi pemusnahan logo" required hint="Minimal 5 karakter. Tercatat permanen."><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. logo digunting & dibakar, disaksikan Budi (GA)" /></Field>
      </div>
    </Modal>
  )
}

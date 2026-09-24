import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { ClipboardCheck, RotateCcw, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/dialog'
import { Button, Callout, Card, Chip, Field, Select, Tabs, Term, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtDateTime, fmtNum } from '../../lib/format'
import { GENDER_LABEL, PLAN_STATUS_LABEL, PLAN_STATUS_TONE, STOCK_STATUS_LABEL, TX_LABEL } from '../../lib/labels'

interface StockRow {
  sku_code: string; item_code: string; item_nama: string; gender: string; size_code: string; size_order: number; label: string
  item_sort: number; price: number | null; active: boolean; layak: number; karantina: number; cadangan: number; afkir: number; reserved: number; available: number
  on_order: number; pipeline_demand: number; suggested_order: number; status: string
}
interface LedgerRow {
  id: number; tanggal: string; tx_type: string; sku_code: string; sku_label: string; qty: number; stock_status: string; nik: string | null
  nama_karyawan: string | null; reason: string | null; ref_doc: string | null; affects_stock: boolean; created_by_nama: string | null; created_at: string
  reversal_of: number | null; sudah_dikoreksi: boolean
}

type TabKey = 'sku' | 'peta' | 'riwayat'

export default function StockPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) ?? 'sku'
  const setTab = (t: TabKey) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }) }
  // v_sku_planning = stok per SKU + dalam pemesanan + kebutuhan antrian + status perencanaan (M3)
  const stock = useView<StockRow>('v_sku_planning', { filters: [['active', 'eq', true]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  const need = useMemo(() => new Map((stock.data ?? []).map((s) => [s.sku_code, s.pipeline_demand])), [stock.data])
  const nav = useNavigate()
  const { canWrite } = usePerm()
  const noStock = stock.data && stock.data.every((s) => s.layak + s.karantina + s.cadangan + s.afkir === 0)

  return (
    <Page title="Stok" subtitle="Dihitung dari transaksi — tidak ada angka stok yang diketik manual" help="stok"
      actions={<>
        <Button icon={<ShoppingCart className="size-4" />} onClick={() => nav('/pengadaan')}>Saran order & PO</Button>
        {canWrite && <Button variant="primary" icon={<ClipboardCheck className="size-4" />} onClick={() => nav('/opname')}>Stock opname</Button>}
      </>}>
      {noStock && (
        <Callout tone="blue" title="Stok awal belum terbentuk" action={canWrite && <Button size="sm" variant="soft" onClick={() => nav('/opname')}>Mulai opname pertama</Button>}>
          Stok hanya bisa masuk lewat transaksi. Saldo awal dibentuk dari stock opname pertama yang disetujui admin.
        </Callout>
      )}
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'sku', label: 'Stok per SKU' },
        { value: 'peta', label: 'Peta ukuran' },
        { value: 'riwayat', label: 'Riwayat transaksi' },
      ]} />
      {tab === 'sku' && <SkuTable stock={stock} need={need} />}
      {tab === 'peta' && <Heatmap rows={stock.data ?? []} need={need} loading={stock.isLoading} />}
      {tab === 'riwayat' && <LedgerTable />}
    </Page>
  )
}

function SkuTable({ stock, need }: { stock: ReturnType<typeof useView<StockRow>>; need: Map<string, number> }) {
  const [params, setParams] = useSearchParams()
  const item = params.get('item') ?? ''
  const filter = params.get('filter') ?? ''
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const items = useMemo(() => [...new Map((stock.data ?? []).map((s) => [s.item_code, s.item_nama])).entries()], [stock.data])
  const data = useMemo(() => (stock.data ?? []).filter((s) => {
    const n = need.get(s.sku_code) ?? 0
    return (!item || s.item_code === item) &&
      (!filter || (filter === 'habis' && s.available <= 0) || (filter === 'kurang' && s.available < n) || (filter === 'karantina' && s.karantina > 0) || s.status === filter)
  }), [stock.data, item, filter, need])

  const columns = useMemo<ColumnDef<StockRow>[]>(() => [
    { accessorKey: 'label', header: 'SKU', cell: ({ row: { original: s } }) => <div className="whitespace-nowrap"><p className="font-semibold">{s.label}</p><code className="text-xs text-muted">{s.sku_code}</code></div>, meta: { exportHeader: 'Nama SKU' } },
    { accessorKey: 'sku_code', header: 'Kode', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'layak', header: 'Layak', meta: { align: 'right' } },
    { accessorKey: 'reserved', header: () => <Term tip="Sudah dialokasikan ke batch yang belum dikirim (aktif di modul Distribusi).">Reserved</Term>, meta: { align: 'right', exportHeader: 'Reserved' } },
    { accessorKey: 'available', header: () => <Term tip="Available = stok Layak − Reserved. Hanya ini yang bisa dikirim.">Available</Term>, meta: { align: 'right', exportHeader: 'Available' },
      cell: (c) => <span className={clsx('font-bold', (c.getValue() as number) <= 0 ? 'text-red-600' : 'text-ink')}>{fmtNum(c.getValue() as number)}</span> },
    { accessorKey: 'pipeline_demand', header: () => <Term tip="Hak karyawan aktif & joiner (ukuran valid) yang belum masuk batch.">Kebutuhan antrian</Term>, meta: { align: 'right', exportHeader: 'Kebutuhan antrian' } },
    { accessorKey: 'on_order', header: () => <Term tip="Sisa PO yang sudah dikirim ke vendor dan belum diterima.">Dalam pemesanan</Term>, meta: { align: 'right', exportHeader: 'Dalam pemesanan' } },
    { accessorKey: 'status', header: () => <Term tip="Kritis: tidak cukup untuk antrian atau ≤ safety stock. Perlu order: sudah di titik pesan ulang. Detail di menu Pengadaan.">Status</Term>,
      meta: { exportHeader: 'Status', exportValue: (s) => PLAN_STATUS_LABEL[s.status] },
      cell: ({ row: { original: s } }) => (
        <div className="flex flex-wrap items-center gap-1"><Chip tone={PLAN_STATUS_TONE[s.status]}>{PLAN_STATUS_LABEL[s.status]}</Chip>
          {s.available < s.pipeline_demand && <span className="text-xs font-semibold text-red-600">kurang {s.pipeline_demand - s.available}</span>}</div>
      ) },
    { accessorKey: 'karantina', header: () => <Term tip="Barang kembali yang belum di-QC. Tidak bisa dialokasikan.">Karantina</Term>, meta: { align: 'right', exportHeader: 'Karantina' } },
    { accessorKey: 'cadangan', header: 'Cadangan', meta: { align: 'right' } },
    { accessorKey: 'afkir', header: 'Afkir', meta: { align: 'right' } },
  ], [])

  return (
    <Card bodyClass="p-0">
      <DataTable data={data} columns={columns} loading={stock.isLoading} error={stock.error} searchKeys={['sku_code', 'label']} searchPlaceholder="Cari SKU…" exportName="stok-per-sku" pageSize={60} dense
        toolbar={<>
          <Select aria-label="Filter item" value={item} onChange={(e) => set('item', e.target.value)} className="h-10 w-48">
            <option value="">Semua item</option>
            {items.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Select>
          <Select aria-label="Filter kondisi stok" value={filter} onChange={(e) => set('filter', e.target.value)} className="h-10 w-56">
            <option value="">Semua kondisi</option>
            <option value="kurang">Tidak cukup untuk antrian</option>
            <option value="habis">Habis (available ≤ 0)</option>
            <option value="karantina">Ada barang karantina</option>
            <option value="KRITIS">Status kritis</option>
            <option value="ORDER">Status perlu order</option>
          </Select>
        </>} />
    </Card>
  )
}

function Heatmap({ rows, need, loading }: { rows: StockRow[]; need: Map<string, number>; loading: boolean }) {
  const byItem = useMemo(() => {
    const m = new Map<string, { nama: string; sizes: string[]; genders: string[]; cells: Map<string, StockRow> }>()
    for (const r of rows) {
      const it = m.get(r.item_code) ?? { nama: r.item_nama, sizes: [] as string[], genders: [] as string[], cells: new Map<string, StockRow>() }
      if (!it.sizes.includes(r.size_code)) it.sizes.push(r.size_code)
      if (!it.genders.includes(r.gender)) it.genders.push(r.gender)
      it.cells.set(`${r.gender}|${r.size_code}`, r)
      m.set(r.item_code, it)
    }
    return [...m.entries()]
  }, [rows])
  if (loading) return <Card><p className="text-sm text-muted">Memuat…</p></Card>
  return (
    <Card title="Peta ukuran" subtitle="Available per item × gender × ukuran. Angka kecil = kebutuhan antrian.">
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <Legend cls="bg-red-100 ring-red-300" label="Kurang dari kebutuhan antrian" />
        <Legend cls="bg-slate-100 ring-slate-200" label="Kosong, tidak ada kebutuhan" />
        <Legend cls="bg-amber-100 ring-amber-300" label="Menipis (≤ 3)" />
        <Legend cls="bg-emerald-100 ring-emerald-300" label="Cukup" />
      </div>
      <div className="space-y-6">
        {byItem.map(([code, it]) => (
          <div key={code}>
            <p className="mb-2 font-bold">{it.nama}</p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead><tr><th className="w-20" />{it.sizes.map((s) => <th key={s} className="w-16 px-1 pb-1 text-center text-xs font-semibold text-muted">{s}</th>)}</tr></thead>
                <tbody>
                  {it.genders.map((g) => (
                    <tr key={g}>
                      <td className="pr-3 text-xs font-semibold text-muted">{GENDER_LABEL[g]}</td>
                      {it.sizes.map((s) => {
                        const c = it.cells.get(`${g}|${s}`)
                        if (!c) return <td key={s} className="p-1"><div className="h-12 rounded-lg bg-slate-50" /></td>
                        const n = need.get(c.sku_code) ?? 0
                        const tone = c.available < n ? 'bg-red-100 ring-red-300 text-red-800'
                          : c.available <= 0 ? 'bg-slate-100 ring-slate-200 text-slate-500'
                          : c.available <= 3 ? 'bg-amber-100 ring-amber-300 text-amber-800' : 'bg-emerald-100 ring-emerald-300 text-emerald-800'
                        return (
                          <td key={s} className="p-1">
                            <div className={clsx('flex h-12 flex-col items-center justify-center rounded-lg ring-1 ring-inset', tone)} title={`${c.label}: available ${c.available}, kebutuhan ${n}`}>
                              <span className="text-base font-bold num">{c.available}</span>
                              {n > 0 && <span className="text-[10px] num">perlu {n}</span>}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={clsx('size-3.5 rounded ring-1 ring-inset', cls)} />{label}</span>
}

function LedgerTable() {
  const q = useView<LedgerRow>('v_ledger', { order: [['id', 'desc']], limit: 2000 })
  const [type, setType] = useState('')
  const { isAdmin } = usePerm()
  const [rev, setRev] = useState<LedgerRow | null>(null)
  const data = useMemo(() => (q.data ?? []).filter((l) => !type || l.tx_type === type), [q.data, type])
  const columns = useMemo<ColumnDef<LedgerRow>[]>(() => [
    { accessorKey: 'id', header: '#', meta: { align: 'right', className: 'w-14' } },
    { accessorKey: 'tanggal', header: 'Tanggal', cell: (c) => fmtDate(c.getValue() as string) },
    { accessorKey: 'tx_type', header: 'Jenis', cell: ({ row: { original: l } }) => (
      <div><p className="font-medium">{TX_LABEL[l.tx_type]}</p>{l.reversal_of && <p className="text-xs text-muted">membalik #{l.reversal_of}</p>}{l.sudah_dikoreksi && <Chip tone="slate">sudah dikoreksi</Chip>}</div>
    ), meta: { exportValue: (l) => TX_LABEL[l.tx_type] } },
    { accessorKey: 'sku_label', header: 'SKU' },
    { accessorKey: 'qty', header: 'Qty', meta: { align: 'right' }, cell: (c) => { const v = c.getValue() as number; return <span className={clsx('font-bold', v > 0 ? 'text-emerald-700' : 'text-red-600')}>{v > 0 ? `+${v}` : v}</span> } },
    { accessorKey: 'stock_status', header: 'Status stok', cell: ({ row: { original: l } }) => l.affects_stock ? STOCK_STATUS_LABEL[l.stock_status] : <span className="text-muted">tidak mengubah stok</span> },
    { accessorKey: 'nama_karyawan', header: 'Karyawan', cell: ({ row: { original: l } }) => l.nik ? <span>{l.nama_karyawan} <span className="text-xs text-muted">{l.nik}</span></span> : '—' },
    { accessorKey: 'reason', header: 'Keterangan', cell: ({ row: { original: l } }) => <span className="text-muted">{[l.reason, l.ref_doc].filter(Boolean).join(' · ') || '—'}</span> },
    { accessorKey: 'created_by_nama', header: 'Oleh', cell: ({ row: { original: l } }) => <span className="text-xs">{l.created_by_nama ?? 'sistem'}<br /><span className="text-muted">{fmtDateTime(l.created_at)}</span></span> },
    ...(isAdmin ? [{
      id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: l } }: { row: { original: LedgerRow } }) => l.tx_type !== 'REVERSAL' && !l.sudah_dikoreksi
        ? <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={(e) => { e.stopPropagation(); setRev(l) }}>Koreksi</Button> : null,
    } as ColumnDef<LedgerRow>] : []),
  ], [isAdmin])
  return (
    <Card bodyClass="p-0">
      <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['sku_code', 'sku_label', 'nik', 'nama_karyawan', 'ref_doc']} searchPlaceholder="Cari SKU, NIK, dokumen…" exportName="riwayat-transaksi-stok" dense
        toolbar={<Select aria-label="Filter jenis transaksi" value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-56">
          <option value="">Semua jenis transaksi</option>
          {Object.entries(TX_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>}
        empty={<p className="p-8 text-center text-sm text-muted">Belum ada transaksi stok.</p>} />
      {rev && <ReverseModal row={rev} onClose={() => setRev(null)} />}
    </Card>
  )
}

function ReverseModal({ row, onClose }: { row: LedgerRow; onClose: () => void }) {
  const [alasan, setAlasan] = useState('')
  const [typed, setTyped] = useState('')
  const m = useRpc('fn_ledger_reverse', { success: `Transaksi #${row.id} sudah dikoreksi.` })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Koreksi transaksi #${row.id}`} size="sm"
      description="Transaksi tidak diubah atau dihapus. Sistem membuat transaksi koreksi (REVERSAL) dengan qty kebalikannya."
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="danger" loading={m.isPending} disabled={alasan.trim().length < 5 || typed.trim().toUpperCase() !== 'KOREKSI'}
          onClick={async () => { try { await m.mutateAsync({ id: row.id, alasan }); onClose() } catch { /* toast */ } }}>Buat koreksi</Button></>}>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-line bg-slate-50 p-3">
          <p className="font-semibold">{TX_LABEL[row.tx_type]} · {row.sku_label}</p>
          <p className="text-muted">{fmtDate(row.tanggal)} · qty {row.qty > 0 ? `+${row.qty}` : row.qty}{row.nik ? ` · ${row.nama_karyawan}` : ''}</p>
          <p className="mt-2">Koreksi akan mencatat qty <b>{row.qty > 0 ? -row.qty : `+${-row.qty}`}</b>.</p>
        </div>
        <Field label="Alasan koreksi" required hint="Minimal 5 karakter. Tercatat permanen.">
          <Textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah input qty saat opname awal" />
        </Field>
        <Field label={<>Ketik <code className="rounded bg-slate-100 px-1">KOREKSI</code> untuk melanjutkan</>}>
          <input className="h-10 w-full rounded-xl border border-line px-3" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

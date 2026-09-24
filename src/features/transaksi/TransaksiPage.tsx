import type { ColumnDef } from '@tanstack/react-table'
import { Repeat, ShoppingBag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog } from '../../components/dialog'
import { Button, Card, Chip, EmptyState, Field, Input, Tabs } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtMonth, fmtNum, fmtRp } from '../../lib/format'
import { EXCHANGE_ALASAN_LABEL } from '../../lib/labels'
import { EmployeeCard } from '../employee/EmployeeCard'
import { useTransaksiDialogs } from './dialogs'

interface ExRow {
  id: number; kode: string; tanggal: string; nik: string; nama: string; jabatan: string; cabang_nama: string; item_nama: string
  sku_in: string; sku_in_label: string; sku_out: string; sku_out_label: string; qty: number; alasan: string; approver: string
  catatan: string | null; hari_sejak_issue: number; vendor_nama: string | null; created_by_nama: string | null; dibatalkan: boolean
}
interface SaleRow {
  id: number; kode: string; tanggal: string; nik: string; nama: string; jabatan: string; cabang_nama: string; periode_potong: string
  catatan: string | null; pcs: number; nilai: number; items: { label: string; qty: number; dibatalkan: boolean }[]; dibatalkan: boolean
  alasan_batal: string | null; created_by_nama: string | null
}

type TabKey = 'tukar' | 'beli'

export default function TransaksiPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) ?? 'tukar'
  const { canWrite } = usePerm()
  const d = useTransaksiDialogs()
  return (
    <Page title="Tukar & Pembelian" subtitle="Tukar barang cacat & pembelian potong gaji" help="transaksi"
      actions={canWrite && <>
        <Button icon={<Repeat className="size-4" />} onClick={() => d.openExchange()}>Tukar barang cacat</Button>
        <Button variant="primary" icon={<ShoppingBag className="size-4" />} onClick={() => d.openSale()}>Catat pembelian</Button>
      </>}>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} items={[
        { value: 'tukar', label: 'Tukar' },
        { value: 'beli', label: 'Pembelian' },
      ]} />
      {tab === 'tukar' ? <ExchangeTable onNew={canWrite ? () => d.openExchange() : undefined} /> : <SaleTable onNew={canWrite ? () => d.openSale() : undefined} />}
      {d.dialogs}
    </Page>
  )
}

function ExchangeTable({ onNew }: { onNew?: () => void }) {
  const q = useView<ExRow>('v_exchange', { order: [['id', 'desc']] })
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<ExRow>[]>(() => [
    { accessorKey: 'kode', header: 'No.', cell: ({ row: { original: r } }) => <div><p className="whitespace-nowrap font-semibold">{r.kode}</p><p className="text-xs text-muted">{fmtDate(r.tanggal)}</p></div> },
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: r } }) => <div><p className="font-semibold">{r.nama}</p><p className="text-xs text-muted">{r.nik} · {r.cabang_nama}</p></div> },
    { accessorKey: 'nik', header: 'NIK', meta: { className: 'hidden' }, cell: () => null },
    { id: 'barang', header: 'Barang', accessorFn: (r) => `${r.sku_in} → ${r.sku_out}`, cell: ({ row: { original: r } }) => (
      <div className="text-sm"><p>{r.sku_in_label} × {r.qty}</p>{r.sku_out !== r.sku_in && <p className="text-xs text-muted">diganti {r.sku_out_label}</p>}</div>
    ) },
    { accessorKey: 'alasan', header: 'Alasan', meta: { exportValue: (r) => EXCHANGE_ALASAN_LABEL[r.alasan] }, cell: ({ row: { original: r } }) => (
      <div className="flex flex-wrap gap-1"><Chip tone={r.alasan === 'CACAT_PRODUKSI' ? 'red' : 'amber'}>{EXCHANGE_ALASAN_LABEL[r.alasan]}</Chip>{r.dibatalkan && <Chip tone="slate">dikoreksi</Chip>}</div>
    ) },
    { accessorKey: 'hari_sejak_issue', header: 'Hari sejak kirim', meta: { align: 'right' } },
    { accessorKey: 'vendor_nama', header: 'Vendor', cell: (c) => (c.getValue() as string) ?? '—' },
    { accessorKey: 'approver', header: 'Disetujui', cell: ({ row: { original: r } }) => <span className="text-xs">{r.approver}<br /><span className="text-muted">dicatat {r.created_by_nama ?? '—'}</span></span> },
  ], [])
  return (
    <Card bodyClass="p-0">
      <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['kode', 'nik', 'nama', 'sku_in']} searchPlaceholder="Cari no. / NIK / nama / SKU…"
        exportName="tukar-barang" onRowClick={(r) => setOpen(r.nik)}
        empty={<EmptyState icon={<Repeat className="size-5" />} title="Belum ada tukar barang" action={onNew && <Button onClick={onNew}>Tukar barang cacat</Button>}>
          Tukar hanya untuk cacat produksi atau deviasi spek vendor, dalam batas hari sejak barang dikirim.
        </EmptyState>} />
      {open && <EmployeeCard nik={open} onClose={() => setOpen(null)} />}
    </Card>
  )
}

function SaleTable({ onNew }: { onNew?: () => void }) {
  const q = useView<SaleRow>('v_sale', { order: [['id', 'desc']] })
  const { isAdmin } = usePerm()
  const [cancel, setCancel] = useState<SaleRow | null>(null)
  const [alasan, setAlasan] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const m = useRpc('fn_sale_cancel', { success: 'Pembelian dibatalkan. Barang kembali ke stok layak dan tidak ikut potong gaji.' })
  const columns = useMemo<ColumnDef<SaleRow>[]>(() => [
    { accessorKey: 'kode', header: 'No.', cell: ({ row: { original: r } }) => <div><p className="whitespace-nowrap font-semibold">{r.kode}</p><p className="text-xs text-muted">{fmtDate(r.tanggal)}</p></div> },
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: r } }) => <div><p className="font-semibold">{r.nama}</p><p className="text-xs text-muted">{r.nik} · {r.cabang_nama}</p></div> },
    { accessorKey: 'nik', header: 'NIK', meta: { className: 'hidden' }, cell: () => null },
    { id: 'barang', header: 'Barang', accessorFn: (r) => r.items.map((i) => `${i.label} ×${i.qty}`).join(', '), cell: ({ row: { original: r } }) => (
      <ul className="text-sm">{r.items.map((i, k) => <li key={k} className={i.dibatalkan ? 'text-slate-400 line-through' : ''}>{i.label} × {i.qty}</li>)}</ul>
    ) },
    { accessorKey: 'nilai', header: 'Nilai', meta: { align: 'right' }, cell: (c) => <span className="whitespace-nowrap font-semibold">{fmtRp(c.getValue() as number)}</span> },
    { accessorKey: 'periode_potong', header: 'Potong gaji', cell: ({ row: { original: r } }) => r.dibatalkan ? <Chip tone="slate" title={r.alasan_batal ?? ''}>dibatalkan</Chip> : fmtMonth(r.periode_potong),
      meta: { exportValue: (r) => (r.dibatalkan ? 'DIBATALKAN' : r.periode_potong) } },
    { accessorKey: 'created_by_nama', header: 'Dicatat', cell: (c) => <span className="text-xs">{(c.getValue() as string) ?? '—'}</span> },
    ...(isAdmin ? [{
      id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: r } }: { row: { original: SaleRow } }) => !r.dibatalkan && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCancel(r) }}>Batalkan</Button>,
    } as ColumnDef<SaleRow>] : []),
  ], [isAdmin])
  return (
    <Card bodyClass="p-0">
      <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['kode', 'nik', 'nama']} searchPlaceholder="Cari no. / NIK / nama…"
        exportName="pembelian-karyawan" onRowClick={(r) => setOpen(r.nik)} rowClassName={(r) => (r.dibatalkan ? 'opacity-60' : undefined)}
        empty={<EmptyState icon={<ShoppingBag className="size-5" />} title="Belum ada pembelian" action={onNew && <Button onClick={onNew}>Catat pembelian</Button>}>
          Pembelian dipotong gaji. Export per periode ada di menu Laporan.
        </EmptyState>} />
      <ConfirmDialog open={!!cancel} onOpenChange={() => { setCancel(null); setAlasan('') }} title={`Batalkan ${cancel?.kode}?`} confirmLabel="Batalkan pembelian" danger
        loading={m.isPending} disabled={alasan.trim().length < 3}
        onConfirm={async () => { try { await m.mutateAsync({ id: cancel!.id, alasan }); setCancel(null); setAlasan('') } catch { /* toast */ } }}>
        <p>{fmtNum(cancel?.pcs)} pcs ({fmtRp(cancel?.nilai)}) kembali ke stok layak dan dikeluarkan dari potong gaji {cancel && fmtMonth(cancel.periode_potong)}.
          Bila export potong gaji periode itu sudah dikirim ke Payroll, kabari Payroll juga.</p>
        <Field label="Alasan" required htmlFor="alasan-batal-beli" hint="Minimal 3 karakter."><Input id="alasan-batal-beli" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. dobel input" /></Field>
      </ConfirmDialog>
      {open && <EmployeeCard nik={open} onClose={() => setOpen(null)} />}
    </Card>
  )
}

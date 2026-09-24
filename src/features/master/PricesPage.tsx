import type { ColumnDef } from '@tanstack/react-table'
import { Download, Pencil, Plus, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/dialog'
import { Button, Card, Chip, Field, Input, Select, Term } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtRp, isoToday } from '../../lib/format'
import { PRICE_TEMPLATE } from '../../lib/templates'
import { downloadTemplate, readSheet } from '../../lib/xlsx'
import { ReadOnlyNote } from './common'

interface Sku { sku_code: string; label: string; item_code: string; price: number | null; price_valid_from: string | null; vendor_id: number | null; vendor_nama: string | null; lead_time_days: number | null; lead_time_override: number | null; moq: number; active: boolean }
interface Vendor { id: number; nama: string; kontak: string | null; lead_time_default: number; active: boolean }
interface Price { id: number; sku_code: string; price: number; valid_from: string }


export default function PricesPage() {
  const skus = useView<Sku>('v_sku', { filters: [['active', 'eq', true]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  const vendors = useView<Vendor>('vendor', { order: [['nama', 'asc']] })
  const { isAdmin } = usePerm()
  const [edit, setEdit] = useState<Sku | null>(null)
  const [vend, setVend] = useState<Vendor | 'new' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bulk = useRpc<unknown, { ok: boolean; jumlah?: number; errors?: { baris: number; pesan: string }[] }>('fn_sku_bulk_update')

  async function upload(file?: File) {
    if (!file) return
    const { rows } = await readSheet(file)
    const r = await bulk.mutateAsync({ rows: rows.filter((x) => x.sku_code).map((x) => ({ ...x, price: x.price || null, lead_time_days: x.lead_time_days || null, moq: x.moq || null })) })
    if (r.ok) toast.success(`${r.jumlah} SKU diperbarui.`)
    else toast.error(`${r.errors!.length} baris bermasalah — tidak ada yang disimpan.`, { description: r.errors!.slice(0, 4).map((e) => `Baris ${e.baris + 1}: ${e.pesan}`).join('\n'), duration: 12000 })
  }

  const noPrice = (skus.data ?? []).filter((s) => s.price === null).length
  const columns = useMemo<ColumnDef<Sku>[]>(() => [
    { accessorKey: 'label', header: 'SKU', cell: ({ row: { original: s } }) => <div><p className="font-medium">{s.label}</p><code className="text-xs text-muted">{s.sku_code}</code></div> },
    { accessorKey: 'sku_code', header: 'Kode', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'price', header: 'Harga', meta: { align: 'right' }, cell: ({ row: { original: s } }) => s.price === null ? <Chip tone="amber">belum ada</Chip> : <div>{fmtRp(s.price)}<p className="text-xs text-muted">sejak {fmtDate(s.price_valid_from)}</p></div> },
    { accessorKey: 'vendor_nama', header: 'Vendor', cell: (c) => (c.getValue() as string) ?? <span className="text-muted">—</span> },
    { accessorKey: 'lead_time_days', header: () => <Term tip="Waktu dari PO dikirim sampai barang diterima. Dipakai untuk titik pesan ulang (ROP).">Lead time</Term>, meta: { align: 'right', exportHeader: 'Lead time (hari)' },
      cell: ({ row: { original: s } }) => s.lead_time_days === null ? '—' : <span>{s.lead_time_days} hari{s.lead_time_override === null && <span className="block text-xs text-muted">default vendor</span>}</span> },
    { accessorKey: 'moq', header: () => <Term tip="Minimum order quantity. Saran order dibulatkan ke kelipatan MOQ.">MOQ</Term>, meta: { align: 'right', exportHeader: 'MOQ' } },
    ...(isAdmin ? [{ id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: s } }: { row: { original: Sku } }) => <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(s)}>Ubah</Button> } as ColumnDef<Sku>] : []),
  ], [isAdmin])
  const vcols = useMemo<ColumnDef<Vendor>[]>(() => [
    { accessorKey: 'nama', header: 'Vendor', cell: ({ row: { original: v } }) => <span className="font-semibold">{v.nama} {!v.active && <Chip tone="slate">nonaktif</Chip>}</span> },
    { accessorKey: 'kontak', header: 'Kontak' },
    { accessorKey: 'lead_time_default', header: 'Lead time default', meta: { align: 'right' }, cell: (c) => `${c.getValue()} hari` },
    ...(isAdmin ? [{ id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: v } }: { row: { original: Vendor } }) => <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setVend(v)}>Ubah</Button> } as ColumnDef<Vendor>] : []),
  ], [isAdmin])

  return (
    <Page title="Harga & Vendor" subtitle="Price list berlaku, riwayat harga, lead time, MOQ" help="harga"
      actions={isAdmin && <>
        <Button icon={<Download className="size-4" />} onClick={() => downloadTemplate(PRICE_TEMPLATE)}>Template</Button>
        <Button variant="primary" icon={<Upload className="size-4" />} loading={bulk.isPending} onClick={() => fileRef.current?.click()}>Upload harga</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]).catch(() => undefined); e.target.value = '' }} />
      </>}>
      {!isAdmin && <ReadOnlyNote />}
      <Card title="Harga per SKU" subtitle={noPrice ? `${noPrice} SKU belum punya harga — pembelian karyawan & nilai retur belum bisa dihitung untuk SKU tersebut.` : 'Harga tercatat di setiap transaksi saat terjadi.'} bodyClass="p-0">
        <DataTable data={skus.data} columns={columns} loading={skus.isLoading} error={skus.error} searchKeys={['sku_code', 'label', 'vendor_nama']} searchPlaceholder="Cari SKU / vendor…" exportName="harga-sku" pageSize={60} dense />
      </Card>
      <Card title="Vendor" actions={isAdmin && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setVend('new')}>Vendor baru</Button>} bodyClass="p-0">
        <DataTable data={vendors.data} columns={vcols} loading={vendors.isLoading} empty={<p className="p-8 text-center text-sm text-muted">Belum ada vendor.</p>} />
      </Card>
      {edit && <SkuModal sku={edit} vendors={vendors.data ?? []} onClose={() => setEdit(null)} />}
      {vend && <VendorModal vendor={vend === 'new' ? null : vend} onClose={() => setVend(null)} />}
    </Page>
  )
}

function SkuModal({ sku, vendors, onClose }: { sku: Sku; vendors: Vendor[]; onClose: () => void }) {
  const hist = useView<Price>('sku_price', { filters: [['sku_code', 'eq', sku.sku_code]], order: [['valid_from', 'desc']] })
  const [price, setPrice] = useState(sku.price?.toString() ?? '')
  const [from, setFrom] = useState(isoToday())
  const [vendor, setVendor] = useState(sku.vendor_id?.toString() ?? '')
  const [lead, setLead] = useState(sku.lead_time_override?.toString() ?? '')
  const [moq, setMoq] = useState(sku.moq.toString())
  const upd = useRpc('fn_sku_update', { invalidate: false })
  const bulk = useRpc<unknown, { ok: boolean }>('fn_sku_bulk_update', { success: 'SKU disimpan.' })
  const priceChanged = price !== '' && Number(price) !== sku.price
  const priceOk = price === '' || /^\d+$/.test(price)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={sku.label} description={sku.sku_code}
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={upd.isPending || bulk.isPending} disabled={!priceOk || Number(moq) < 1}
          onClick={async () => {
            try {
              await upd.mutateAsync({ sku_code: sku.sku_code, vendor_id: vendor ? Number(vendor) : null, lead_time_days: lead === '' ? null : Number(lead), moq: Number(moq) })
              await bulk.mutateAsync({ rows: priceChanged ? [{ sku_code: sku.sku_code, price, valid_from: from }] : [] })
              onClose()
            } catch { /* toast */ }
          }}>Simpan</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Harga (Rp)" error={!priceOk ? 'Angka saja, tanpa titik.' : undefined}><Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="95000" /></Field>
          <Field label="Berlaku mulai" hint={priceChanged ? 'Harga lama tetap tersimpan sebagai riwayat.' : undefined}><Input type="date" value={from} disabled={!priceChanged} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Vendor">
            <Select value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">— belum ditentukan —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.nama}</option>)}
            </Select>
          </Field>
          <Field label="Lead time khusus (hari)" hint="Kosong = pakai default vendor."><Input type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
          <Field label="MOQ" required><Input type="number" min={1} value={moq} onChange={(e) => setMoq(e.target.value)} /></Field>
        </div>
        {!!hist.data?.length && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">Riwayat harga</p>
            <ul className="text-sm">{hist.data.map((h) => <li key={h.id} className="flex justify-between border-b border-slate-100 py-1"><span>{fmtDate(h.valid_from)}</span><span className="num">{fmtRp(h.price)}</span></li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

function VendorModal({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const [nama, setNama] = useState(vendor?.nama ?? '')
  const [kontak, setKontak] = useState(vendor?.kontak ?? '')
  const [lead, setLead] = useState(String(vendor?.lead_time_default ?? 30))
  const [active, setActive] = useState(vendor?.active ?? true)
  const m = useRpc('fn_vendor_save', { success: 'Vendor disimpan.' })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={vendor ? `Ubah vendor` : 'Vendor baru'} size="sm"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={m.isPending} disabled={!nama.trim()}
        onClick={async () => { try { await m.mutateAsync({ id: vendor?.id ?? null, nama, kontak, lead_time_default: Number(lead), active }); onClose() } catch { /* toast */ } }}>Simpan</Button></>}>
      <div className="space-y-4">
        <Field label="Nama vendor" required><Input value={nama} onChange={(e) => setNama(e.target.value)} /></Field>
        <Field label="Kontak"><Input value={kontak} onChange={(e) => setKontak(e.target.value)} placeholder="Nama / telepon / email" /></Field>
        <Field label="Lead time default (hari)"><Input type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
        {vendor && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-500" checked={active} onChange={(e) => setActive(e.target.checked)} /> Vendor aktif</label>}
      </div>
    </Modal>
  )
}

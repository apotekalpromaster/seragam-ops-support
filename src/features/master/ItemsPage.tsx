import type { ColumnDef } from '@tanstack/react-table'
import clsx from 'clsx'
import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/dialog'
import { Button, Callout, Card, Chip, Field, Input, Select } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { SIZE_GROUP_LABEL } from '../../lib/labels'
import { ReadOnlyNote } from './common'

interface ItemRow { item_code: string; nama: string; gender_specific: boolean; size_group: string; active: boolean; sort_order: number; sizes: string[]; jumlah_sku: number }
interface Size { size_code: string; size_order: number }
interface Sku { sku_code: string; item_code: string; label: string; gender: string; size_code: string; active: boolean; size_order: number }

export default function ItemsPage() {
  const items = useView<ItemRow>('v_item', { order: [['sort_order', 'asc']] })
  const skus = useView<Sku>('v_sku', { order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  const { isAdmin } = usePerm()
  const [edit, setEdit] = useState<ItemRow | 'new' | null>(null)
  const columns = useMemo<ColumnDef<ItemRow>[]>(() => [
    { accessorKey: 'item_code', header: 'Kode', cell: (c) => <code className="font-semibold">{c.getValue() as string}</code> },
    { accessorKey: 'nama', header: 'Nama item', cell: ({ row: { original: i } }) => <span className="font-semibold">{i.nama} {!i.active && <Chip tone="slate">nonaktif</Chip>}</span> },
    { accessorKey: 'gender_specific', header: 'Varian', cell: (c) => (c.getValue() ? 'Pria (P) / Wanita (W)' : 'Unisex (U)'), meta: { exportValue: (i) => (i.gender_specific ? 'P/W' : 'U') } },
    { accessorKey: 'size_group', header: 'Ukuran diambil dari', cell: (c) => SIZE_GROUP_LABEL[c.getValue() as string] ?? `Grup ${c.getValue()}` },
    { accessorKey: 'sizes', header: 'Ukuran tersedia', enableSorting: false, cell: (c) => (c.getValue() as string[]).join(', '), meta: { exportValue: (i) => i.sizes.join(', ') } },
    { accessorKey: 'jumlah_sku', header: 'SKU aktif', meta: { align: 'right' } },
    ...(isAdmin ? [{ id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: i } }: { row: { original: ItemRow } }) => <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(i)}>Ubah</Button> } as ColumnDef<ItemRow>] : []),
  ], [isAdmin])
  const skuCols = useMemo<ColumnDef<Sku>[]>(() => [
    { accessorKey: 'sku_code', header: 'Kode SKU', cell: (c) => <code>{c.getValue() as string}</code> },
    { accessorKey: 'label', header: 'Nama' },
    { accessorKey: 'active', header: 'Status', cell: (c) => (c.getValue() ? <Chip tone="green">aktif</Chip> : <Chip tone="slate">nonaktif</Chip>) },
  ], [])
  return (
    <Page title="Item & SKU" subtitle="SKU = kode item + gender + ukuran, dibentuk otomatis" help="item"
      actions={isAdmin && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>Item baru</Button>}>
      {!isAdmin && <ReadOnlyNote />}
      <Card title="Jenis seragam" bodyClass="p-0">
        <DataTable data={items.data} columns={columns} loading={items.isLoading} error={items.error} exportName="master-item" />
      </Card>
      <Card title="Daftar SKU" subtitle="Harga, vendor, lead time, dan MOQ diatur di menu Harga & Vendor" bodyClass="p-0">
        <DataTable data={skus.data} columns={skuCols} loading={skus.isLoading} searchKeys={['sku_code', 'label']} searchPlaceholder="Cari SKU…" exportName="master-sku" pageSize={60} dense />
      </Card>
      {edit && <ItemModal item={edit === 'new' ? null : edit} groups={[...new Set((items.data ?? []).map((i) => i.size_group))]} onClose={() => setEdit(null)} />}
    </Page>
  )
}

function ItemModal({ item, groups, onClose }: { item: ItemRow | null; groups: string[]; onClose: () => void }) {
  const sizes = useView<Size>('size', { order: [['size_order', 'asc']] })
  const [code, setCode] = useState(item?.item_code ?? '')
  const [nama, setNama] = useState(item?.nama ?? '')
  const [gs, setGs] = useState(item?.gender_specific ?? true)
  const [group, setGroup] = useState(item?.size_group ?? 'KEMEJA')
  const [newGroup, setNewGroup] = useState('')
  const [sel, setSel] = useState<string[]>(item?.sizes ?? ['S', 'M', 'L', 'XL', 'XXL'])
  const [active, setActive] = useState(item?.active ?? true)
  const m = useRpc('fn_item_save', { success: (r: { sku_aktif_baru: number; sku_dinonaktifkan: number }) => `Item disimpan. ${r.sku_aktif_baru} SKU dibuat/diaktifkan${r.sku_dinonaktifkan ? `, ${r.sku_dinonaktifkan} dinonaktifkan` : ''}.` })
  const codeOk = /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code)
  const realGroup = group === '__new' ? newGroup.trim().toUpperCase().replace(/\s+/g, '_') : group
  const removed = item ? item.sizes.filter((s) => !sel.includes(s)) : []
  const nSku = sel.length * (gs ? 2 : 1)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={item ? `Ubah item ${item.item_code}` : 'Item seragam baru'}
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={!codeOk || !nama.trim() || !sel.length || !realGroup}
          onClick={async () => { try { await m.mutateAsync({ is_new: !item, item_code: code, nama, gender_specific: gs, size_group: realGroup, sizes: sel, active }); onClose() } catch { /* toast */ } }}>Simpan item</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kode item" required error={code && !codeOk ? 'Huruf kapital, angka, tanda hubung (mis. RMP).' : undefined} hint={item ? 'Kode tidak bisa diubah.' : 'Menjadi awalan kode SKU.'}>
            <Input value={code} disabled={!!item} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, '-'))} placeholder="RMP" />
          </Field>
          <Field label="Nama item" required><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Rompi" /></Field>
        </div>
        <Field label="Varian gender">
          <div className="flex gap-2">
            {[[true, 'Pria / Wanita'], [false, 'Unisex']].map(([v, l]) => (
              <button key={String(v)} type="button" onClick={() => setGs(v as boolean)} className={clsx('rounded-xl border px-4 py-2 text-sm font-semibold', gs === v ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line text-slate-600')}>{l as string}</button>
            ))}
          </div>
        </Field>
        <Field label="Ukuran karyawan diambil dari" hint="Pilih kolom ukuran data PPM yang dipakai item ini. Grup baru disimpan terpisah per karyawan.">
          <Select value={group} onChange={(e) => setGroup(e.target.value)}>
            {[...new Set(['KEMEJA', 'POLO', 'BLAZER', ...groups])].map((g) => <option key={g} value={g}>{SIZE_GROUP_LABEL[g] ?? `Grup ${g}`}</option>)}
            <option value="__new">+ Grup ukuran baru…</option>
          </Select>
          {group === '__new' && <Input className="mt-2" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="mis. HIJAB" />}
        </Field>
        <Field label="Ukuran tersedia" required>
          <div className="flex flex-wrap gap-2">
            {sizes.data?.map((s) => {
              const on = sel.includes(s.size_code)
              return (
                <button key={s.size_code} type="button" aria-pressed={on}
                  onClick={() => setSel(on ? sel.filter((x) => x !== s.size_code) : [...sel, s.size_code].sort((a, b) => (sizes.data!.find((z) => z.size_code === a)!.size_order - sizes.data!.find((z) => z.size_code === b)!.size_order)))}
                  className={clsx('min-w-12 rounded-lg border px-3 py-1.5 text-sm font-bold', on ? 'border-brand-400 bg-brand-500 text-white' : 'border-line text-slate-500 hover:border-brand-300')}>{s.size_code}</button>
              )
            })}
          </div>
        </Field>
        {item && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-500" checked={active} onChange={(e) => setActive(e.target.checked)} /> Item aktif</label>
        )}
        <Callout tone="blue">Akan ada <b>{nSku} SKU</b> aktif untuk item ini.{!item && ' Item baru otomatis muncul di Master Paket dengan qty 0.'}</Callout>
        {removed.length > 0 && <Callout tone="amber">SKU ukuran {removed.join(', ')} akan dinonaktifkan (tidak dihapus, riwayat tetap ada).</Callout>}
      </div>
    </Modal>
  )
}

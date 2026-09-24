import type { ColumnDef } from '@tanstack/react-table'
import { Download, Pencil, Plus, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/dialog'
import { Button, Card, Chip, Field, Input, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate } from '../../lib/format'
import { BRANCH_TEMPLATE } from '../../lib/templates'
import { downloadTemplate, readSheet } from '../../lib/xlsx'
import { ReadOnlyNote } from './common'

interface Branch { kode_cabang: string; nama: string; area: string | null; alamat: string | null; is_new_opening: boolean; go_date: string | null; active: boolean }


const yes = (v: string) => /^(ya|y|yes|true|1)$/i.test(v.trim())

export default function BranchesPage() {
  const q = useView<Branch>('branch', { order: [['kode_cabang', 'asc']] })
  const { isAdmin } = usePerm()
  const [edit, setEdit] = useState<Branch | 'new' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bulk = useRpc<unknown, { ok: boolean; jumlah?: number; errors?: { baris: number; pesan: string }[] }>('fn_branch_upsert')
  async function upload(file?: File) {
    if (!file) return
    const { rows } = await readSheet(file)
    const r = await bulk.mutateAsync({ rows: rows.map((x) => ({ ...x, is_new_opening: yes(x.is_new_opening ?? ''), go_date: x.go_date || null })) })
    if (r.ok) toast.success(`${r.jumlah} cabang disimpan.`)
    else toast.error(`${r.errors!.length} baris bermasalah — tidak ada yang disimpan.`, { description: r.errors!.slice(0, 4).map((e) => `Baris ${e.baris + 1}: ${e.pesan}`).join('\n'), duration: 12000 })
  }
  const columns = useMemo<ColumnDef<Branch>[]>(() => [
    { accessorKey: 'kode_cabang', header: 'Kode', cell: (c) => <code className="font-semibold">{c.getValue() as string}</code> },
    { accessorKey: 'nama', header: 'Nama', cell: ({ row: { original: b } }) => <span className="font-medium">{b.nama} {!b.active && <Chip tone="slate">nonaktif</Chip>}{b.is_new_opening && <Chip tone="brand" className="ml-1">GO {fmtDate(b.go_date)}</Chip>}</span> },
    { accessorKey: 'area', header: 'Area' },
    { accessorKey: 'alamat', header: 'Alamat kirim', cell: (c) => <span className="text-muted">{(c.getValue() as string) ?? '—'}</span> },
    ...(isAdmin ? [{ id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: b } }: { row: { original: Branch } }) => <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(b)}>Ubah</Button> } as ColumnDef<Branch>] : []),
  ], [isAdmin])
  return (
    <Page title="Cabang" subtitle="Daftar cabang, area, alamat kirim, dan jadwal Grand Opening" help="cabang"
      actions={isAdmin && <>
        <Button icon={<Download className="size-4" />} onClick={() => downloadTemplate(BRANCH_TEMPLATE)}>Template</Button>
        <Button icon={<Upload className="size-4" />} loading={bulk.isPending} onClick={() => fileRef.current?.click()}>Upload</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]).catch(() => undefined); e.target.value = '' }} />
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>Cabang baru</Button>
      </>}>
      {!isAdmin && <ReadOnlyNote />}
      <Card bodyClass="p-0">
        <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['kode_cabang', 'nama', 'area']} searchPlaceholder="Cari kode, nama, area…" exportName="master-cabang"
          empty={<p className="p-8 text-center text-sm text-muted">Belum ada cabang. Upload daftar cabang sebelum import data PPM pertama.</p>} />
      </Card>
      {edit && <BranchModal branch={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Page>
  )
}

function BranchModal({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const [f, setF] = useState<Branch>(branch ?? { kode_cabang: '', nama: '', area: '', alamat: '', is_new_opening: false, go_date: null, active: true })
  const m = useRpc('fn_branch_upsert', { success: 'Cabang disimpan.' })
  const set = (k: keyof Branch, v: unknown) => setF({ ...f, [k]: v })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={branch ? `Ubah ${branch.nama}` : 'Cabang baru'}
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={m.isPending} disabled={!f.kode_cabang.trim() || !f.nama.trim()}
        onClick={async () => { try { const r = await m.mutateAsync({ rows: [f] }); if ((r as { ok: boolean }).ok) onClose() } catch { /* toast */ } }}>Simpan</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kode cabang" required hint="Sama dengan kode di data PPM."><Input value={f.kode_cabang} disabled={!!branch} onChange={(e) => set('kode_cabang', e.target.value.toUpperCase())} /></Field>
        <Field label="Nama cabang" required><Input value={f.nama} onChange={(e) => set('nama', e.target.value)} /></Field>
        <Field label="Area"><Input value={f.area ?? ''} onChange={(e) => set('area', e.target.value)} /></Field>
        <Field label="Tanggal Grand Opening"><Input type="date" value={f.go_date ?? ''} onChange={(e) => set('go_date', e.target.value || null)} /></Field>
        <Field label="Alamat kirim" className="sm:col-span-2"><Textarea value={f.alamat ?? ''} onChange={(e) => set('alamat', e.target.value)} className="min-h-16" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-500" checked={f.is_new_opening} onChange={(e) => set('is_new_opening', e.target.checked)} /> Cabang baru (akan GO)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-500" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Cabang aktif</label>
      </div>
    </Modal>
  )
}

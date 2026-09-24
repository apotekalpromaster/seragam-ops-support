import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { ConfirmDialog, Modal } from '../../components/dialog'
import { Button, Card, Chip, Field, Input, Select, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate } from '../../lib/format'
import { ReadOnlyNote } from './common'

interface Ovr { nik: string; nama: string; jabatan: string; cabang_nama: string; status: string; package_code: string; package_jabatan: string | null; alasan: string; created_at: string; created_by_nama: string | null }
interface Emp { nik: string; nama: string; jabatan: string; cabang_nama: string; package_code: string | null; status: string }
interface Pkg { package_code: string; nama: string }

export default function OverridesPage() {
  const q = useView<Ovr>('v_override', { order: [['nama', 'asc']] })
  const { isAdmin } = usePerm()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Ovr | null>(null)
  const rm = useRpc('fn_override_remove', { success: 'Override dihapus. Karyawan kembali memakai paket jabatannya.' })
  const columns = useMemo<ColumnDef<Ovr>[]>(() => [
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: r } }) => <div><p className="font-semibold">{r.nama}</p><p className="text-xs text-muted">{r.nik} · {r.jabatan} · {r.cabang_nama}</p></div> },
    { accessorKey: 'package_code', header: 'Paket khusus', cell: ({ row: { original: r } }) => <span><Chip tone="violet">{r.package_code}</Chip> <span className="text-xs text-muted">(jabatan: {r.package_jabatan ?? 'belum dimapping'})</span></span> },
    { accessorKey: 'alasan', header: 'Alasan' },
    { accessorKey: 'created_at', header: 'Ditetapkan', cell: ({ row: { original: r } }) => <span className="text-xs">{r.created_by_nama ?? '—'}<br /><span className="text-muted">{fmtDate(r.created_at)}</span></span> },
    ...(isAdmin ? [{ id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: r } }: { row: { original: Ovr } }) => <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(r)}>Hapus</Button> } as ColumnDef<Ovr>] : []),
  ], [isAdmin])
  return (
    <Page title="Override Karyawan" subtitle="Paket khusus per karyawan — mengalahkan mapping jabatan" help="override"
      actions={isAdmin && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Tambah override</Button>}>
      {!isAdmin && <ReadOnlyNote />}
      <Card bodyClass="p-0">
        <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['nik', 'nama', 'package_code']} searchPlaceholder="Cari NIK / nama…" exportName="override-karyawan"
          empty={<p className="p-8 text-center text-sm text-muted">Belum ada override. Semua karyawan memakai paket sesuai jabatannya.</p>} />
      </Card>
      {adding && <AddModal onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!removing} onOpenChange={() => setRemoving(null)} title={`Hapus override ${removing?.nama}?`} confirmLabel="Hapus override" danger loading={rm.isPending}
        onConfirm={async () => { try { await rm.mutateAsync({ nik: removing!.nik }) } catch { /* toast */ } setRemoving(null) }}>
        Karyawan kembali memakai paket jabatan <b>{removing?.package_jabatan ?? '(belum dimapping)'}</b>. Hak seragamnya dihitung ulang.
      </ConfirmDialog>
    </Page>
  )
}

function AddModal({ onClose }: { onClose: () => void }) {
  const emps = useView<Emp>('v_employee_list', { columns: 'nik,nama,jabatan,cabang_nama,package_code,status', filters: [['status', 'in', ['AKTIF', 'OFFERING']]], order: [['nama', 'asc']] })
  const pkgs = useView<Pkg>('package', { filters: [['active', 'eq', true]], order: [['package_code', 'asc']] })
  const [search, setSearch] = useState('')
  const [nik, setNik] = useState('')
  const [pkg, setPkg] = useState('')
  const [alasan, setAlasan] = useState('')
  const m = useRpc('fn_override_set', { success: 'Override disimpan.' })
  const matches = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (s.length < 2) return []
    return (emps.data ?? []).filter((e) => e.nik.toLowerCase().includes(s) || e.nama.toLowerCase().includes(s)).slice(0, 8)
  }, [emps.data, search])
  const chosen = emps.data?.find((e) => e.nik === nik)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Tambah override paket"
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={!nik || !pkg || alasan.trim().length < 5}
          onClick={async () => { try { await m.mutateAsync({ nik, package_code: pkg, alasan }); onClose() } catch { /* toast */ } }}>Simpan override</Button></>}>
      <div className="space-y-4">
        {!chosen ? (
          <Field label="Cari karyawan" hint="Ketik minimal 2 huruf NIK atau nama.">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus placeholder="mis. 2250012 atau Siti" />
            {matches.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-line">
                {matches.map((e) => (
                  <li key={e.nik}><button className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => setNik(e.nik)}>
                    <b>{e.nama}</b> <span className="text-muted">· {e.nik} · {e.jabatan} · {e.cabang_nama} · paket {e.package_code ?? '—'}</span>
                  </button></li>
                ))}
              </ul>
            )}
            {search.trim().length >= 2 && !matches.length && <p className="mt-2 text-sm text-muted">Tidak ditemukan karyawan aktif/joiner dengan kata kunci itu.</p>}
          </Field>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
            <span><b>{chosen.nama}</b> · {chosen.nik} · {chosen.jabatan} · paket jabatan {chosen.package_code ?? '—'}</span>
            <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => { setNik(''); setSearch('') }}>Ganti</button>
          </div>
        )}
        <Field label="Paket khusus" required>
          <Select value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">— pilih paket —</option>
            {pkgs.data?.map((p) => <option key={p.package_code} value={p.package_code}>{p.package_code} — {p.nama}</option>)}
          </Select>
        </Field>
        <Field label="Alasan" required hint="Wajib, minimal 5 karakter. Tercatat di audit log.">
          <Textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. tugas lapangan khusus, perlu tambahan polo" />
        </Field>
      </div>
    </Modal>
  )
}

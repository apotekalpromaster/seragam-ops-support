import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/dialog'
import { Button, Callout, Card, Chip, Field, Input, Select } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { useAuth, usePerm } from '../../lib/auth'
import { IS_DEMO } from '../../lib/db'
import { fmtDate } from '../../lib/format'
import { ROLE_LABEL } from '../../lib/labels'
import { ReadOnlyNote } from './common'

interface U { user_id: string; email: string; nama: string; role: string; aktif: boolean; created_at: string }

export default function UsersPage() {
  const q = useView<U>('app_user', { order: [['nama', 'asc']] })
  const { isAdmin } = usePerm()
  const { me } = useAuth()
  const [edit, setEdit] = useState<U | 'new' | null>(null)
  const columns = useMemo<ColumnDef<U>[]>(() => [
    { accessorKey: 'nama', header: 'Nama', cell: ({ row: { original: u } }) => <div><p className="font-semibold">{u.nama} {u.user_id === me?.user_id && <Chip tone="brand">Anda</Chip>}</p><p className="text-xs text-muted">{u.email}</p></div> },
    { accessorKey: 'email', header: 'Email', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'role', header: 'Role', cell: (c) => ROLE_LABEL[c.getValue() as string] },
    { accessorKey: 'aktif', header: 'Status', cell: (c) => (c.getValue() ? <Chip tone="green">aktif</Chip> : <Chip tone="slate">nonaktif</Chip>) },
    { accessorKey: 'created_at', header: 'Ditambahkan', cell: (c) => fmtDate(c.getValue() as string) },
    ...(isAdmin ? [{ id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: u } }: { row: { original: U } }) => <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(u)}>Ubah</Button> } as ColumnDef<U>] : []),
  ], [isAdmin, me])
  return (
    <Page title="Pengguna" subtitle="Akses dashboard berbasis role" help="pengguna"
      actions={isAdmin && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>Tambah pengguna</Button>}>
      {!isAdmin && <ReadOnlyNote />}
      <Callout tone="blue" title="Cara menambah pengguna">
        1) Buat akun login di Supabase → Authentication → Add user (email + password). 2) Tambahkan email yang sama di sini dan pilih role-nya. Akun yang login tanpa terdaftar di sini tidak bisa melihat data apa pun.
      </Callout>
      <Card bodyClass="p-0">
        <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['nama', 'email']} exportName="pengguna" />
      </Card>
      {edit && <UserModal user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Page>
  )
}

function UserModal({ user, onClose }: { user: U | null; onClose: () => void }) {
  const [email, setEmail] = useState(user?.email ?? '')
  const [nama, setNama] = useState(user?.nama ?? '')
  const [role, setRole] = useState(user?.role ?? 'staf')
  const [aktif, setAktif] = useState(user?.aktif ?? true)
  const m = useRpc('fn_user_upsert', { success: 'Pengguna disimpan.' })
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={user ? `Ubah ${user.nama}` : 'Tambah pengguna'} size="sm"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={m.isPending} disabled={!email.includes('@')}
        onClick={async () => { try { await m.mutateAsync({ email, nama, role, aktif }); onClose() } catch { /* toast */ } }}>Simpan</Button></>}>
      <div className="space-y-4">
        {IS_DEMO && !user && <Callout tone="amber">Di mode demo hanya 3 akun contoh yang ada, jadi email baru akan ditolak.</Callout>}
        <Field label="Email login" required><Input type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Nama"><Input value={nama} onChange={(e) => setNama(e.target.value)} /></Field>
        <Field label="Role" required>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">{ROLE_LABEL.admin} — semua fitur</option>
            <option value="staf">{ROLE_LABEL.staf} — transaksi & opname</option>
            <option value="viewer">{ROLE_LABEL.viewer} — lihat & export</option>
          </Select>
        </Field>
        {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-500" checked={aktif} onChange={(e) => setAktif(e.target.checked)} /> Akun aktif</label>}
      </div>
    </Modal>
  )
}

import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/dialog'
import { Button, Callout, Card, Chip, Field, Select } from '../../components/ui'
import { useRpc, useRpcQuery, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDateTime } from '../../lib/format'
import { ImpactPanel, ReadOnlyNote, type Impact } from './common'

interface Pos { jabatan: string; package_code: string | null; updated_at: string | null; jumlah_karyawan: number }
interface Pkg { package_code: string; nama: string; active: boolean; items: Record<string, number> }

export default function PositionsPage() {
  const q = useView<Pos>('v_position', { order: [['jabatan', 'asc']] })
  const pkgs = useView<Pkg>('v_package', { filters: [['active', 'eq', true]], order: [['package_code', 'asc']] })
  const { isAdmin } = usePerm()
  const [only, setOnly] = useState<'semua' | 'belum'>('semua')
  const [assign, setAssign] = useState<string[] | null>(null)
  const data = useMemo(() => (q.data ?? []).filter((r) => only === 'semua' || !r.package_code), [q.data, only])
  const unmapped = (q.data ?? []).filter((r) => !r.package_code).length

  useEffect(() => { if (unmapped > 0) setOnly('belum') }, [unmapped > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo<ColumnDef<Pos>[]>(() => [
    { accessorKey: 'jabatan', header: 'Jabatan (dari data PPM)', cell: (c) => <span className="font-semibold">{c.getValue() as string}</span> },
    { accessorKey: 'jumlah_karyawan', header: 'Karyawan aktif', meta: { align: 'right' } },
    { accessorKey: 'package_code', header: 'Paket', cell: ({ row: { original: r } }) => r.package_code
      ? <span className="font-medium">{r.package_code} <span className="text-xs text-muted">{pkgs.data?.find((p) => p.package_code === r.package_code)?.nama}</span></span>
      : <Chip tone="amber">Belum dimapping</Chip> },
    { accessorKey: 'updated_at', header: 'Diubah', cell: (c) => <span className="text-xs text-muted">{fmtDateTime(c.getValue() as string)}</span> },
    ...(isAdmin ? [{ id: 'aksi', header: '', enableSorting: false, meta: { noExport: true },
      cell: ({ row: { original: r } }: { row: { original: Pos } }) => <Button size="sm" variant={r.package_code ? 'ghost' : 'soft'} onClick={(e) => { e.stopPropagation(); setAssign([r.jabatan]) }}>{r.package_code ? 'Ubah' : 'Pilih paket'}</Button> } as ColumnDef<Pos>] : []),
  ], [isAdmin, pkgs.data])

  return (
    <Page title="Mapping Jabatan" subtitle="Satu jabatan = satu paket seragam" help="jabatan">
      {!isAdmin && <ReadOnlyNote />}
      {unmapped > 0 && (
        <Callout tone="amber" title={`${unmapped} jabatan dari data PPM belum dimapping`}>
          Karyawan dengan jabatan ini tidak masuk antrian alokasi sampai dipetakan ke paket. {isAdmin && 'Pilih beberapa sekaligus lewat kotak centang untuk bulk assign.'}
        </Callout>
      )}
      <Card bodyClass="p-0">
        <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} searchKeys={['jabatan', 'package_code']} searchPlaceholder="Cari jabatan atau paket…" exportName="mapping-jabatan"
          selectable={isAdmin} getRowId={(r) => r.jabatan}
          bulkActions={(rows, clear) => <Button size="sm" variant="primary" onClick={() => { setAssign(rows.map((r) => r.jabatan)); clear() }}>Tetapkan paket untuk {rows.length} jabatan</Button>}
          toolbar={<Select aria-label="Filter mapping" value={only} onChange={(e) => setOnly(e.target.value as 'semua' | 'belum')} className="h-10 w-52">
            <option value="semua">Semua jabatan</option>
            <option value="belum">Belum dimapping ({unmapped})</option>
          </Select>}
          empty={<p className="p-8 text-center text-sm text-muted">{only === 'belum' ? 'Semua jabatan sudah dimapping.' : 'Belum ada jabatan. Jabatan muncul otomatis setelah import data PPM.'}</p>} />
      </Card>
      {assign && <AssignModal jabatan={assign} current={q.data?.find((r) => r.jabatan === assign[0])?.package_code ?? ''} pkgs={pkgs.data ?? []} onClose={() => setAssign(null)} />}
    </Page>
  )
}

function AssignModal({ jabatan, current, pkgs, onClose }: { jabatan: string[]; current: string; pkgs: Pkg[]; onClose: () => void }) {
  const [pkg, setPkg] = useState(jabatan.length === 1 ? current : '')
  const preview = useRpcQuery<Impact>('fn_mapping_preview', { jabatan, package_code: pkg }, !!pkg)
  const m = useRpc('fn_mapping_set', { success: `Mapping ${jabatan.length} jabatan disimpan.` })
  const p = pkgs.find((x) => x.package_code === pkg)
  const items = useView<{ item_code: string; nama: string }>('item', { columns: 'item_code,nama' })
  const itemNames = Object.fromEntries((items.data ?? []).map((i) => [i.item_code, i.nama]))
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={jabatan.length === 1 ? `Paket untuk "${jabatan[0]}"` : `Tetapkan paket untuk ${jabatan.length} jabatan`} size="md"
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={!pkg || (jabatan.length === 1 && pkg === current)}
          onClick={async () => { try { await m.mutateAsync({ jabatan, package_code: pkg }); onClose() } catch { /* toast */ } }}>Simpan mapping</Button></>}>
      <div className="space-y-4">
        {jabatan.length > 1 && <p className="text-sm text-muted">{jabatan.join(', ')}</p>}
        <Field label="Paket" required>
          <Select value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">— pilih paket —</option>
            {pkgs.map((x) => <option key={x.package_code} value={x.package_code}>{x.package_code} — {x.nama}</option>)}
          </Select>
        </Field>
        {p && (
          <div>
            <p className="mb-1 text-xs text-muted">Isi paket versi terbaru (karyawan lama bisa memakai versi sebelumnya — lihat riwayat versi di Paket Alokasi):</p>
            <div className="flex flex-wrap gap-1.5">{Object.entries(p.items).filter(([, q]) => q > 0).map(([k, q]) => <Chip key={k} tone="brand">{itemNames[k] ?? k} × {q}</Chip>)}</div>
          </div>
        )}
        {pkg && <ImpactPanel impact={preview.data} loading={preview.isFetching && !preview.data} error={preview.error} />}
      </div>
    </Modal>
  )
}

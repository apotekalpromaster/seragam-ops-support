import type { ColumnDef } from '@tanstack/react-table'
import { Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Card, Chip, EmptyState, Select } from '../../components/ui'
import { useView } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { EMP_STATUS_LABEL } from '../../lib/labels'
import { EmployeeCard } from './EmployeeCard'

export interface EmployeeRow {
  nik: string; nama: string; gender: 'P' | 'W'; jabatan: string; kode_cabang: string; cabang_nama: string; area: string | null
  status: string; status_karyawan: string | null; is_loan: boolean; is_late_hire: boolean
  planned_join_date: string | null; join_date: string | null; planned_resign_date: string | null; resign_date: string | null
  size_kemeja: string | null; size_polo: string | null; size_blazer: string | null
  package_code: string | null; package_version: number | null; package_sumber: string | null
  entitlement_total: number; issued_total: number; outstanding_total: number; over_issued_total: number
  size_problem: boolean; jabatan_unmapped: boolean
}

const STATUS_TONE: Record<string, 'green' | 'brand' | 'red' | 'slate'> = { AKTIF: 'green', OFFERING: 'brand', RESIGN: 'red', BATAL_JOIN: 'slate' }

export default function EmployeesPage() {
  const [params, setParams] = useSearchParams()
  const q = useView<EmployeeRow>('v_employee_list', { order: [['nama', 'asc']] })
  const [open, setOpen] = useState<string | null>(null)
  const status = params.get('status') ?? 'AKTIF_OFFERING'
  const filter = params.get('filter') ?? ''
  const area = params.get('area') ?? ''
  const setParam = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }

  const areas = useMemo(() => [...new Set((q.data ?? []).map((r) => r.area).filter(Boolean))].sort() as string[], [q.data])
  const data = useMemo(() => (q.data ?? []).filter((r) =>
    (status === 'SEMUA' || (status === 'AKTIF_OFFERING' ? ['AKTIF', 'OFFERING'].includes(r.status) : r.status === status)) &&
    (!area || r.area === area) &&
    (!filter || (filter === 'ukuran' && r.size_problem) || (filter === 'outstanding' && r.outstanding_total > 0) ||
      (filter === 'unmapped' && r.jabatan_unmapped) || (filter === 'over' && r.over_issued_total > 0) || (filter === 'lengkap' && r.outstanding_total === 0 && !r.jabatan_unmapped)),
  ), [q.data, status, filter, area])

  const columns = useMemo<ColumnDef<EmployeeRow>[]>(() => [
    { accessorKey: 'nama', header: 'Karyawan', cell: ({ row: { original: r } }) => (
      <div><p className="font-semibold">{r.nama}</p><p className="text-xs text-muted">{r.nik}{r.is_loan && ' · PKL (pinjam)'}</p></div>
    ), meta: { exportHeader: 'Nama' } },
    { accessorKey: 'nik', header: 'NIK', meta: { className: 'hidden' }, cell: () => null },
    { accessorKey: 'jabatan', header: 'Jabatan' },
    { accessorKey: 'cabang_nama', header: 'Cabang', cell: ({ row: { original: r } }) => <div><p>{r.cabang_nama}</p><p className="text-xs text-muted">{r.area}</p></div> },
    { accessorKey: 'status', header: 'Status', cell: ({ row: { original: r } }) => (
      <div className="space-y-0.5">
        <Chip tone={STATUS_TONE[r.status]}>{EMP_STATUS_LABEL[r.status]}</Chip>
        <p className="text-xs text-muted">{r.status === 'OFFERING' ? `join ${fmtDate(r.planned_join_date)}` : r.status === 'RESIGN' ? fmtDate(r.resign_date) : r.planned_resign_date ? `resign ${fmtDate(r.planned_resign_date)}` : ''}</p>
      </div>
    ), meta: { exportValue: (r) => EMP_STATUS_LABEL[r.status] } },
    { id: 'ukuran', header: 'Ukuran kemeja / polo / blazer', accessorFn: (r) => `${r.size_kemeja ?? '—'} / ${r.size_polo ?? '—'} / ${r.size_blazer ?? '—'}`, enableSorting: false },
    { accessorKey: 'package_code', header: 'Paket', cell: ({ row: { original: r } }) => r.package_code
      ? <span className="font-medium">{r.package_code}{r.package_sumber === 'OVERRIDE' && <Chip tone="violet" className="ml-1">override</Chip>}</span>
      : <Chip tone="amber">Belum dimapping</Chip> },
    { accessorKey: 'outstanding_total', header: 'Belum dikirim', meta: { align: 'right' }, cell: ({ row: { original: r } }) => (
      <div className="flex items-center justify-end gap-2">
        {r.size_problem && <Chip tone="amber" title="Ukuran kosong atau tidak tersedia">ukuran</Chip>}
        <span className={r.outstanding_total ? 'font-bold text-brand-700' : 'text-slate-400'}>{r.outstanding_total} pcs</span>
      </div>
    ) },
  ], [])

  return (
    <Page title="Karyawan" subtitle="Data dari import PPM terakhir · hak & penerimaan seragam" help="karyawan">
      <Card bodyClass="p-0">
        <DataTable
          data={data} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
          searchKeys={['nik', 'nama', 'jabatan', 'cabang_nama']} searchPlaceholder="Cari NIK / nama / cabang…"
          exportName="karyawan-seragam" onRowClick={(r) => setOpen(r.nik)}
          toolbar={
            <>
              <Select aria-label="Filter status" value={status} onChange={(e) => setParam('status', e.target.value === 'AKTIF_OFFERING' ? '' : e.target.value)} className="h-10 w-44">
                <option value="AKTIF_OFFERING">Aktif + akan join</option>
                <option value="AKTIF">Aktif</option>
                <option value="OFFERING">Akan join</option>
                <option value="RESIGN">Resign</option>
                <option value="BATAL_JOIN">Batal join</option>
                <option value="SEMUA">Semua status</option>
              </Select>
              <Select aria-label="Filter kondisi" value={filter} onChange={(e) => setParam('filter', e.target.value)} className="h-10 w-56">
                <option value="">Semua kondisi</option>
                <option value="outstanding">Masih ada yang belum dikirim</option>
                <option value="ukuran">Ukuran kosong / tidak tersedia</option>
                <option value="unmapped">Jabatan belum dimapping</option>
                <option value="over">Menerima lebih dari hak</option>
                <option value="lengkap">Sudah lengkap</option>
              </Select>
              <Select aria-label="Filter area" value={area} onChange={(e) => setParam('area', e.target.value)} className="h-10 w-44">
                <option value="">Semua area</option>
                {areas.map((a) => <option key={a}>{a}</option>)}
              </Select>
            </>
          }
          empty={<EmptyState icon={<Users className="size-5" />} title="Tidak ada karyawan yang cocok">Ubah filter di atas, atau import data PPM terbaru.</EmptyState>}
        />
      </Card>
      {open && <EmployeeCard nik={open} onClose={() => setOpen(null)} />}
    </Page>
  )
}

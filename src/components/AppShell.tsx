import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  BookOpen, Boxes, CalendarDays, ClipboardCheck, Clock, Database, FileClock, FileUp, Home, LogOut, Menu, Package,
  RefreshCw, Ruler, Settings2, Shirt, Store, Tags, UserCog, Users, Network, UserRoundCog, X, FlaskConical, HelpCircle, ListTodo, Truck, ShoppingCart, Repeat, Undo2, ShieldCheck, BarChart3, Mail,
} from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useView } from '../lib/api'
import { useAuth, usePerm } from '../lib/auth'
import { IS_DEMO } from '../lib/db'
import { fmtDate, fmtDateLong, isoDate } from '../lib/format'
import { ROLE_LABEL } from '../lib/labels'
import { useSchedule } from '../lib/schedule'
import { ConfirmDialog } from './dialog'

interface NavItem { to: string; label: string; icon: ReactNode; badge?: number | string; badgeTone?: 'red' | 'amber' | 'brand'; adminOnly?: boolean }

function useNav(): { group: string; items: NavItem[] }[] {
  const { data: alerts } = useView<{ kode: string; level: string; jumlah: number }>('v_alert')
  const { data: opname } = useView<{ status: string }>('v_opname', { filters: [['status', 'eq', 'SUBMITTED']] })
  const { data: batches } = useView<{ status: string; terlambat: boolean }>('v_batch', { columns: 'status,terlambat', filters: [['status', 'in', ['DRAFT', 'PICKING', 'PACKED', 'SHIPPED']]] })
  const lateBatch = batches?.filter((b) => b.terlambat && b.status !== 'SHIPPED').length ?? 0
  const a = (k: string) => alerts?.find((x) => x.kode === k)?.jumlah
  const kritis = alerts?.filter((x) => x.level === 'KRITIS').length
  return [
    {
      group: 'Menu Utama',
      items: [
        { to: '/', label: 'Beranda', icon: <Home />, badge: kritis || undefined, badgeTone: 'red' },
        { to: '/import', label: 'Import Data PPM', icon: <FileUp />, badge: a('IMPORT_TERLAMBAT') ? '!' : undefined, badgeTone: 'red', adminOnly: true },
        { to: '/antrian', label: 'Antrian Alokasi', icon: <ListTodo />, badge: (a('UKURAN_KOSONG') ?? 0) + (a('UKURAN_TIDAK_TERSEDIA') ?? 0) || undefined, badgeTone: 'amber' },
        { to: '/batch', label: 'Batch Distribusi', icon: <Truck />, badge: lateBatch || batches?.length || undefined, badgeTone: lateBatch ? 'red' : 'brand' },
        { to: '/karyawan', label: 'Karyawan', icon: <Users /> },
        { to: '/stok', label: 'Stok', icon: <Boxes /> },
        { to: '/pengadaan', label: 'Pengadaan', icon: <ShoppingCart />, badge: a('SKU_KRITIS') || a('SKU_ORDER') || undefined, badgeTone: a('SKU_KRITIS') ? 'red' : 'amber' },
        { to: '/opname', label: 'Stock Opname', icon: <ClipboardCheck />, badge: opname?.length || undefined, badgeTone: 'brand' },
      ],
    },
    {
      group: 'Transaksi',
      items: [
        { to: '/transaksi', label: 'Tukar & Pembelian', icon: <Repeat /> },
        { to: '/retur', label: 'Pengembalian', icon: <Undo2 />, badge: (a('RETUR_TERLAMBAT') ?? 0) + (a('PERMINTAAN_RETUR') ?? 0) || undefined, badgeTone: a('RETUR_TERLAMBAT') ? 'red' : 'amber' },
        { to: '/qc', label: 'QC & Afkir', icon: <ShieldCheck />, badge: a('QC_MENUNGGU'), badgeTone: 'brand' },
        { to: '/laporan', label: 'Laporan & Export', icon: <BarChart3 /> },
      ],
    },
    {
      group: 'Master & Config',
      items: [
        { to: '/master/paket', label: 'Paket Alokasi', icon: <Package /> },
        { to: '/master/jabatan', label: 'Mapping Jabatan', icon: <Network />, badge: a('JABATAN_BELUM_DIMAPPING'), badgeTone: 'amber' },
        { to: '/master/override', label: 'Override Karyawan', icon: <UserRoundCog /> },
        { to: '/master/item', label: 'Item & SKU', icon: <Shirt /> },
        { to: '/master/harga', label: 'Harga & Vendor', icon: <Tags /> },
        { to: '/master/cabang', label: 'Cabang', icon: <Store /> },
        { to: '/master/ukuran', label: 'Size Curve & Chart', icon: <Ruler /> },
        { to: '/master/parameter', label: 'Parameter', icon: <Settings2 /> },
        { to: '/master/pengguna', label: 'Pengguna', icon: <UserCog />, adminOnly: true },
        { to: '/master/notifikasi', label: 'Notifikasi Email', icon: <Mail />, adminOnly: true },
      ],
    },
    {
      group: 'Lainnya',
      items: [
        { to: '/migrasi', label: 'Migrasi Data Awal', icon: <Database />, adminOnly: true },
        { to: '/audit', label: 'Riwayat & Audit Log', icon: <FileClock /> },
        { to: '/panduan', label: 'Panduan', icon: <BookOpen /> },
      ],
    },
  ]
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNav()
  const { me, signOut } = useAuth()
  const { isAdmin } = usePerm()
  const s = useSchedule()
  const [confirmOut, setConfirmOut] = useState(false)
  // Status batch reguler periode aktif menentukan warna deadline.
  const regQ = useView<{ status: string; shipped_at: string | null }>('v_batch', {
    columns: 'status,shipped_at', filters: [['jenis', 'eq', 'REGULER'], ['periode', 'eq', isoDate(new Date(s.periodStart.getFullYear(), s.periodStart.getMonth(), 1))], ['status', 'neq', 'DIBATALKAN']],
  })
  const regB = regQ.data?.[0]
  const reg = regQ.isLoading
    ? { text: s.daysToDeadline < 0 ? `lewat ${-s.daysToDeadline} hari` : `${s.daysToDeadline} hari lagi`, late: false }
    : regB && ['SHIPPED', 'SELESAI'].includes(regB.status)
    ? { text: `batch dikirim ${fmtDate(regB.shipped_at)}`, late: false }
    : s.daysToDeadline < 0
      ? { text: `${regB ? 'batch belum dikirim' : 'belum ada batch'} · lewat ${-s.daysToDeadline} hari`, late: true }
      : { text: s.daysToDeadline === 0 ? 'hari ini' : `${s.daysToDeadline} hari lagi${regB ? '' : ' · batch belum dibuat'}`, late: false }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-brand-500/30">
          <Shirt className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-extrabold leading-tight text-ink">Apotek Alpro</p>
          <p className="truncate text-sm font-semibold text-brand-600">Seragam Ops Support</p>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-[13px] text-brand-800">
          <p className="flex items-center gap-1.5 font-semibold"><CalendarDays className="size-3.5" /> Cutoff berikutnya</p>
          <p className="mt-0.5 num">{fmtDate(s.nextCutoff)} · <b>{s.daysToCutoff === 0 ? 'hari ini' : `${s.daysToCutoff} hari lagi`}</b></p>
          <p className="mt-2 flex items-center gap-1.5 font-semibold"><Clock className="size-3.5" /> Deadline kirim periode {s.periodLabel}</p>
          <p className={clsx('mt-0.5 num', reg.late && 'font-semibold text-red-700')}>
            {fmtDate(s.deadline)} · <b>{reg.text}</b>
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Menu utama">
        {nav.map((g) => {
          const items = g.items.filter((i) => !i.adminOnly || isAdmin)
          if (!items.length) return null
          return (
            <div key={g.group} className="mb-4">
              <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{g.group}</p>
              <ul className="space-y-1">
                {items.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} end={i.to === '/'} onClick={onNavigate}
                      className={({ isActive }) => clsx(
                        'group flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-[18px]',
                        isActive ? 'border-brand-200 bg-brand-50 text-brand-700 font-semibold' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-ink',
                      )}>
                      <span className="shrink-0">{i.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{i.label}</span>
                      {i.badge !== undefined && i.badge !== 0 && (
                        <span className={clsx('rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none text-white num',
                          i.badgeTone === 'red' ? 'bg-red-500' : i.badgeTone === 'amber' ? 'bg-amber-500' : 'bg-brand-500')}>{i.badge}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      {IS_DEMO && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
          <span><b>Mode demo.</b> Data contoh tersimpan di browser ini saja.</span>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-line px-4 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
          {(me?.nama ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{me?.nama}</p>
          <p className="truncate text-xs text-muted">{me?.role ? ROLE_LABEL[me.role] : ''}</p>
        </div>
        <button onClick={() => setConfirmOut(true)} className="rounded-lg border border-line p-2 text-slate-500 hover:bg-slate-50 hover:text-red-600" aria-label="Keluar" title="Keluar">
          <LogOut className="size-4" />
        </button>
      </div>
      <ConfirmDialog open={confirmOut} onOpenChange={setConfirmOut} title="Keluar dari aplikasi?" confirmLabel="Keluar" onConfirm={() => { setConfirmOut(false); void signOut() }}>
        Anda perlu login lagi untuk membuka dashboard.
      </ConfirmDialog>
    </div>
  )
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  return (
    <div className="flex h-full">
      <aside className="no-print hidden w-[280px] shrink-0 border-r border-line bg-white lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-white shadow-xl">
            <button className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)} aria-label="Tutup menu"><X className="size-5" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <MenuButtonContext.Provider value={() => setOpen(true)}>
          <Outlet />
        </MenuButtonContext.Provider>
      </div>
    </div>
  )
}

const MenuButtonContext = createContext<() => void>(() => {})

function Clock24() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const hh = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join('.')
  return <span className="num">{hh} WIB</span>
}

/** Kerangka halaman: header lengket (judul, subjudul, tanggal, refresh, aksi utama) + konten. */
export function Page({ title, subtitle, actions, help, children, wide }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; help?: string; children: ReactNode; wide?: boolean
}) {
  const openMenu = useContext(MenuButtonContext)
  const qc = useQueryClient()
  const [spin, setSpin] = useState(false)
  useEffect(() => { document.title = `${title} — Seragam Ops Support` }, [title])
  return (
    <>
      <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur sm:px-8 sm:py-4">
        <button className="rounded-xl border border-line p-2 text-slate-600 lg:hidden" onClick={openMenu} aria-label="Buka menu"><Menu className="size-5" /></button>
        <div className="min-w-[14rem] flex-1">
          <h1 className="flex items-center gap-2 truncate text-xl font-extrabold text-ink sm:text-[22px]">
            {title}
            {help && (
              <Link to={`/panduan#${help}`} className="text-slate-400 hover:text-brand-600" title="Buka panduan untuk halaman ini" aria-label="Panduan halaman ini">
                <HelpCircle className="size-[18px]" />
              </Link>
            )}
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-muted">
            Apotek Alpro <span className="mx-1">•</span> {subtitle ?? <span className="font-semibold text-emerald-600">Sistem Aktif</span>}
          </p>
        </div>
        <div className="hidden items-center gap-3 rounded-xl border border-line px-3.5 py-2 text-sm xl:flex">
          <span className="flex items-center gap-1.5 text-slate-600"><CalendarDays className="size-4" /> {fmtDateLong(new Date()).replace(/^(\w+), (\d+) (\w{3})\w* /, '$1, $2 $3 ')}</span>
          <span className="h-4 w-px bg-line" />
          <span className="flex items-center gap-1.5 font-semibold text-brand-600"><Clock className="size-4" /><Clock24 /></span>
        </div>
        <button
          onClick={async () => { setSpin(true); await qc.invalidateQueries(); setSpin(false) }}
          className="rounded-xl border border-line bg-slate-50 p-2.5 text-slate-600 hover:bg-slate-100" aria-label="Muat ulang data" title="Muat ulang data">
          <RefreshCw className={clsx('size-4', spin && 'animate-spin')} />
        </button>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <main className={clsx('min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8', !wide && '')}>
        <div className="mx-auto max-w-[1440px] space-y-6">{children}</div>
      </main>
    </>
  )
}

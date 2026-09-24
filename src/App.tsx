import { Loader2, ShieldAlert } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Button, LoadingBlock } from './components/ui'
import LoginPage from './features/auth/LoginPage'
import { DbProvider } from './lib/api'
import { useAuth } from './lib/auth'

// Halaman dimuat saat dibuka (APA di HP tidak perlu mengunduh seluruh dashboard admin)
const ApaApp = lazy(() => import('./features/apa/ApaApp'))
const AuditPage = lazy(() => import('./features/audit/AuditPage'))
const AntrianPage = lazy(() => import('./features/batch/AntrianPage'))
const BatchDetailPage = lazy(() => import('./features/batch/BatchDetailPage'))
const BatchListPage = lazy(() => import('./features/batch/BatchListPage'))
const PrintPage = lazy(() => import('./features/batch/PrintPage'))
const EmployeesPage = lazy(() => import('./features/employee/EmployeesPage'))
const GuidePage = lazy(() => import('./features/help/GuidePage'))
const ImportPage = lazy(() => import('./features/import/ImportPage'))
const BranchesPage = lazy(() => import('./features/master/BranchesPage'))
const ConfigPage = lazy(() => import('./features/master/ConfigPage'))
const ItemsPage = lazy(() => import('./features/master/ItemsPage'))
const OverridesPage = lazy(() => import('./features/master/OverridesPage'))
const PackagesPage = lazy(() => import('./features/master/PackagesPage'))
const PositionsPage = lazy(() => import('./features/master/PositionsPage'))
const PricesPage = lazy(() => import('./features/master/PricesPage'))
const SizesPage = lazy(() => import('./features/master/SizesPage'))
const UsersPage = lazy(() => import('./features/master/UsersPage'))
const MigrationPage = lazy(() => import('./features/migrasi/MigrationPage'))
const NotifikasiPage = lazy(() => import('./features/master/NotifikasiPage'))
const OpnamePage = lazy(() => import('./features/opname/OpnamePage'))
const OverviewPage = lazy(() => import('./features/overview/OverviewPage'))
const PengadaanPage = lazy(() => import('./features/pengadaan/PengadaanPage'))
const LaporanPage = lazy(() => import('./features/laporan/LaporanPage'))
const QcPage = lazy(() => import('./features/qc/QcPage'))
const ReturPage = lazy(() => import('./features/retur/ReturPage'))
const TransaksiPage = lazy(() => import('./features/transaksi/TransaksiPage'))
const PoDetailPage = lazy(() => import('./features/pengadaan/PoDetailPage'))
const PoPrintPage = lazy(() => import('./features/pengadaan/PoPrintPage'))
const StockPage = lazy(() => import('./features/stock/StockPage'))

export default function App() {
  const { db, me, loading, loadingMsg, signOut } = useAuth()

  if (loading || !db) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="size-8 animate-spin text-brand-500" />
        <p className="text-sm font-medium">{loadingMsg}</p>
      </div>
    )
  }

  return (
    <DbProvider db={db}>
      <ErrorBoundary>
      <Suspense fallback={<LoadingBlock />}>
      {!me ? (
        <LoginPage />
      ) : !me.role ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-sm">
            <ShieldAlert className="mx-auto size-10 text-amber-500" />
            <h1 className="mt-3 text-lg font-bold">Akun belum terdaftar</h1>
            <p className="mt-2 text-sm text-muted">
              Anda berhasil login, tetapi akun ini belum diberi akses ke dashboard seragam. Minta admin Ops Support menambahkan email Anda di menu Pengguna.
            </p>
            <Button className="mt-5" onClick={() => void signOut()}>Keluar</Button>
          </div>
        </div>
      ) : me.role === 'apa' ? (
        // APA/Branch Manager: tampilan terpisah, hanya data cabangnya (lewat RPC)
        <Routes><Route path="*" element={<ApaApp />} /></Routes>
      ) : (
        <Routes>
          <Route path="cetak/batch/:id/:doc" element={<PrintPage />} />
          <Route path="cetak/po/:id" element={<PoPrintPage />} />
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="antrian" element={<AntrianPage />} />
            <Route path="batch" element={<BatchListPage />} />
            <Route path="batch/:id" element={<BatchDetailPage />} />
            <Route path="karyawan" element={<EmployeesPage />} />
            <Route path="stok" element={<StockPage />} />
            <Route path="opname" element={<OpnamePage />} />
            <Route path="pengadaan" element={<PengadaanPage />} />
            <Route path="pengadaan/po/:id" element={<PoDetailPage />} />
            <Route path="transaksi" element={<TransaksiPage />} />
            <Route path="retur" element={<ReturPage />} />
            <Route path="qc" element={<QcPage />} />
            <Route path="laporan" element={<LaporanPage />} />
            <Route path="master/paket" element={<PackagesPage />} />
            <Route path="master/jabatan" element={<PositionsPage />} />
            <Route path="master/override" element={<OverridesPage />} />
            <Route path="master/item" element={<ItemsPage />} />
            <Route path="master/harga" element={<PricesPage />} />
            <Route path="master/cabang" element={<BranchesPage />} />
            <Route path="master/ukuran" element={<SizesPage />} />
            <Route path="master/parameter" element={<ConfigPage />} />
            <Route path="master/pengguna" element={<UsersPage />} />
            <Route path="master/notifikasi" element={<NotifikasiPage />} />
            <Route path="migrasi" element={<MigrationPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="panduan" element={<GuidePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
      </Suspense>
      </ErrorBoundary>
    </DbProvider>
  )
}

import { Loader2, ShieldAlert } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Button } from './components/ui'
import AuditPage from './features/audit/AuditPage'
import LoginPage from './features/auth/LoginPage'
import EmployeesPage from './features/employee/EmployeesPage'
import GuidePage from './features/help/GuidePage'
import ImportPage from './features/import/ImportPage'
import BranchesPage from './features/master/BranchesPage'
import ConfigPage from './features/master/ConfigPage'
import ItemsPage from './features/master/ItemsPage'
import OverridesPage from './features/master/OverridesPage'
import PackagesPage from './features/master/PackagesPage'
import PositionsPage from './features/master/PositionsPage'
import PricesPage from './features/master/PricesPage'
import SizesPage from './features/master/SizesPage'
import UsersPage from './features/master/UsersPage'
import MigrationPage from './features/migrasi/MigrationPage'
import OpnamePage from './features/opname/OpnamePage'
import OverviewPage from './features/overview/OverviewPage'
import StockPage from './features/stock/StockPage'
import { DbProvider } from './lib/api'
import { useAuth } from './lib/auth'

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
      ) : (
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="karyawan" element={<EmployeesPage />} />
            <Route path="stok" element={<StockPage />} />
            <Route path="opname" element={<OpnamePage />} />
            <Route path="master/paket" element={<PackagesPage />} />
            <Route path="master/jabatan" element={<PositionsPage />} />
            <Route path="master/override" element={<OverridesPage />} />
            <Route path="master/item" element={<ItemsPage />} />
            <Route path="master/harga" element={<PricesPage />} />
            <Route path="master/cabang" element={<BranchesPage />} />
            <Route path="master/ukuran" element={<SizesPage />} />
            <Route path="master/parameter" element={<ConfigPage />} />
            <Route path="master/pengguna" element={<UsersPage />} />
            <Route path="migrasi" element={<MigrationPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="panduan" element={<GuidePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </DbProvider>
  )
}

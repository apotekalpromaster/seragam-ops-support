import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Menangkap error tampilan supaya pengguna tidak melihat layar putih (heuristik #9).
 * Dipasang di sekitar isi halaman (menu tetap bisa dipakai) dan di akar aplikasi.
 * `resetKey` (mis. path URL) mengosongkan error saat pengguna pindah halaman.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error tampilan', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const e = this.state.error
    if (!e) return this.props.children
    // Setelah aplikasi diperbarui, file halaman lama tidak ada lagi di server
    const versiBaru = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(e.message)
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div role="alert" className="max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto size-10 text-amber-500" />
          <h2 className="mt-3 text-lg font-bold">{versiBaru ? 'Versi aplikasi baru tersedia' : 'Halaman ini tidak bisa ditampilkan'}</h2>
          <p className="mt-2 text-sm text-muted">
            {versiBaru
              ? 'Aplikasi baru saja diperbarui. Muat ulang untuk memakai versi terbaru — data Anda aman.'
              : 'Terjadi kesalahan saat menampilkan halaman. Data tidak berubah. Coba muat ulang; bila berulang, hubungi tim IT dengan menyebut halaman dan waktu kejadian.'}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => window.location.reload()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
              <RefreshCw className="size-4" /> Muat ulang
            </button>
            {!versiBaru && <a href="/" className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:bg-slate-50">Ke Beranda</a>}
          </div>
        </div>
      </div>
    )
  }
}

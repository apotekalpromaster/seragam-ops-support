import * as D from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { AlertTriangle, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Input } from './ui'

export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md' }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode
  children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px]" />
        <D.Content
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-2xl',
            { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size],
          )}
          // Klik di luar tidak menutup modal: isian form tidak hilang karena salah klik (tutup lewat ✕, Batal, atau Esc).
          onInteractOutside={(e) => e.preventDefault()}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <D.Title className="text-lg font-bold text-ink">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
            </div>
            <D.Close asChild>
              <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Tutup"><X className="size-5" /></button>
            </D.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-slate-50/60 px-6 py-4 rounded-b-2xl">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

export function Drawer({ open, onOpenChange, title, subtitle, children, footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-900/30" />
        <D.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-page shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-line bg-white px-6 py-4">
            <div className="min-w-0">
              <D.Title className="truncate text-lg font-bold text-ink">{title}</D.Title>
              <D.Description className={subtitle ? 'mt-0.5 text-sm text-muted' : 'sr-only'}>{subtitle ?? String(title)}</D.Description>
            </div>
            <D.Close asChild>
              <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Tutup"><X className="size-5" /></button>
            </D.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line bg-white px-6 py-4">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/**
 * Konfirmasi aksi berisiko (heuristik #5). Menampilkan ringkasan dampak; untuk
 * aksi yang tidak bisa dibatalkan, pengguna mengetik kata konfirmasi.
 */
export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, onConfirm, loading, danger, irreversible, typeToConfirm, disabled }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children?: ReactNode
  confirmLabel: string; onConfirm: () => void; loading?: boolean; danger?: boolean
  irreversible?: boolean; typeToConfirm?: string
  /** Nonaktifkan tombol konfirmasi (mis. alasan wajib belum diisi). */
  disabled?: boolean
}) {
  const [typed, setTyped] = useState('')
  const ok = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase()
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) setTyped(''); onOpenChange(o) }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>Batal</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} disabled={!ok || disabled}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-700">
        {children}
        {irreversible && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Tindakan ini tidak bisa dibatalkan. Kesalahan hanya bisa diperbaiki dengan transaksi koreksi.
          </p>
        )}
        {typeToConfirm && (
          <label className="block space-y-1.5">
            <span className="font-semibold">Ketik <code className="rounded bg-slate-100 px-1.5 py-0.5 text-ink">{typeToConfirm}</code> untuk melanjutkan</span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
        )}
      </div>
    </Modal>
  )
}

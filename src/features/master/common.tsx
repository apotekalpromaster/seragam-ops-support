import { Lock } from 'lucide-react'
import { Callout, Chip, LoadingBlock } from '../../components/ui'
import { fmtNum } from '../../lib/format'

export function ReadOnlyNote() {
  return (
    <Callout tone="blue" icon={<Lock className="size-4" />}>
      Anda bisa melihat data ini, tetapi hanya admin Ops Support yang bisa mengubahnya.
    </Callout>
  )
}

export interface Impact {
  karyawan_terdampak: number
  karyawan_dicek: number
  tambahan_outstanding: { sku_code: string; label: string; qty: number }[]
  total_tambahan_pcs: number
  total_berkurang_pcs: number
  karyawan_over_issued: number
  karyawan_tanpa_ukuran_valid: number
}

/** Ringkasan dampak perubahan paket/mapping (PRD §4.1b poin 7). */
export function ImpactPanel({ impact, loading, error }: { impact?: Impact; loading?: boolean; error?: unknown }) {
  if (loading) return <LoadingBlock rows={2} />
  if (error) return <Callout tone="red">Preview dampak gagal dihitung: {error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, '') : ''}</Callout>
  if (!impact) return null
  const none = impact.karyawan_terdampak === 0
  return (
    <div className="space-y-3 rounded-xl border border-line bg-slate-50/60 p-4 text-sm">
      <p className="font-bold">Preview dampak</p>
      {none ? <p className="text-muted">Tidak ada karyawan aktif/joiner yang haknya berubah.</p> : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Box label="Karyawan terdampak" value={impact.karyawan_terdampak} />
            <Box label="Tambahan outstanding" value={impact.total_tambahan_pcs} suffix="pcs" tone={impact.total_tambahan_pcs ? 'brand' : undefined} />
            <Box label="Menjadi over-issued" value={impact.karyawan_over_issued} suffix="orang" tone={impact.karyawan_over_issued ? 'amber' : undefined}
              hint="Hak berkurang di bawah yang sudah diterima. Tidak memicu retur otomatis, hanya ditandai." />
          </div>
          {impact.karyawan_tanpa_ukuran_valid > 0 && (
            <p className="text-amber-700">{impact.karyawan_tanpa_ukuran_valid} karyawan belum punya ukuran valid untuk item tambahan — perlu dilengkapi sebelum bisa dikirim.</p>
          )}
          {impact.tambahan_outstanding.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Perubahan outstanding per SKU</p>
              <div className="flex flex-wrap gap-1.5">
                {impact.tambahan_outstanding.map((t) => (
                  <Chip key={t.sku_code + t.label} tone={t.qty > 0 ? 'brand' : 'slate'}>{t.label}: {t.qty > 0 ? '+' : ''}{t.qty}</Chip>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Box({ label, value, suffix, tone, hint }: { label: string; value: number; suffix?: string; tone?: 'brand' | 'amber'; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-bold num ${tone === 'brand' ? 'text-brand-700' : tone === 'amber' ? 'text-amber-600' : ''}`}>{fmtNum(value)} {suffix && <span className="text-xs font-medium text-muted">{suffix}</span>}</p>
    </div>
  )
}

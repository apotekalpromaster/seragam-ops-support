import { AlertTriangle, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../components/dialog'
import { Button, Callout, Field, Input, Select, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { fmtNum, fmtRp, isoDate, isoToday } from '../../lib/format'
import { sisaSaran, type PlanRow } from './planning'

interface Vendor { id: number; nama: string; lead_time_default: number; active: boolean }
interface Line { sku_code: string; label: string; moq: number; saran: number; qty: string; harga: number | null; lead: number; draft: number }
interface Group { key: string; vendorId: string; eta: string; etaTouched: boolean; catatan: string; lines: Line[] }

const addDays = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return isoDate(x) }

/** Buat PO draft dari saran order, dikelompokkan per vendor (PRD §7.5). Qty bisa diedit sebelum disimpan. */
export function CreatePoModal({ rows, onClose }: { rows: PlanRow[]; onClose: () => void }) {
  const nav = useNavigate()
  const vendors = useView<Vendor>('vendor', { filters: [['active', 'eq', true]], order: [['nama', 'asc']] })
  const [groups, setGroups] = useState<Group[]>(() => {
    const m = new Map<string, Group>()
    for (const r of rows) {
      const key = r.vendor_id ? String(r.vendor_id) : 'none'
      const g = m.get(key) ?? { key, vendorId: r.vendor_id ? String(r.vendor_id) : '', eta: '', etaTouched: false, catatan: '', lines: [] }
      g.lines.push({ sku_code: r.sku_code, label: r.label, moq: r.moq, saran: r.suggested_order, qty: String(sisaSaran(r) || r.moq), harga: r.price, lead: r.lead_time_days, draft: r.qty_po_draft })
      m.set(key, g)
    }
    return [...m.values()].map((g) => ({ ...g, eta: addDays(Math.max(...g.lines.map((l) => l.lead))) }))
  })
  const m = useRpc<unknown, { ids: number[]; kode: string[] }>('fn_po_create', { success: (r) => `${r.kode.length} PO draft dibuat: ${r.kode.join(', ')}.` })

  const upd = (key: string, f: (g: Group) => Group) => setGroups((gs) => gs.map((g) => (g.key === key ? f(g) : g)))
  const removeLine = (key: string, sku: string) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, lines: g.lines.filter((l) => l.sku_code !== sku) } : g)).filter((g) => g.lines.length))
  const lineErr = (l: Line) => (!/^\d+$/.test(l.qty.trim()) || Number(l.qty) <= 0 ? 'Isi qty > 0' : null)
  const problems = useMemo(() => groups.flatMap((g) => [
    ...(!g.vendorId ? [`Pilih vendor untuk ${g.lines.length} SKU tanpa vendor`] : []),
    ...g.lines.filter(lineErr).map((l) => `${l.label}: qty tidak valid`),
    ...(g.eta && g.eta < isoToday() ? ['Perkiraan tiba tidak boleh sebelum hari ini'] : []),
  ]), [groups])
  const total = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + (Number(l.qty) || 0), 0), 0)
  const nilai = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + (Number(l.qty) || 0) * (l.harga ?? 0), 0), 0)

  async function save() {
    try {
      const r = await m.mutateAsync({
        pos: groups.map((g) => ({
          vendor_id: Number(g.vendorId), eta: g.eta || null, catatan: g.catatan,
          lines: g.lines.map((l) => ({ sku_code: l.sku_code, qty: Number(l.qty), saran: l.saran, harga: l.harga })),
        })),
      })
      onClose()
      nav(r.ids.length === 1 ? `/pengadaan/po/${r.ids[0]}` : '/pengadaan?tab=po&status=DRAFT')
    } catch { /* toast */ }
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="xl" title="Buat purchase order"
      description="Satu PO per vendor. Qty awal = saran order (sudah kelipatan MOQ) dan bisa diubah. PO disimpan sebagai draft; kirim ke vendor dari halaman PO."
      footer={<>
        <span className="mr-auto text-sm text-muted">{groups.length} PO · {fmtNum(total)} pcs · perkiraan {fmtRp(nilai)}</span>
        <Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={!!problems.length || !groups.length} onClick={() => void save()}
          title={problems[0]}>Simpan {groups.length} PO sebagai draft</Button>
      </>}>
      <div className="space-y-5">
        {problems.length > 0 && <Callout tone="amber" icon={<AlertTriangle className="size-4" />}>{problems[0]}{problems.length > 1 && ` (+${problems.length - 1} lainnya)`}</Callout>}
        {groups.map((g, gi) => {
          const v = vendors.data?.find((x) => String(x.id) === g.vendorId)
          return (
            <section key={g.key} className="rounded-2xl border border-line">
              <div className="grid gap-3 border-b border-line bg-slate-50/70 p-4 sm:grid-cols-[1fr_180px_1fr]">
                <Field label={`PO ${gi + 1} · Vendor`} required error={!g.vendorId ? 'SKU ini belum punya vendor di master harga' : undefined}>
                  <Select value={g.vendorId} aria-invalid={!g.vendorId} onChange={(e) => {
                    const nv = vendors.data?.find((x) => String(x.id) === e.target.value)
                    upd(g.key, (x) => ({ ...x, vendorId: e.target.value, eta: x.etaTouched || !nv ? x.eta : addDays(nv.lead_time_default) }))
                  }}>
                    <option value="">Pilih vendor…</option>
                    {vendors.data?.map((x) => <option key={x.id} value={x.id}>{x.nama}</option>)}
                  </Select>
                </Field>
                <Field label="Perkiraan tiba (ETA)" hint={v ? `Lead time ${Math.max(...g.lines.map((l) => l.lead))} hari` : undefined}>
                  <Input type="date" value={g.eta} min={isoToday()} onChange={(e) => upd(g.key, (x) => ({ ...x, eta: e.target.value, etaTouched: true }))} />
                </Field>
                <Field label="Catatan untuk vendor">
                  <Textarea className="min-h-10" value={g.catatan} onChange={(e) => upd(g.key, (x) => ({ ...x, catatan: e.target.value }))} placeholder="mis. kirim ke gudang HQ, lantai 2" />
                </Field>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2">SKU</th><th className="px-2 py-2 text-right">Saran</th><th className="w-32 px-2 py-2 text-right">Qty order</th><th className="px-2 py-2 text-right">Harga</th><th className="px-2 py-2 text-right">Nilai</th><th className="w-10" /></tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => {
                    const err = lineErr(l)
                    const q = Number(l.qty) || 0
                    const notMoq = !err && q % l.moq !== 0
                    return (
                      <tr key={l.sku_code} className="border-t border-line align-top">
                        <td className="px-4 py-2">
                          <p className="font-semibold">{l.label}</p>
                          <p className="text-xs text-muted"><code>{l.sku_code}</code> · MOQ {l.moq}</p>
                          {l.draft > 0 && <p className="text-xs font-semibold text-amber-700">Sudah ada {l.draft} pcs di PO draft lain{l.saran ? ' — qty awal = sisa saran' : ''}</p>}
                        </td>
                        <td className="px-2 py-2 text-right num text-muted">{l.saran ? fmtNum(l.saran) : '—'}</td>
                        <td className="px-2 py-2 text-right">
                          <Input aria-label={`Qty ${l.label}`} inputMode="numeric" className="h-9 text-right num" value={l.qty} aria-invalid={!!err}
                            onChange={(e) => upd(g.key, (x) => ({ ...x, lines: x.lines.map((y) => (y.sku_code === l.sku_code ? { ...y, qty: e.target.value } : y)) }))} />
                          {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
                          {notMoq && <p className="mt-0.5 text-xs text-amber-700">bukan kelipatan MOQ {l.moq}</p>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right num">{fmtRp(l.harga)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right font-semibold num">{fmtRp(q * (l.harga ?? 0))}</td>
                        <td className="px-2 py-2"><button aria-label={`Hapus ${l.label}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => removeLine(g.key, l.sku_code)}><X className="size-4" /></button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
        {!groups.length && <p className="py-6 text-center text-sm text-muted">Semua SKU sudah dihapus dari daftar. Tutup lalu pilih SKU lagi.</p>}
        <p className="text-xs text-muted">Harga = price list yang berlaku hari ini, sebagai perkiraan nilai PO.</p>
      </div>
    </Modal>
  )
}

import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmployeePicker, type PickedEmployee } from '../../components/EmployeePicker'
import { Modal } from '../../components/dialog'
import { Button, Callout, Field, Input, Select, Textarea } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { fmtMonth, fmtRp, isoToday } from '../../lib/format'

interface SkuRow { sku_code: string; label: string; item_code: string; item_sort: number; gender: string; size_order: number; available: number; price: number | null }
interface Line { key: number; sku: string; qty: string }

const thisMonth = () => isoToday().slice(0, 7)

/** Pembelian karyawan dengan potong gaji (PRD §4.4, AC #7, #10). */
export function SaleModal({ initial, initialSku, onClose }: { initial?: PickedEmployee | null; initialSku?: string; onClose: () => void }) {
  const [emp, setEmp] = useState<PickedEmployee | null>(initial ?? null)
  const [lines, setLines] = useState<Line[]>([{ key: 1, sku: initialSku ?? '', qty: '1' }])
  const [periode, setPeriode] = useState(thisMonth())
  const [tanggal, setTanggal] = useState(isoToday())
  const [catatan, setCatatan] = useState('')
  const skus = useView<SkuRow>('v_stock_sku', { filters: [['active', 'eq', true]], order: [['item_sort', 'asc'], ['gender', 'asc'], ['size_order', 'asc']] })
  const m = useRpc<unknown, { kode: string; pcs: number; nilai: number }>('fn_sale_create', {
    success: (r) => `Pembelian ${r.kode} dicatat: ${r.pcs} pcs, ${fmtRp(r.nilai)} dipotong gaji ${fmtMonth(`${periode}-01`)}.`,
  })
  const opts = useMemo(() => (skus.data ?? []).filter((s) => !emp || s.gender === 'U' || s.gender === emp.gender), [skus.data, emp])
  const find = (c: string) => skus.data?.find((s) => s.sku_code === c)
  const errOf = (l: Line) => {
    const s = find(l.sku)
    if (!l.sku) return 'Pilih barang'
    if (!/^\d+$/.test(l.qty.trim()) || Number(l.qty) <= 0) return 'Qty > 0'
    if (s && Number(l.qty) > s.available) return `Stok tersedia ${s.available}`
    if (s && s.price == null) return 'Harga belum ada di price list'
    if (lines.filter((x) => x.sku === l.sku).length > 1) return 'Barang dobel'
    return null
  }
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (find(l.sku)?.price ?? 0), 0)
  const ok = emp && periode && lines.length > 0 && lines.every((l) => !errOf(l))
  const setLine = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)))

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title="Catat pembelian (potong gaji)"
      description="Harga otomatis dari price list. Barang beli bukan pemenuhan hak alokasi dan tidak wajib dikembalikan saat resign."
      footer={<>
        <span className="mr-auto text-sm text-muted">Total <b className="text-ink">{fmtRp(total)}</b></span>
        <Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={!ok}
          onClick={async () => { try { await m.mutateAsync({ nik: emp!.nik, tanggal, periode_potong: periode, catatan, lines: lines.map((l) => ({ sku_code: l.sku, qty: Number(l.qty) })) }); onClose() } catch { /* toast */ } }}>
          Simpan pembelian
        </Button>
      </>}>
      <div className="space-y-4">
        <EmployeePicker value={emp} onChange={setEmp} />
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">Barang <span className="text-red-500" aria-hidden>*</span></p>
          {lines.map((l) => {
            const s = find(l.sku)
            const err = l.sku || l.qty !== '1' ? errOf(l) : null
            return (
              <div key={l.key} className="grid grid-cols-[1fr_90px_110px_32px] items-start gap-2">
                <div>
                  <Select aria-label="Barang" value={l.sku} onChange={(e) => setLine(l.key, { sku: e.target.value })}>
                    <option value="">— pilih barang —</option>
                    {opts.map((o) => <option key={o.sku_code} value={o.sku_code} disabled={o.available <= 0}>{o.label} — {fmtRp(o.price)} · tersedia {o.available}</option>)}
                  </Select>
                  {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
                </div>
                <Input aria-label="Qty" inputMode="numeric" className="text-right num" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                <p className="pt-2.5 text-right text-sm font-semibold num">{fmtRp((Number(l.qty) || 0) * (s?.price ?? 0))}</p>
                <button type="button" aria-label="Hapus baris" disabled={lines.length === 1} className="mt-1.5 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X className="size-4" /></button>
              </div>
            )
          })}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, { key: Date.now(), sku: '', qty: '1' }])}>Tambah barang</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Periode potong gaji" required hint={periode ? `Masuk export potong gaji ${fmtMonth(`${periode}-01`)}.` : undefined}>
            <Input type="month" value={periode} min={tanggal.slice(0, 7)} onChange={(e) => setPeriode(e.target.value)} />
          </Field>
          <Field label="Tanggal pembelian"><Input type="date" value={tanggal} max={isoToday()} onChange={(e) => setTanggal(e.target.value)} /></Field>
        </div>
        <Field label="Catatan"><Textarea className="min-h-14" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. pengganti kemeja robek; salah ukuran" /></Field>
        {emp && emp.status !== 'AKTIF' && <Callout tone="amber">Karyawan belum aktif (akan join). Pastikan Payroll sudah bisa memotong gaji pada periode yang dipilih.</Callout>}
      </div>
    </Modal>
  )
}

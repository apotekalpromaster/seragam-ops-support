import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, ShoppingBag } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmployeePicker, type PickedEmployee } from '../../components/EmployeePicker'
import { Modal } from '../../components/dialog'
import { Button, Callout, Field, Input, Select, Textarea } from '../../components/ui'
import { useRpc, useRpcQuery, useView } from '../../lib/api'
import { fmtDate, isoToday } from '../../lib/format'

interface ItemRow { item_code: string; item_nama: string; issued_net: number; item_sort: number }
interface SkuRow { sku_code: string; label: string; item_code: string; gender: string; size_order: number; available: number }
interface Check { ok: boolean; acuan: 'DITERIMA' | 'DIKIRIM'; tanggal_kirim: string | null; issue_date: string | null; hari: number | null; batas: number; alasan_tolak: string | null; sku_in: string | null; issued_net: number }

const ALASAN = [
  { v: 'CACAT_PRODUKSI', l: 'Cacat produksi', d: 'Jahitan lepas, noda, logo rusak, dsb. Pengganti ukuran sama.' },
  { v: 'DEVIASI_SPEK_VENDOR', l: 'Deviasi spek vendor', d: 'Ukuran fisik tidak sesuai size chart. Boleh ganti ukuran.' },
  { v: 'SALAH_UKURAN', l: 'Salah pilih ukuran / alasan lain', d: 'Tidak bisa ditukar — diproses sebagai pembelian.' },
]

/** Tukar karena cacat (PRD §4.3, AC #5). Ditolak → tawarkan pembelian. */
export function ExchangeModal({ initial, onClose, onBuyInstead }: {
  initial?: PickedEmployee | null
  onClose: () => void
  onBuyInstead: (emp: PickedEmployee, sku?: string) => void
}) {
  const [emp, setEmp] = useState<PickedEmployee | null>(initial ?? null)
  const [item, setItem] = useState('')
  const [alasan, setAlasan] = useState('')
  const [skuOut, setSkuOut] = useState('')
  const [qty, setQty] = useState('1')
  const [approver, setApprover] = useState('')
  const [catatan, setCatatan] = useState('')
  const [tanggal, setTanggal] = useState(isoToday())
  const items = useView<ItemRow>('v_employee_item', { filters: [['nik', 'eq', emp?.nik ?? ''], ['issued_net', 'gt', 0]], order: [['item_sort', 'asc']] }, !!emp)
  const skus = useView<SkuRow>('v_stock_sku', { filters: [['item_code', 'eq', item], ['active', 'eq', true]], order: [['gender', 'asc'], ['size_order', 'asc']] }, !!item)
  const chk = useRpcQuery<Check>('fn_exchange_check', { nik: emp?.nik, item_code: item, tanggal }, !!emp && !!item)
  const m = useRpc<unknown, { kode: string }>('fn_exchange_create', { success: (r) => `Tukar ${r.kode} dicatat. Barang cacat masuk karantina (menunggu QC); pengganti keluar dari stok.` })

  useEffect(() => { setItem(''); setSkuOut('') }, [emp?.nik])
  useEffect(() => { if (items.data?.length === 1) setItem(items.data[0].item_code) }, [items.data])
  // Cacat produksi: default pengganti = ukuran yang sama
  useEffect(() => { if (chk.data?.sku_in && (!skuOut || alasan === 'CACAT_PRODUKSI')) setSkuOut(chk.data.sku_in) }, [chk.data?.sku_in, alasan]) // eslint-disable-line react-hooks/exhaustive-deps

  const skuOpts = useMemo(() => (skus.data ?? []).filter((s) => !emp || s.gender === 'U' || s.gender === emp.gender), [skus.data, emp])
  const out = skuOpts.find((s) => s.sku_code === skuOut)
  const q = Number(qty)
  const salahUkuran = alasan === 'SALAH_UKURAN'
  const ditolak = salahUkuran || (chk.data && !chk.data.ok)
  const qtyErr = !/^\d+$/.test(qty.trim()) || q <= 0 ? 'Isi qty > 0' : chk.data && q > chk.data.issued_net ? `Maks. ${chk.data.issued_net} (yang diterima)` : null
  const stokErr = out && q > out.available ? `Stok tersedia ${out.available} pcs` : null
  const ready = emp && item && alasan && !ditolak && chk.data?.ok && skuOut && !qtyErr && !stokErr && approver.trim().length >= 3

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="lg" title="Tukar barang cacat"
      description="Hanya untuk cacat produksi atau deviasi spek vendor, paling lambat sesuai batas hari sejak barang diterima cabang. Salah pilih ukuran = pembelian."
      footer={<>
        <Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={!ready}
          onClick={async () => { try { await m.mutateAsync({ nik: emp!.nik, item_code: item, sku_in: chk.data?.sku_in, sku_out: skuOut, qty: q, alasan, approver, catatan, tanggal }); onClose() } catch { /* toast */ } }}>
          Simpan tukar
        </Button>
      </>}>
      <div className="space-y-4">
        <EmployeePicker value={emp} onChange={setEmp} />
        {emp && (
          <Field label="Item yang ditukar" required htmlFor="ex-item" hint={items.data && !items.data.length ? 'Karyawan ini belum pernah menerima seragam dari alokasi.' : undefined}>
            <Select id="ex-item" value={item} onChange={(e) => { setItem(e.target.value); setSkuOut('') }}>
              <option value="">— pilih item —</option>
              {items.data?.map((i) => <option key={i.item_code} value={i.item_code}>{i.item_nama} (diterima {i.issued_net} pcs)</option>)}
            </Select>
          </Field>
        )}
        {emp && item && chk.data && (
          chk.data.ok
            ? <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> {chk.data.acuan === 'DITERIMA' ? `Diterima cabang ${fmtDate(chk.data.issue_date)}` : `Dikirim ${fmtDate(chk.data.issue_date)} (cabang belum konfirmasi terima)`} — {chk.data.hari} dari {chk.data.batas} hari batas tukar.</p>
            : <Callout tone="red" icon={<AlertTriangle className="size-4" />} title="Tidak bisa ditukar"
                action={<Button size="sm" icon={<ShoppingBag className="size-3.5" />} onClick={() => onBuyInstead(emp, skuOut || chk.data?.sku_in || undefined)}>Proses sebagai pembelian</Button>}>
                {chk.data.alasan_tolak}
              </Callout>
        )}
        {emp && item && chk.data?.ok && (
          <>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-slate-700">Alasan <span className="text-red-500" aria-hidden>*</span></legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {ALASAN.map((a) => (
                  <label key={a.v} className={clsx('cursor-pointer rounded-xl border p-3 text-sm', alasan === a.v ? 'border-brand-300 bg-brand-50 ring-2 ring-brand-100' : 'border-line hover:bg-slate-50')}>
                    <input type="radio" name="alasan" className="sr-only" checked={alasan === a.v} onChange={() => setAlasan(a.v)} />
                    <p className="font-semibold">{a.l}</p><p className="mt-0.5 text-xs text-muted">{a.d}</p>
                  </label>
                ))}
              </div>
            </fieldset>
            {salahUkuran ? (
              <Callout tone="amber" title="Salah pilih ukuran tidak bisa ditukar"
                action={<Button size="sm" icon={<ShoppingBag className="size-3.5" />} onClick={() => onBuyInstead(emp)}>Proses sebagai pembelian</Button>}>
                Sesuai kebijakan, karyawan membeli ukuran yang benar dengan potong gaji. Ukuran di data karyawan bisa diperbarui dari kartu karyawan.
              </Callout>
            ) : alasan && (
              <>
                <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                  <Field label="Barang pengganti" required htmlFor="ex-out" error={stokErr ?? undefined}
                    hint={chk.data.sku_in ? `Barang yang dikembalikan: ${chk.data.sku_in} (masuk karantina)` : undefined}>
                    <Select id="ex-out" value={skuOut} onChange={(e) => setSkuOut(e.target.value)} disabled={alasan === 'CACAT_PRODUKSI' && !!chk.data.sku_in && skuOpts.some((s) => s.sku_code === chk.data!.sku_in)}>
                      <option value="">— pilih SKU —</option>
                      {skuOpts.map((s) => <option key={s.sku_code} value={s.sku_code} disabled={s.available <= 0}>{s.label} — tersedia {s.available}</option>)}
                    </Select>
                  </Field>
                  <Field label="Qty" required htmlFor="ex-qty" error={qtyErr ?? undefined}><Input id="ex-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Disetujui oleh (atasan)" required htmlFor="ex-appr" hint="Nama & jabatan, mis. Rina — Area Manager"><Input id="ex-appr" value={approver} onChange={(e) => setApprover(e.target.value)} /></Field>
                  <Field label="Tanggal tukar"><Input type="date" value={tanggal} max={isoToday()} onChange={(e) => setTanggal(e.target.value)} /></Field>
                </div>
                <Field label="Catatan"><Textarea className="min-h-14" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. jahitan ketiak lepas; foto dikirim APA via WA" /></Field>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

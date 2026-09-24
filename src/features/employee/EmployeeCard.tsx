import { Pencil, Repeat, ShoppingBag, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Drawer, Modal } from '../../components/dialog'
import { Button, Callout, Chip, Field, Input, LoadingBlock, Select } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtMonth, fmtRp } from '../../lib/format'
import { DIFF_LABEL, EMP_STATUS_LABEL, GENDER_LABEL, PENYERAHAN_LABEL, RETUR_STATUS_LABEL, RETUR_STATUS_TONE, RETUR_SUMBER_LABEL, TX_LABEL } from '../../lib/labels'
import { ReturnModal, type ReturEmp } from '../retur/ReturPage'
import { useTransaksiDialogs } from '../transaksi/dialogs'
import type { EmployeeRow } from './EmployeesPage'

interface ItemRow { item_code: string; item_nama: string; item_sort: number; entitlement: number; issued_net: number; outstanding: number; over_issued: number; sku_target: string | null; size_code: string | null; size_status: string | null; last_issue_date: string | null }
interface LedgerRow { id: number; tanggal: string; tx_type: string; sku_label: string; qty: number; reason: string | null; ref_doc: string | null; affects_stock: boolean }
interface DiffRow { id: number; change_type: string; old_value: string | null; new_value: string | null; import_id: number }
interface ShipRow { id: number; batch_id: number; batch_kode: string; sku_label: string; qty: number; penyerahan: string; shipped_at: string | null; received_at: string | null; cabang_nama: string }
interface SaleRow { id: number; kode: string; tanggal: string; periode_potong: string; nilai: number; items: { label: string; qty: number; dibatalkan: boolean }[]; dibatalkan: boolean }
interface OverrideRow { package_code: string; alasan: string; created_by_nama: string | null; created_at: string }

export function EmployeeCard({ nik, onClose }: { nik: string; onClose: () => void }) {
  const emp = useView<EmployeeRow>('v_employee_list', { filters: [['nik', 'eq', nik]] })
  const items = useView<ItemRow>('v_employee_item', { filters: [['nik', 'eq', nik]], order: [['item_sort', 'asc']] })
  const ledger = useView<LedgerRow>('v_ledger', { filters: [['nik', 'eq', nik]], order: [['tanggal', 'desc'], ['id', 'desc']] })
  const diffs = useView<DiffRow>('v_import_diff', { filters: [['nik', 'eq', nik]], order: [['id', 'desc']] })
  const ovr = useView<OverrideRow>('v_override', { filters: [['nik', 'eq', nik]] })
  const ships = useView<ShipRow>('v_batch_line', { filters: [['nik', 'eq', nik]], order: [['batch_id', 'desc']] })
  const { canWrite, isAdmin } = usePerm()
  const [editSize, setEditSize] = useState(false)
  const retur = useView<ReturEmp>('v_return_employee', { filters: [['nik', 'eq', nik]] })
  const sales = useView<SaleRow>('v_sale', { filters: [['nik', 'eq', nik]], order: [['id', 'desc']] })
  const [ret, setRet] = useState<ReturEmp | null>(null)
  const tx = useTransaksiDialogs()
  const e = emp.data?.[0]
  const r = retur.data?.[0]
  const picked = e && { nik: e.nik, nama: e.nama, gender: e.gender, jabatan: e.jabatan, kode_cabang: e.kode_cabang, cabang_nama: e.cabang_nama, status: e.status }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={e?.nama ?? 'Kartu karyawan'} subtitle={e ? `${e.nik} · ${e.jabatan} · ${e.cabang_nama}` : undefined}>
      {!e ? <LoadingBlock /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Chip tone={e.status === 'AKTIF' ? 'green' : e.status === 'OFFERING' ? 'brand' : 'red'}>{EMP_STATUS_LABEL[e.status]}</Chip>
            {e.is_loan && <Chip tone="violet">PKL / magang — seragam dipinjam</Chip>}
            {e.is_late_hire && <Chip tone="amber">Hire mendadak</Chip>}
            {e.jabatan_unmapped && <Chip tone="amber">Jabatan belum dimapping</Chip>}
            {e.over_issued_total > 0 && <Chip tone="amber">Menerima {e.over_issued_total} pcs di atas hak</Chip>}
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {['AKTIF', 'OFFERING'].includes(e.status) && <Button size="sm" icon={<Repeat className="size-3.5" />} onClick={() => tx.openExchange(picked)}>Tukar barang cacat</Button>}
              {['AKTIF', 'OFFERING'].includes(e.status) && <Button size="sm" icon={<ShoppingBag className="size-3.5" />} onClick={() => tx.openSale(picked)}>Catat pembelian</Button>}
              {r && r.sisa > 0 && <Button size="sm" variant="soft" icon={<Undo2 className="size-3.5" />} onClick={() => setRet(r)}>Catat pengembalian</Button>}
            </div>
          )}
          {r && (
            <Section title={`Wajib kembali · ${RETUR_SUMBER_LABEL[r.sumber]}`}>
              <div className="rounded-xl border border-line bg-white p-3 text-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Chip tone={RETUR_STATUS_TONE[r.status]}>{RETUR_STATUS_LABEL[r.status]}</Chip>
                  {r.sisa > 0 && <span className="text-muted">sisa {r.sisa} pcs · {fmtRp(r.nilai)}{r.aging_hari != null ? ` · ${r.aging_hari} hari` : ''}</span>}
                </div>
                <ul className="space-y-1">
                  {r.items.map((i) => <li key={i.item_code} className="flex justify-between"><span>{i.item_nama}</span><span className="num">{i.sisa ? <b>sisa {i.sisa}</b> : <span className="text-emerald-700">selesai</span>} <span className="text-muted">/ {i.wajib}</span></span></li>)}
                </ul>
              </div>
            </Section>
          )}

          <Section title="Profil">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Item label="Gender">{GENDER_LABEL[e.gender]}</Item>
              <Item label="Status kepegawaian">{e.status_karyawan ?? '—'}</Item>
              <Item label="Cabang">{e.cabang_nama} <span className="text-muted">({e.kode_cabang})</span></Item>
              <Item label="Area">{e.area ?? '—'}</Item>
              <Item label="Rencana join">{fmtDate(e.planned_join_date)}</Item>
              <Item label="Tanggal join">{fmtDate(e.join_date)}</Item>
              {(e.planned_resign_date || e.resign_date) && <Item label="Rencana resign">{fmtDate(e.planned_resign_date)}</Item>}
              {e.resign_date && <Item label="Tanggal resign">{fmtDate(e.resign_date)}</Item>}
            </dl>
          </Section>

          <Section title="Ukuran" action={canWrite && <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditSize(true)}>Ubah ukuran</Button>}>
            <div className="grid grid-cols-3 gap-3">
              {[['Kemeja', e.size_kemeja], ['Polo', e.size_polo], ['Blazer', e.size_blazer]].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-line bg-white px-3 py-2">
                  <p className="text-xs text-muted">{l}</p>
                  <p className="text-lg font-bold">{v ?? <span className="text-slate-300">—</span>}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Paket seragam" action={isAdmin && <Link to="/master/override" className="text-xs font-semibold text-brand-600 hover:underline">Kelola override</Link>}>
            {e.package_code ? (
              <p className="text-sm">
                <b>{e.package_code}</b> versi {e.package_version ?? '—'} · {e.package_sumber === 'OVERRIDE' ? 'override khusus karyawan' : `dari jabatan "${e.jabatan}"`}
              </p>
            ) : (
              <Callout tone="amber">Jabatan "{e.jabatan}" belum dimapping ke paket, jadi karyawan ini belum masuk antrian. {isAdmin && <Link to="/master/jabatan" className="font-semibold underline">Mapping sekarang</Link>}</Callout>
            )}
            {ovr.data?.[0] && <p className="mt-1 text-xs text-muted">Alasan override: {ovr.data[0].alasan} ({ovr.data[0].created_by_nama ?? '—'}, {fmtDate(ovr.data[0].created_at)})</p>}
          </Section>

          <Section title="Hak vs diterima">
            {items.isLoading ? <LoadingBlock rows={3} /> : !items.data?.length ? <p className="text-sm text-muted">Belum ada hak seragam.</p> : (
              <div className="overflow-hidden rounded-xl border border-line bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2 text-right">Hak</th><th className="px-3 py-2 text-right">Diterima</th><th className="px-3 py-2 text-right">Belum</th></tr>
                  </thead>
                  <tbody>
                    {items.data.map((i) => (
                      <tr key={i.item_code} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium">{i.item_nama}</td>
                        <td className="px-3 py-2">
                          {i.sku_target ? <code className="text-xs">{i.sku_target}</code>
                            : i.size_status === 'KOSONG' ? <Chip tone="amber">Ukuran kosong</Chip>
                            : i.size_status === 'TIDAK_TERSEDIA' ? <Chip tone="red">Ukuran {i.size_code} tidak tersedia</Chip> : '—'}
                        </td>
                        <td className="px-3 py-2 text-right num">{i.entitlement}</td>
                        <td className="px-3 py-2 text-right num">{i.issued_net}{i.over_issued > 0 && <Chip tone="amber" className="ml-1">+{i.over_issued}</Chip>}</td>
                        <td className={`px-3 py-2 text-right font-bold num ${i.outstanding ? 'text-brand-700' : 'text-slate-300'}`}>{i.outstanding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Pengiriman (batch)">
            {!ships.data?.length ? <p className="text-sm text-muted">Belum pernah masuk batch distribusi.</p> : (
              <ul className="space-y-2">
                {ships.data.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{l.sku_label} × {l.qty}</p>
                      <p className="text-xs text-muted">
                        <Link to={`/batch/${l.batch_id}`} className="font-semibold text-brand-600 hover:underline">{l.batch_kode}</Link> · {l.cabang_nama}
                        {l.shipped_at ? ` · dikirim ${fmtDate(l.shipped_at)}` : ''}{l.received_at ? ` · diterima ${fmtDate(l.received_at)}` : ''}
                      </p>
                    </div>
                    <Chip tone={l.penyerahan === 'DITERIMA' ? 'green' : l.penyerahan === 'DITAHAN_APA' ? 'violet' : l.penyerahan === 'DIKIRIM' ? 'blue' : 'slate'}>{PENYERAHAN_LABEL[l.penyerahan]}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {!!sales.data?.length && (
            <Section title="Pembelian (potong gaji)">
              <ul className="space-y-2">
                {sales.data.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{s.items.filter((i) => !i.dibatalkan).map((i) => `${i.label} × ${i.qty}`).join(', ') || s.items.map((i) => i.label).join(', ')}</p>
                      <p className="text-xs text-muted">{s.kode} · {fmtDate(s.tanggal)} · potong gaji {fmtMonth(s.periode_potong)}</p>
                    </div>
                    {s.dibatalkan ? <Chip tone="slate">dibatalkan</Chip> : <span className="whitespace-nowrap font-bold num">{fmtRp(s.nilai)}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">Barang beli bukan pemenuhan hak dan tidak wajib dikembalikan.</p>
            </Section>
          )}

          <Section title="Riwayat transaksi seragam">
            {!ledger.data?.length ? <p className="text-sm text-muted">Belum ada transaksi.</p> : (
              <ul className="space-y-2">
                {ledger.data.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{TX_LABEL[l.tx_type]} · {l.sku_label}</p>
                      <p className="text-xs text-muted">{fmtDate(l.tanggal)}{l.ref_doc ? ` · ${l.ref_doc}` : ''}{!l.affects_stock ? ' · riwayat sebelum sistem' : ''}</p>
                    </div>
                    <span className="font-bold num">{Math.abs(l.qty)} pcs</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Riwayat perubahan data PPM">
            {!diffs.data?.length ? <p className="text-sm text-muted">Belum ada perubahan tercatat.</p> : (
              <ul className="space-y-1.5 text-sm">
                {diffs.data.map((d) => (
                  <li key={d.id}><Chip tone="slate">{DIFF_LABEL[d.change_type]}</Chip> <span className="text-muted">{d.old_value ?? '—'} → {d.new_value ?? '—'} (import #{d.import_id})</span></li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
      {editSize && e && <SizeModal emp={e} onClose={() => setEditSize(false)} />}
      {ret && <ReturnModal emp={ret} onClose={() => setRet(null)} />}
      {tx.dialogs}
    </Drawer>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>{action}</div>
      {children}
    </section>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="font-medium">{children}</dd></div>
}

interface SizeRow { size_code: string; size_order: number }
interface ChartRow { item_code: string; gender: string; size_code: string; keterangan: string }
interface ItemSize { item_code: string; size_group: string; sizes: string[]; nama: string; gender_specific: boolean; active: boolean }

function SizeModal({ emp, onClose }: { emp: EmployeeRow; onClose: () => void }) {
  const sizes = useView<SizeRow>('size', { order: [['size_order', 'asc']] })
  const items = useView<ItemSize>('v_item', { filters: [['active', 'eq', true]] })
  const chart = useView<ChartRow>('size_chart')
  const [val, setVal] = useState({ size_kemeja: emp.size_kemeja ?? '', size_polo: emp.size_polo ?? '', size_blazer: emp.size_blazer ?? '' })
  const [alasan, setAlasan] = useState('')
  const save = useRpc('fn_employee_set_size', { success: 'Ukuran diperbarui.' })
  const groups: [keyof typeof val, string, string][] = [['size_kemeja', 'Kemeja', 'KEMEJA'], ['size_polo', 'Polo', 'POLO'], ['size_blazer', 'Blazer', 'BLAZER']]

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Ubah ukuran — ${emp.nama}`}
      description="Gunakan untuk keputusan manual (mis. ukuran tidak tersedia). Import PPM berikutnya akan menimpa bila file berisi ukuran lain."
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={save.isPending} disabled={alasan.trim().length < 3}
        onClick={async () => { try { await save.mutateAsync({ nik: emp.nik, ...val, alasan }); onClose() } catch { /* toast */ } }}>Simpan</Button></>}>
      <div className="space-y-4">
        {groups.map(([k, label, grp]) => {
          const allowed = new Set((items.data ?? []).filter((i) => i.size_group === grp).flatMap((i) => i.sizes))
          const itemCodes = (items.data ?? []).filter((i) => i.size_group === grp).map((i) => i.item_code)
          const ch = chart.data?.find((c) => itemCodes.includes(c.item_code) && c.size_code === val[k] && (c.gender === emp.gender || c.gender === 'U'))
          return (
            <Field key={k} label={`Ukuran ${label.toLowerCase()}`} hint={ch ? `Size chart ${val[k]}: ${ch.keterangan}` : allowed.size ? `Tersedia: ${[...allowed].join(', ')}` : undefined}>
              <Select value={val[k]} onChange={(e) => setVal({ ...val, [k]: e.target.value })}>
                <option value="">— kosong —</option>
                {(sizes.data ?? []).map((s) => <option key={s.size_code} value={s.size_code} disabled={allowed.size > 0 && !allowed.has(s.size_code)}>{s.size_code}{allowed.size > 0 && !allowed.has(s.size_code) ? ' (tidak tersedia)' : ''}</option>)}
              </Select>
            </Field>
          )
        })}
        <Field label="Alasan perubahan" required hint="Tercatat di audit log.">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. konfirmasi ulang ke karyawan via APA" />
        </Field>
      </div>
    </Modal>
  )
}

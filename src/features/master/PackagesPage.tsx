import clsx from 'clsx'
import { Copy, History, MoreHorizontal, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../../components/AppShell'
import { ConfirmDialog, Drawer, Modal } from '../../components/dialog'
import { Button, Callout, Card, Chip, Field, Input, LoadingBlock, Textarea } from '../../components/ui'
import { useRpc, useRpcQuery, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { fmtDate, fmtDateTime, fmtNum, isoToday } from '../../lib/format'
import { SCOPE_LABEL } from '../../lib/labels'
import { ImpactPanel, ReadOnlyNote, type Impact } from './common'

interface Pkg {
  package_code: string; nama: string; deskripsi: string | null; active: boolean; latest_version: number; effective_date: string; scope: string
  jumlah_jabatan: number; jumlah_override: number; jumlah_karyawan: number; items: Record<string, number>
}
interface Item { item_code: string; nama: string; active: boolean; sort_order: number }
interface Version { package_code: string; version_no: number; effective_date: string; scope: string; catatan: string | null; created_by_nama: string | null; created_at: string; items: Record<string, number> }

type Mode = { kind: 'create'; from?: Pkg } | { kind: 'edit'; pkg: Pkg } | { kind: 'history'; pkg: Pkg } | null

export default function PackagesPage() {
  const pkgs = useView<Pkg>('v_package', { order: [['active', 'desc'], ['package_code', 'asc']] })
  const items = useView<Item>('item', { filters: [['active', 'eq', true]], order: [['sort_order', 'asc']] })
  const { isAdmin } = usePerm()
  const [mode, setMode] = useState<Mode>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [act, setAct] = useState<{ kind: 'toggle' | 'delete'; pkg: Pkg } | null>(null)
  const toggle = useRpc('fn_package_set_active', { success: 'Status paket diperbarui.' })
  const del = useRpc('fn_package_delete', { success: 'Paket dihapus.' })

  useEffect(() => {
    if (!menu) return
    const h = () => setMenu(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [menu])

  return (
    <Page title="Paket Alokasi" subtitle="Hak seragam per paket · item baru otomatis muncul sebagai kolom" help="paket"
      actions={isAdmin && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setMode({ kind: 'create' })}>Paket baru</Button>}>
      {!isAdmin && <ReadOnlyNote />}
      <Card bodyClass="p-0">
        {pkgs.isLoading || items.isLoading ? <LoadingBlock /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Paket</th>
                  {items.data?.map((i) => <th key={i.item_code} className="px-3 py-3 text-center">{i.nama}</th>)}
                  <th className="px-4 py-3">Dipakai</th>
                  <th className="px-4 py-3">Versi berlaku</th>
                  {isAdmin && <th className="w-12 px-2 py-3" />}
                </tr>
              </thead>
              <tbody>
                {pkgs.data?.map((p) => (
                  <tr key={p.package_code} className={clsx('border-t border-slate-100', !p.active && 'bg-slate-50 text-slate-400')}>
                    <td className="px-4 py-3">
                      <p className="font-bold">{p.package_code} {!p.active && <Chip tone="slate">nonaktif</Chip>}</p>
                      <p className="text-xs text-muted">{p.nama}{p.deskripsi ? ` · ${p.deskripsi}` : ''}</p>
                    </td>
                    {items.data?.map((i) => {
                      const q = p.items[i.item_code] ?? 0
                      return <td key={i.item_code} className="px-3 py-3 text-center"><span className={clsx('inline-flex size-8 items-center justify-center rounded-lg font-bold num', q ? 'bg-brand-50 text-brand-700' : 'text-slate-300')}>{q}</span></td>
                    })}
                    <td className="px-4 py-3 text-xs">
                      <p><b className="num">{fmtNum(p.jumlah_karyawan)}</b> karyawan aktif</p>
                      <p className="text-muted">{p.jumlah_jabatan} jabatan{p.jumlah_override ? ` · ${p.jumlah_override} override` : ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <button className="text-left hover:text-brand-700" onClick={() => setMode({ kind: 'history', pkg: p })}>
                        <p className="font-semibold">v{p.latest_version} · {fmtDate(p.effective_date)}</p>
                        <p className="text-muted underline decoration-dotted">{SCOPE_LABEL[p.scope]}</p>
                      </button>
                    </td>
                    {isAdmin && (
                      <td className="relative px-2 py-3">
                        <button aria-label={`Aksi untuk paket ${p.package_code}`} aria-haspopup="menu" aria-expanded={menu === p.package_code}
                          onClick={(e) => { e.stopPropagation(); setMenu(menu === p.package_code ? null : p.package_code) }}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><MoreHorizontal className="size-4" /></button>
                        {menu === p.package_code && (
                          <div role="menu" className="absolute right-2 top-11 z-20 w-52 rounded-xl border border-line bg-white p-1 shadow-lg">
                            <MenuItem icon={<Pencil />} onClick={() => setMode({ kind: 'edit', pkg: p })} disabled={!p.active}>Ubah qty / info</MenuItem>
                            <MenuItem icon={<Copy />} onClick={() => setMode({ kind: 'create', from: p })}>Duplikat</MenuItem>
                            <MenuItem icon={<History />} onClick={() => setMode({ kind: 'history', pkg: p })}>Riwayat versi</MenuItem>
                            <MenuItem icon={<Power />} onClick={() => setAct({ kind: 'toggle', pkg: p })}>{p.active ? 'Nonaktifkan' : 'Aktifkan'}</MenuItem>
                            <MenuItem icon={<Trash2 />} danger onClick={() => setAct({ kind: 'delete', pkg: p })}>Hapus</MenuItem>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">Jabatan dipetakan ke paket di menu <Link to="/master/jabatan" className="font-semibold text-brand-600">Mapping Jabatan</Link>. Item baru ditambahkan di <Link to="/master/item" className="font-semibold text-brand-600">Item & SKU</Link> dan otomatis bernilai 0 di semua paket.</p>

      {mode?.kind === 'create' && items.data && <CreateModal items={items.data} from={mode.from} onClose={() => setMode(null)} />}
      {mode?.kind === 'edit' && items.data && <EditModal items={items.data} pkg={mode.pkg} onClose={() => setMode(null)} />}
      {mode?.kind === 'history' && items.data && <HistoryDrawer items={items.data} pkg={mode.pkg} onClose={() => setMode(null)} />}

      <ConfirmDialog open={act?.kind === 'toggle'} onOpenChange={() => setAct(null)} loading={toggle.isPending}
        title={act?.pkg.active ? `Nonaktifkan paket ${act.pkg.package_code}?` : `Aktifkan paket ${act?.pkg.package_code}?`}
        confirmLabel={act?.pkg.active ? 'Nonaktifkan' : 'Aktifkan'}
        onConfirm={async () => { try { await toggle.mutateAsync({ package_code: act!.pkg.package_code, active: !act!.pkg.active }) } catch { /* toast */ } setAct(null) }}>
        {act?.pkg.active ? (act.pkg.jumlah_jabatan || act.pkg.jumlah_override
          ? <Callout tone="amber">Paket ini masih dipakai {act.pkg.jumlah_jabatan} jabatan dan {act.pkg.jumlah_override} override. Pindahkan dulu di Mapping Jabatan / Override, lalu nonaktifkan.</Callout>
          : 'Paket nonaktif tidak bisa dipilih di mapping jabatan atau override.') : 'Paket bisa dipilih lagi di mapping jabatan dan override.'}
      </ConfirmDialog>
      <ConfirmDialog open={act?.kind === 'delete'} onOpenChange={() => setAct(null)} loading={del.isPending} danger
        title={`Hapus paket ${act?.pkg.package_code}?`} confirmLabel="Hapus paket"
        onConfirm={async () => { try { await del.mutateAsync({ package_code: act!.pkg.package_code }) } catch { /* toast */ } setAct(null) }}>
        Hanya paket yang belum pernah dipakai jabatan/karyawan yang bisa dihapus. Paket yang pernah dipakai cukup dinonaktifkan agar riwayatnya tetap utuh.
      </ConfirmDialog>
    </Page>
  )
}

function MenuItem({ icon, children, onClick, danger, disabled }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button role="menuitem" disabled={disabled} onClick={onClick}
      className={clsx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm [&_svg]:size-4 disabled:opacity-40', danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50')}>
      {icon}{children}
    </button>
  )
}

function QtyGrid({ items, value, onChange }: { items: Item[]; value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((i) => (
        <Field key={i.item_code} label={i.nama} htmlFor={`qty-${i.item_code}`}>
          <Input id={`qty-${i.item_code}`} type="number" min={0} step={1} inputMode="numeric" className="num"
            value={value[i.item_code] ?? 0} onChange={(e) => onChange({ ...value, [i.item_code]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
        </Field>
      ))}
    </div>
  )
}

function CreateModal({ items, from, onClose }: { items: Item[]; from?: Pkg; onClose: () => void }) {
  const [code, setCode] = useState(from ? `${from.package_code}-2` : '')
  const [nama, setNama] = useState(from ? `${from.nama} (salinan)` : '')
  const [desk, setDesk] = useState(from?.deskripsi ?? '')
  const [qty, setQty] = useState<Record<string, number>>(from?.items ?? {})
  const m = useRpc('fn_package_create', { success: (r: { package_code: string }) => `Paket ${r.package_code} dibuat. Petakan ke jabatan di Mapping Jabatan.` })
  const codeOk = /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={from ? `Duplikat paket ${from.package_code}` : 'Paket baru'} size="md"
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" loading={m.isPending} disabled={!codeOk || !nama.trim()} onClick={async () => { try { await m.mutateAsync({ package_code: code, nama, deskripsi: desk, items: qty }); onClose() } catch { /* toast */ } }}>Simpan paket</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kode paket" required error={code && !codeOk ? 'Huruf kapital, angka, dan tanda hubung saja (mis. GA-C).' : undefined} hint="Unik, tidak bisa diubah setelah disimpan.">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, '-'))} placeholder="GA-C" aria-invalid={!!code && !codeOk} />
          </Field>
          <Field label="Nama paket" required><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="GA C" /></Field>
        </div>
        <Field label="Deskripsi"><Textarea value={desk} onChange={(e) => setDesk(e.target.value)} className="min-h-14" placeholder="Untuk jabatan apa paket ini dipakai" /></Field>
        <p className="text-sm font-semibold">Qty per item</p>
        <QtyGrid items={items} value={qty} onChange={setQty} />
        <p className="text-xs text-muted">Paket baru belum berdampak ke karyawan sampai dipetakan ke jabatan atau dipakai sebagai override.</p>
      </div>
    </Modal>
  )
}

function EditModal({ items, pkg, onClose }: { items: Item[]; pkg: Pkg; onClose: () => void }) {
  const [nama, setNama] = useState(pkg.nama)
  const [desk, setDesk] = useState(pkg.deskripsi ?? '')
  const [qty, setQty] = useState<Record<string, number>>({ ...pkg.items })
  const [scope, setScope] = useState<'SEMUA_AKTIF' | 'KARYAWAN_BARU'>('KARYAWAN_BARU')
  const [eff, setEff] = useState(isoToday())
  const [catatan, setCatatan] = useState('')
  const changed = items.some((i) => (qty[i.item_code] ?? 0) !== (pkg.items[i.item_code] ?? 0))
  const infoChanged = nama !== pkg.nama || desk !== (pkg.deskripsi ?? '')
  const [debounced, setDebounced] = useState({ qty, scope, eff })
  useEffect(() => { const t = setTimeout(() => setDebounced({ qty, scope, eff }), 400); return () => clearTimeout(t) }, [qty, scope, eff])
  const preview = useRpcQuery<Impact>('fn_package_preview', { package_code: pkg.package_code, items: debounced.qty, scope: debounced.scope, effective_date: debounced.eff }, changed)
  const saveVer = useRpc('fn_package_new_version', { success: (r: { version_no: number }) => `Versi ${r.version_no} paket ${pkg.package_code} disimpan.` })
  const saveInfo = useRpc('fn_package_update_info', { success: 'Info paket disimpan.' })
  const [confirm, setConfirm] = useState(false)

  async function save() {
    try {
      if (infoChanged) await saveInfo.mutateAsync({ package_code: pkg.package_code, nama, deskripsi: desk })
      if (changed) await saveVer.mutateAsync({ package_code: pkg.package_code, items: qty, scope, effective_date: eff, catatan })
      onClose()
    } catch { setConfirm(false) }
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Ubah paket ${pkg.package_code}`} size="lg"
      description="Perubahan qty membuat versi baru; versi lama tetap tersimpan."
      footer={<><Button onClick={onClose}>Batal</Button>
        <Button variant="primary" disabled={!changed && !infoChanged} loading={saveInfo.isPending || saveVer.isPending}
          onClick={() => (changed ? setConfirm(true) : void save())}>{changed ? 'Simpan versi baru…' : 'Simpan info'}</Button></>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Nama paket" required><Input value={nama} onChange={(e) => setNama(e.target.value)} /></Field>
          <Field label="Deskripsi"><Textarea value={desk} onChange={(e) => setDesk(e.target.value)} className="min-h-14" /></Field>
          <p className="text-sm font-semibold">Qty per item <span className="font-normal text-muted">(versi berlaku: v{pkg.latest_version})</span></p>
          <QtyGrid items={items} value={qty} onChange={setQty} />
        </div>
        <div className="space-y-4">
          <fieldset disabled={!changed} className={clsx('space-y-3', !changed && 'opacity-50')}>
            <legend className="mb-2 text-sm font-semibold">Cakupan perubahan qty</legend>
            {(['KARYAWAN_BARU', 'SEMUA_AKTIF'] as const).map((s) => (
              <label key={s} className={clsx('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', scope === s ? 'border-brand-300 bg-brand-50' : 'border-line')}>
                <input type="radio" name="scope" className="mt-0.5 accent-brand-500" checked={scope === s} onChange={() => setScope(s)} />
                <span>
                  <b>{SCOPE_LABEL[s]}</b>
                  <span className="block text-muted">{s === 'KARYAWAN_BARU'
                    ? 'Berlaku untuk karyawan dengan rencana join ≥ tanggal berlaku. Karyawan lama tetap memakai versi sebelumnya.'
                    : 'Hak semua karyawan aktif dihitung ulang. Kekurangan langsung masuk antrian.'}</span>
                </span>
              </label>
            ))}
            <Field label="Tanggal berlaku" required><Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
            <Field label="Catatan perubahan" hint="Muncul di riwayat versi."><Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. kebijakan baru dari Division Lead" /></Field>
          </fieldset>
          {changed ? <ImpactPanel impact={preview.data} loading={preview.isFetching && !preview.data} error={preview.error} />
            : <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Ubah qty untuk melihat preview dampak ke karyawan.</p>}
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Simpan versi baru ${pkg.package_code}?`} confirmLabel="Simpan versi" loading={saveVer.isPending} onConfirm={() => void save()}>
        <p>Cakupan: <b>{SCOPE_LABEL[scope]}</b>, berlaku {fmtDate(eff)}.</p>
        {preview.data && <p>{fmtNum(preview.data.karyawan_terdampak)} karyawan terdampak, tambahan outstanding {fmtNum(preview.data.total_tambahan_pcs)} pcs{preview.data.karyawan_over_issued ? `, ${preview.data.karyawan_over_issued} karyawan menjadi over-issued` : ''}.</p>}
      </ConfirmDialog>
    </Modal>
  )
}

function HistoryDrawer({ items, pkg, onClose }: { items: Item[]; pkg: Pkg; onClose: () => void }) {
  const v = useView<Version>('v_package_version', { filters: [['package_code', 'eq', pkg.package_code]], order: [['version_no', 'desc']] })
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`Riwayat versi ${pkg.package_code}`} subtitle={pkg.nama}>
      {v.isLoading ? <LoadingBlock /> : (
        <ol className="space-y-3">
          {v.data?.map((x, i) => (
            <li key={x.version_no} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold">Versi {x.version_no}</p>
                {i === 0 && <Chip tone="green">terbaru</Chip>}
                <Chip tone="slate">{SCOPE_LABEL[x.scope]}</Chip>
                <span className="text-xs text-muted">berlaku {fmtDate(x.effective_date)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {items.map((it) => <Chip key={it.item_code} tone={(x.items[it.item_code] ?? 0) ? 'brand' : 'slate'}>{it.nama}: {x.items[it.item_code] ?? 0}</Chip>)}
              </div>
              <p className="mt-2 text-xs text-muted">{x.catatan ?? 'Tanpa catatan'} · {x.created_by_nama ?? 'sistem'} · {fmtDateTime(x.created_at)}</p>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  )
}

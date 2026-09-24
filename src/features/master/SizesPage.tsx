import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { Page } from '../../components/AppShell'
import { Button, Card, Input, LoadingBlock, Select, Tabs } from '../../components/ui'
import { useRpc, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { GENDER_LABEL } from '../../lib/labels'
import { ReadOnlyNote } from './common'

interface ItemRow { item_code: string; nama: string; gender_specific: boolean; sizes: string[]; active: boolean }
interface Curve { item_code: string; gender: string; size_code: string; proporsi: number }
interface Chart { item_code: string; gender: string; size_code: string; keterangan: string }

export default function SizesPage() {
  const items = useView<ItemRow>('v_item', { filters: [['active', 'eq', true]], order: [['sort_order', 'asc']] })
  const [tab, setTab] = useState<'curve' | 'chart'>('curve')
  const [item, setItem] = useState('')
  const { isAdmin } = usePerm()
  const it = items.data?.find((i) => i.item_code === (item || items.data?.[0]?.item_code))
  return (
    <Page title="Size Curve & Size Chart" subtitle="Proporsi ukuran untuk forecast · ukuran badan vendor untuk form ukuran" help="ukuran">
      {!isAdmin && <ReadOnlyNote />}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'curve', label: 'Size curve' }, { value: 'chart', label: 'Size chart vendor' }]} />
        <Select aria-label="Pilih item" value={it?.item_code ?? ''} onChange={(e) => setItem(e.target.value)} className="h-10 w-56">
          {items.data?.map((i) => <option key={i.item_code} value={i.item_code}>{i.nama}</option>)}
        </Select>
      </div>
      {!it ? <Card><LoadingBlock /></Card> : (
        <div className="grid gap-6 lg:grid-cols-2">
          {(it.gender_specific ? ['P', 'W'] : ['U']).map((g) => tab === 'curve'
            ? <CurveCard key={`${it.item_code}${g}`} item={it} gender={g} readOnly={!isAdmin} />
            : <ChartCard key={`${it.item_code}${g}`} item={it} gender={g} readOnly={!isAdmin} />)}
        </div>
      )}
    </Page>
  )
}

function CurveCard({ item, gender, readOnly }: { item: ItemRow; gender: string; readOnly: boolean }) {
  const q = useView<Curve>('size_curve', { filters: [['item_code', 'eq', item.item_code], ['gender', 'eq', gender]] })
  const [vals, setVals] = useState<Record<string, string>>({})
  useEffect(() => {
    if (q.data) setVals(Object.fromEntries(item.sizes.map((s) => [s, String(Math.round((q.data.find((c) => c.size_code === s)?.proporsi ?? 0) * 1000) / 10)])))
  }, [q.data, item.sizes])
  const total = useMemo(() => Object.values(vals).reduce((a, v) => a + (Number(v) || 0), 0), [vals])
  const ok = Math.abs(total - 100) < 1
  const m = useRpc('fn_size_curve_save', { success: 'Size curve disimpan.' })
  return (
    <Card title={`${item.nama} — ${GENDER_LABEL[gender]}`} subtitle="Proporsi (%) ukuran joiner. Dipakai untuk forecast SKU tanpa histori."
      actions={!readOnly && <Button size="sm" variant="primary" disabled={!ok} loading={m.isPending}
        onClick={() => void m.mutateAsync({ item_code: item.item_code, gender, rows: Object.entries(vals).map(([size_code, v]) => ({ size_code, proporsi: (Number(v) || 0) / 100 })) }).catch(() => undefined)}>Simpan</Button>}>
      {q.isLoading ? <LoadingBlock rows={3} /> : (
        <>
          <div className="space-y-2">
            {item.sizes.map((s) => {
              const v = Number(vals[s]) || 0
              return (
                <div key={s} className="flex items-center gap-3">
                  <span className="w-10 text-sm font-bold">{s}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.min(100, v * 2.5)}%` }} /></div>
                  <Input aria-label={`Proporsi ${s}`} type="number" min={0} max={100} step={0.5} value={vals[s] ?? ''} disabled={readOnly}
                    onChange={(e) => setVals({ ...vals, [s]: e.target.value })} className="h-9 w-20 text-right num" />
                  <span className="text-sm text-muted">%</span>
                </div>
              )
            })}
          </div>
          <p className={clsx('mt-4 text-right text-sm font-semibold', ok ? 'text-emerald-600' : 'text-red-600')}>Total {total.toFixed(1).replace('.', ',')}%{!ok && ' — harus 100%'}</p>
        </>
      )}
    </Card>
  )
}

function ChartCard({ item, gender, readOnly }: { item: ItemRow; gender: string; readOnly: boolean }) {
  const q = useView<Chart>('size_chart', { filters: [['item_code', 'eq', item.item_code], ['gender', 'eq', gender]] })
  const [vals, setVals] = useState<Record<string, string>>({})
  useEffect(() => { if (q.data) setVals(Object.fromEntries(item.sizes.map((s) => [s, q.data.find((c) => c.size_code === s)?.keterangan ?? '']))) }, [q.data, item.sizes])
  const m = useRpc('fn_size_chart_save', { success: 'Size chart disimpan.' })
  return (
    <Card title={`${item.nama} — ${GENDER_LABEL[gender]}`} subtitle="Ukuran badan (cm) dari vendor. Tampil saat mengubah ukuran karyawan."
      actions={!readOnly && <Button size="sm" variant="primary" loading={m.isPending}
        onClick={() => void m.mutateAsync({ rows: Object.entries(vals).map(([size_code, keterangan]) => ({ item_code: item.item_code, gender, size_code, keterangan })) }).catch(() => undefined)}>Simpan</Button>}>
      {q.isLoading ? <LoadingBlock rows={3} /> : (
        <div className="space-y-2">
          {item.sizes.map((s) => (
            <div key={s} className="flex items-center gap-3">
              <span className="w-10 text-sm font-bold">{s}</span>
              <Input aria-label={`Size chart ${s}`} value={vals[s] ?? ''} disabled={readOnly} onChange={(e) => setVals({ ...vals, [s]: e.target.value })} placeholder="mis. LD 104 cm · PB 72 cm · PL 60 cm" />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

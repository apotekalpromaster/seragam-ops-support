import type { ColumnDef } from '@tanstack/react-table'
import { Mail, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Page } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Button, Callout, Card, Chip, Field, Input, LoadingBlock } from '../../components/ui'
import { useDb, useRpc, useRpcQuery, useView } from '../../lib/api'
import { usePerm } from '../../lib/auth'
import { IS_DEMO } from '../../lib/db'
import { toAppError } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { EMAIL_RE, renderDigest, splitRecipients, type DigestData } from '../../../supabase/functions/_shared/digest'
import { ReadOnlyNote } from './common'

interface Log { id: number; sent_at: string; pemicu: string; penerima: string | null; subjek: string | null; status: string; pesan: string | null }
interface Cfg { key: string; value: unknown }

const STATUS_TONE: Record<string, 'green' | 'red' | 'slate'> = { TERKIRIM: 'green', GAGAL: 'red', DILEWATI: 'slate' }

/** Email ringkasan harian (PRD M5): penerima, pratinjau, kirim tes, riwayat. */
export default function NotifikasiPage() {
  const { isAdmin } = usePerm()
  const db = useDb()
  const cfg = useView<Cfg>('config', { filters: [['key', 'in', ['notif_email_to', 'notif_email_aktif']]] })
  const log = useView<Log>('v_notification_log', { order: [['id', 'desc']], limit: 200 })
  const digest = useRpcQuery<DigestData>('fn_digest', {}, isAdmin)
  const to = String(cfg.data?.find((c) => c.key === 'notif_email_to')?.value ?? '')
  const aktif = cfg.data?.find((c) => c.key === 'notif_email_aktif')?.value !== false
  const [edit, setEdit] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const set = useRpc('fn_config_set', { success: 'Pengaturan email disimpan.' })
  const bad = edit !== null && splitRecipients(edit).some((e) => !EMAIL_RE.test(e))
  const preview = useMemo(() => (digest.data ? renderDigest(digest.data, { appUrl: window.location.origin }) : null), [digest.data])

  async function sendTest() {
    setSending(true)
    try {
      const r = await db.invoke<{ status: string; penerima?: string[]; pesan?: string }>('seragam-daily-digest', { tes: true })
      if (r.status === 'TERKIRIM') toast.success('Email tes terkirim', { description: `Ke ${r.penerima?.join(', ')}. Cek kotak masuk (dan folder spam).` })
      else toast.error('Email tes tidak terkirim', { description: r.pesan ?? r.status })
    } catch (e) { const er = toAppError(e); toast.error(er.title, { description: er.message }) } finally { setSending(false); void log.refetch() }
  }

  const columns = useMemo<ColumnDef<Log>[]>(() => [
    { accessorKey: 'sent_at', header: 'Waktu', cell: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.getValue() as string)}</span> },
    { accessorKey: 'status', header: 'Status', cell: (c) => <Chip tone={STATUS_TONE[c.getValue() as string]}>{String(c.getValue()).toLowerCase()}</Chip> },
    { accessorKey: 'pemicu', header: 'Pemicu', cell: (c) => (c.getValue() === 'JADWAL' ? 'Terjadwal' : String(c.getValue()).replace('TES oleh', 'Tes oleh')) },
    { accessorKey: 'penerima', header: 'Penerima', cell: (c) => <span className="text-xs">{(c.getValue() as string) ?? '—'}</span> },
    { accessorKey: 'subjek', header: 'Subjek / keterangan', cell: ({ row: { original: l } }) => <span className="text-xs">{l.subjek ?? ''}{l.pesan && <span className="block text-red-600">{l.pesan}</span>}</span> },
  ], [])

  return (
    <Page title="Notifikasi Email" subtitle="Email ringkasan harian ke tim Ops Support" help="notifikasi">
      {!isAdmin && <ReadOnlyNote />}
      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Card title="Pengaturan" bodyClass="space-y-4 p-5">
            {cfg.isLoading ? <LoadingBlock rows={2} /> : (
              <>
                <Field label="Penerima" htmlFor="notif-to" hint="Pisahkan dengan koma untuk lebih dari satu alamat." error={bad ? 'Ada alamat email yang tidak valid.' : undefined}>
                  <Input id="notif-to" value={edit ?? to} disabled={!isAdmin} onChange={(e) => setEdit(e.target.value)} aria-invalid={bad} />
                </Field>
                {isAdmin && edit !== null && edit !== to && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" loading={set.isPending} disabled={bad || !splitRecipients(edit).length}
                      onClick={async () => { try { await set.mutateAsync({ key: 'notif_email_to', value: splitRecipients(edit).join(', ') }); setEdit(null) } catch { /* toast */ } }}>Simpan</Button>
                    <Button size="sm" onClick={() => setEdit(null)}>Batal</Button>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-brand-500" checked={aktif} disabled={!isAdmin || set.isPending}
                    onChange={(e) => void set.mutateAsync({ key: 'notif_email_aktif', value: e.target.checked }).catch(() => {})} />
                  Kirim email setiap hari (jadwal di Supabase Cron, disarankan 07.00 WIB)
                </label>
                {isAdmin && (
                  <Button icon={<Send className="size-4" />} loading={sending} disabled={IS_DEMO} onClick={() => void sendTest()} className="w-full"
                    title={IS_DEMO ? 'Tidak tersedia di mode demo' : undefined}>Kirim email tes sekarang</Button>
                )}
                {IS_DEMO
                  ? <p className="text-xs text-muted">Mode demo tidak mengirim email. Pratinjau di samping sama persis dengan email yang dikirim.</p>
                  : <p className="text-xs text-muted">Belum pernah terkirim? Pastikan Edge Function sudah di-deploy — lihat <code>docs/SETUP-email-harian.md</code>.</p>}
              </>
            )}
          </Card>
          <Callout tone="blue" icon={<Mail className="size-4" />} title="Isi email">
            KPI utama, semua alert <Link to="/" className="font-semibold underline">Perlu tindakan</Link>, batch berjalan, joiner 7 hari ke depan yang paketnya belum lengkap, PO lewat ETA, dan karyawan resign yang belum mengembalikan seragam.
          </Callout>
        </div>
        <Card title="Pratinjau email hari ini" subtitle={preview?.subject} bodyClass="p-0">
          {!isAdmin ? <p className="p-5 text-sm text-muted">Pratinjau hanya untuk admin.</p>
            : digest.isLoading ? <LoadingBlock /> : preview
              ? <iframe title="Pratinjau email harian" srcDoc={preview.html} className="h-[640px] w-full rounded-b-2xl border-0 bg-slate-50" sandbox="" />
              : <p className="p-5 text-sm text-muted">Pratinjau tidak bisa dimuat.</p>}
        </Card>
      </div>
      <Card title="Riwayat pengiriman" bodyClass="p-0">
        <DataTable data={log.data} columns={columns} loading={log.isLoading} exportName="riwayat-email" dense
          empty={<p className="p-8 text-center text-sm text-muted">Belum ada email yang dikirim.</p>} />
      </Card>
    </Page>
  )
}

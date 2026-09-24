// Edge Function: ringkasan harian Dashboard Seragam via Resend (PRD M5).
//
// Dipanggil oleh:
//  - Supabase Cron (terjadwal) dengan header `x-cron-secret: <CRON_SECRET>`, atau
//  - admin dari aplikasi (tombol "Kirim email tes") dengan JWT login-nya.
// Deploy dengan --no-verify-jwt; otorisasi dicek di bawah.
//
// Secrets: RESEND_API_KEY, CRON_SECRET, DIGEST_FROM (mis. "Seragam Ops Support <seragam@apotekalpro.id>"),
//          APP_URL (URL Vercel). SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { type DigestData, renderDigest } from '../_shared/digest.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const env = (k: string) => Deno.env.get(k) ?? ''
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { db: { schema: 'seragam' }, auth: { persistSession: false } })

  // --- Otorisasi ---
  let pemicu = 'JADWAL'
  const cronSecret = req.headers.get('x-cron-secret')
  if (!(env('CRON_SECRET') && cronSecret === env('CRON_SECRET'))) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      db: { schema: 'seragam' }, auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: me } = await user.rpc('fn_me', { p: {} })
    if (!me || me.role !== 'admin') return json({ error: 'AKSES_DITOLAK: Hanya admin yang bisa mengirim email tes.' }, 403)
    pemicu = `TES oleh ${me.email}`
  }

  const log = (status: string, extra: Record<string, unknown> = {}) =>
    admin.rpc('fn_notification_log', { p: { pemicu, status, ...extra } })

  try {
    await admin.rpc('fn_kpi_snapshot', { p: {} })
    const { data, error } = await admin.rpc('fn_digest', { p: {} })
    if (error) throw new Error(error.message)
    const d = data as DigestData
    const to = d.penerima.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => EMAIL.test(s))
    if (!to.length) { await log('DILEWATI', { pesan: 'Penerima email belum diisi di Parameter.' }); return json({ ok: false, status: 'DILEWATI' }) }
    if (!d.aktif && pemicu === 'JADWAL') { await log('DILEWATI', { penerima: to.join(', '), pesan: 'Email harian dinonaktifkan di Parameter.' }); return json({ ok: true, status: 'DILEWATI' }) }

    const { subject, html, text } = renderDigest(d, { appUrl: env('APP_URL') })
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('DIGEST_FROM') || 'Seragam Ops Support <onboarding@resend.dev>', to, subject: pemicu === 'JADWAL' ? subject : `[TES] ${subject}`, html, text }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      await log('GAGAL', { penerima: to.join(', '), subjek: subject, pesan: `Resend ${res.status}: ${body?.message ?? JSON.stringify(body)}` })
      return json({ ok: false, status: 'GAGAL', pesan: body?.message ?? `Resend ${res.status}` }, 502)
    }
    await log('TERKIRIM', { penerima: to.join(', '), subjek: subject, provider_id: body?.id })
    return json({ ok: true, status: 'TERKIRIM', penerima: to })
  } catch (e) {
    await log('GAGAL', { pesan: (e as Error).message })
    return json({ ok: false, status: 'GAGAL', pesan: (e as Error).message }, 500)
  }
})

// Edge Function: ringkasan harian Dashboard Seragam via Gmail SMTP (PRD M5).
//
// Dipanggil oleh:
//  - Supabase Cron (terjadwal) dengan header `x-cron-secret: <CRON_SECRET>`, atau
//  - admin dari aplikasi (tombol "Kirim email tes") dengan JWT login-nya.
// Deploy dengan --no-verify-jwt; otorisasi dicek di bawah.
//
// Secrets: GMAIL_USER (akun Gmail pengirim), GMAIL_APP_PASSWORD (App Password 16 huruf, butuh verifikasi 2 langkah),
//          CRON_SECRET, APP_URL (URL Vercel), DIGEST_FROM_NAME (opsional, default "Seragam Ops Support").
//          SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY tersedia otomatis.
// Port 465 (TLS langsung): Edge Function Supabase memblokir koneksi keluar ke port 25 dan 587.
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'
import { type DigestData, EMAIL_RE, renderDigest, splitRecipients } from '../_shared/digest.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Bandingkan rahasia dalam waktu konstan (hash dulu supaya panjang sama). */
async function samaRahasia(a: string, b: string) {
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const env = (k: string) => Deno.env.get(k) ?? ''
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { db: { schema: 'seragam' }, auth: { persistSession: false } })

  // --- Otorisasi ---
  let pemicu = 'JADWAL'
  const cronSecret = req.headers.get('x-cron-secret')
  if (!(env('CRON_SECRET') && cronSecret && await samaRahasia(cronSecret, env('CRON_SECRET')))) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      db: { schema: 'seragam' }, auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: me } = await user.rpc('fn_me', { p: {} })
    if (!me || me.role !== 'admin') return json({ error: 'AKSES_DITOLAK: Hanya admin yang bisa mengirim email tes.' }, 403)
    pemicu = `TES oleh ${me.email}`
  }

  // Snapshot KPI gagal tidak menghentikan email, tapi dicatat di riwayat supaya terlihat.
  let catatan = ''
  const log = (status: string, extra: Record<string, unknown> = {}) => {
    const pesan = [extra.pesan, catatan].filter(Boolean).join(' · ') || undefined
    return admin.rpc('fn_notification_log', { p: { pemicu, status, ...extra, pesan } })
  }
  // Kegagalan yang dikenali: dicatat, dan pesannya diawali kode supaya aplikasi menampilkannya apa adanya.
  const gagal = async (pesan: string, http: number, extra: Record<string, unknown> = {}) => {
    await log('GAGAL', { ...extra, pesan })
    return json({ ok: false, status: 'GAGAL', pesan, error: `EMAIL_GAGAL: ${pesan}` }, http)
  }

  try {
    const snap = await admin.rpc('fn_kpi_snapshot', { p: {} })
    if (snap.error) catatan = `Snapshot KPI gagal: ${snap.error.message}`
    const { data, error } = await admin.rpc('fn_digest', { p: {} })
    if (error) throw new Error(error.message)
    const d = data as DigestData
    const to = splitRecipients(d.penerima).filter((s) => EMAIL_RE.test(s))
    if (!to.length) {
      const pesan = 'Penerima email belum diisi di Parameter.'
      await log('DILEWATI', { pesan })
      return json({ ok: false, status: 'DILEWATI', pesan })
    }
    if (!d.aktif && pemicu === 'JADWAL') {
      const pesan = 'Email harian dinonaktifkan di Parameter.'
      await log('DILEWATI', { penerima: to.join(', '), pesan })
      return json({ ok: true, status: 'DILEWATI', pesan })
    }

    const { subject, html, text } = renderDigest(d, { appUrl: env('APP_URL') })
    const dasar = { penerima: to.join(', '), subjek: subject }
    const gmailUser = env('GMAIL_USER')
    const gmailPass = env('GMAIL_APP_PASSWORD').replace(/\s+/g, '')
    if (!gmailUser || !gmailPass) return await gagal('Secret GMAIL_USER / GMAIL_APP_PASSWORD belum diisi di Supabase.', 500, dasar)
    const smtp = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: gmailUser, pass: gmailPass },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    })
    let info: { messageId?: string }
    try {
      // Gmail selalu memakai akun login sebagai pengirim; hanya nama tampilannya yang bisa diatur.
      info = await smtp.sendMail({
        from: { name: env('DIGEST_FROM_NAME') || 'Seragam Ops Support', address: gmailUser },
        to, subject: pemicu === 'JADWAL' ? subject : `[TES] ${subject}`, html, text,
      })
    } catch (e) {
      const err = e as Error & { code?: string; responseCode?: number }
      const pesan = err.code === 'EAUTH'
        ? `Gmail menolak login (${err.responseCode ?? 'EAUTH'}): periksa GMAIL_USER dan App Password.`
        : `Gmail${err.code ? ` ${err.code}` : ''}: ${err.message}`
      return await gagal(pesan, 502, dasar)
    }
    await log('TERKIRIM', { ...dasar, provider_id: info.messageId })
    return json({ ok: true, status: 'TERKIRIM', penerima: to })
  } catch (e) {
    return await gagal((e as Error).message, 500)
  }
})

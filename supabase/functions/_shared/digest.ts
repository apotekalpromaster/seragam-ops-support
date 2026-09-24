/**
 * Template email ringkasan harian. Dipakai Edge Function `seragam-daily-digest`
 * (Deno) dan pratinjau di aplikasi (Vite) — jangan pakai API khusus Deno/DOM.
 * Data berasal dari RPC seragam.fn_digest.
 */
export interface DigestData {
  tanggal: string
  penerima: string
  aktif: boolean
  kpi: { karyawan_aktif: number; aktif_lengkap: number; sku_stockout: number; sku_aktif: number; total_outstanding_pcs: number; karyawan_outstanding: number } | null
  alerts: { kode: string; level: 'KRITIS' | 'PERINGATAN' | 'INFO'; judul: string; detail: string; jumlah: number; link: string }[]
  batch: { kode: string; status: string; deadline_kirim: string; terlambat: boolean; cabang_belum: number; jumlah_cabang: number }[]
  joiner: { nama: string; jabatan: string; cabang_nama: string; planned_join_date: string; belum_pcs: number }[]
  po_telat: { kode: string; vendor_nama: string; eta: string; sisa: number }[]
  retur_telat: { nama: string; cabang_nama: string; aging: number; sisa: number }[]
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const tgl = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
const tglPanjang = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const STATUS: Record<string, string> = { DRAFT: 'Draft', PICKING: 'Picking', PACKED: 'Packed', SHIPPED: 'Dikirim' }
const LEVEL = {
  KRITIS: { bg: '#FEF2F2', bar: '#DC2626', fg: '#991B1B', label: 'Kritis' },
  PERINGATAN: { bg: '#FFFBEB', bar: '#D97706', fg: '#92400E', label: 'Peringatan' },
  INFO: { bg: '#F0F9FF', bar: '#0284C7', fg: '#075985', label: 'Info' },
}

export function digestSubject(d: DigestData) {
  const k = d.alerts.filter((a) => a.level === 'KRITIS').length
  const p = d.alerts.filter((a) => a.level === 'PERINGATAN').length
  const head = k || p ? [k && `${k} kritis`, p && `${p} peringatan`].filter(Boolean).join(', ') : 'tidak ada yang mendesak'
  return `[Seragam] ${tgl(d.tanggal)} — ${head}`
}

export function renderDigest(d: DigestData, opts: { appUrl?: string } = {}) {
  const app = (opts.appUrl ?? '').replace(/\/$/, '')
  const link = (path: string, text: string) => (app ? `<a href="${esc(app + path)}" style="color:#EA580C;font-weight:600;text-decoration:none">${esc(text)}</a>` : '')
  const pct = d.kpi && d.kpi.karyawan_aktif ? Math.round((d.kpi.aktif_lengkap / d.kpi.karyawan_aktif) * 1000) / 10 : null
  const section = (title: string, body: string) => `
    <tr><td style="padding:20px 24px 0"><h2 style="margin:0 0 8px;font-size:15px;color:#0F172A">${esc(title)}</h2>${body}</td></tr>`
  const table = (head: string[], rows: string[][]) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <tr>${head.map((h) => `<th align="left" style="padding:6px 8px;border-bottom:1px solid #E5E7EB;color:#64748B;font-weight:600">${esc(h)}</th>`).join('')}</tr>
      ${rows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;color:#0F172A">${c}</td>`).join('')}</tr>`).join('')}
    </table>`
  const kpiCell = (label: string, value: string, sub: string) => `
    <td width="33%" style="padding:12px;border:1px solid #E5E7EB;border-radius:12px;background:#fff">
      <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>
      <div style="font-size:24px;font-weight:800;color:#0F172A;margin-top:2px">${esc(value)}</div>
      <div style="font-size:12px;color:#64748B">${esc(sub)}</div></td>`

  const alerts = d.alerts.length
    ? d.alerts.map((a) => {
        const s = LEVEL[a.level] ?? LEVEL.INFO
        return `<div style="background:${s.bg};border-left:4px solid ${s.bar};border-radius:8px;padding:10px 12px;margin-bottom:8px">
          <div style="font-size:13px;font-weight:700;color:${s.fg}">${esc(s.label)} · ${esc(a.judul)} (${esc(a.jumlah)})</div>
          <div style="font-size:12px;color:#334155;margin-top:2px">${esc(a.detail)} ${link(a.link, 'Buka →')}</div></div>`
      }).join('')
    : '<p style="margin:0;font-size:13px;color:#15803D">Tidak ada alert. Semua berjalan sesuai jadwal.</p>'

  const html = `<!doctype html><html lang="id"><body style="margin:0;background:#F8FAFC;font-family:'Plus Jakarta Sans',Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:16px">
    <tr><td style="padding:20px 24px;border-bottom:3px solid #F97316">
      <div style="font-size:12px;font-weight:700;color:#EA580C">APOTEK ALPRO · SERAGAM OPS SUPPORT</div>
      <div style="font-size:20px;font-weight:800;color:#0F172A;margin-top:2px">Ringkasan harian</div>
      <div style="font-size:13px;color:#64748B">${esc(tglPanjang(d.tanggal))}</div></td></tr>
    ${d.kpi ? `<tr><td style="padding:20px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate"><tr>
      ${kpiCell('Kelengkapan seragam', pct === null ? '—' : `${String(pct).replace('.', ',')}%`, `${d.kpi.aktif_lengkap} dari ${d.kpi.karyawan_aktif} karyawan aktif`)}
      ${kpiCell('SKU stock-out', String(d.kpi.sku_stockout), `dari ${d.kpi.sku_aktif} SKU aktif`)}
      ${kpiCell('Antrian outstanding', `${d.kpi.total_outstanding_pcs} pcs`, `${d.kpi.karyawan_outstanding} karyawan`)}
    </tr></table></td></tr>` : ''}
    ${section('Perlu tindakan', alerts)}
    ${d.batch.length ? section('Batch berjalan', table(['Batch', 'Status', 'Deadline kirim', 'Belum konfirmasi terima'],
      d.batch.map((b) => [esc(b.kode), esc(STATUS[b.status] ?? b.status) + (b.terlambat && b.status !== 'SHIPPED' ? ' <b style="color:#DC2626">· terlambat</b>' : ''),
        esc(tgl(b.deadline_kirim)), b.status === 'SHIPPED' ? `${b.cabang_belum} dari ${b.jumlah_cabang} cabang` : '—']))) : ''}
    ${d.joiner.length ? section('Joiner 7 hari ke depan — paket belum lengkap', table(['Nama', 'Jabatan', 'Cabang', 'Join', 'Belum'],
      d.joiner.map((j) => [esc(j.nama), esc(j.jabatan), esc(j.cabang_nama), esc(tgl(j.planned_join_date)), `${j.belum_pcs} pcs`]))) : ''}
    ${d.po_telat.length ? section('PO lewat perkiraan tiba', table(['PO', 'Vendor', 'ETA', 'Sisa'],
      d.po_telat.map((p) => [esc(p.kode), esc(p.vendor_nama), esc(tgl(p.eta)), `${p.sisa} pcs`]))) : ''}
    ${d.retur_telat.length ? section('Resign belum mengembalikan seragam', table(['Nama', 'Cabang', 'Hari', 'Sisa'],
      d.retur_telat.map((r) => [esc(r.nama), esc(r.cabang_nama), String(r.aging), `${r.sisa} pcs`]))) : ''}
    <tr><td style="padding:24px;font-size:11px;color:#94A3B8">
      Email otomatis dari Dashboard Seragam Ops Support${app ? ` · ${link('/', 'Buka dashboard')}` : ''}.<br>
      Ubah penerima atau hentikan email di Master &amp; Config → Notifikasi.</td></tr>
  </table></td></tr></table></body></html>`

  const text = [
    `Ringkasan seragam ${tglPanjang(d.tanggal)}`,
    d.kpi ? `Kelengkapan ${pct ?? '—'}% · SKU stock-out ${d.kpi.sku_stockout} · Outstanding ${d.kpi.total_outstanding_pcs} pcs` : '',
    '', 'Perlu tindakan:',
    ...(d.alerts.length ? d.alerts.map((a) => `- [${LEVEL[a.level]?.label ?? a.level}] ${a.judul} (${a.jumlah})${app ? ` ${app}${a.link}` : ''}`) : ['- Tidak ada alert.']),
  ].join('\n')

  return { subject: digestSubject(d), html, text }
}

-- =====================================================================
-- Migration M5: Monitoring (PRD §2, §3, §7.1, §7.10)
--
-- - Role APA/Branch Manager terikat ke satu cabang. APA TIDAK bisa membaca
--   view/tabel (is_app_user() = admin/staf/viewer saja); semua akses lewat RPC
--   security definer yang memfilter cabangnya: fn_apa_home, fn_batch_receive.
-- - Snapshot KPI harian (kpi_daily) → tren 6 bulan; v_kpi_monthly untuk semua KPI PRD §2.
-- - Isi email harian (fn_digest) + log notifikasi. Pengiriman lewat Edge Function
--   `seragam-daily-digest` (Resend), dijadwalkan dengan Supabase Cron.
-- - Batas tukar dihitung dari tanggal barang DITERIMA cabang (BAST); bila belum
--   dikonfirmasi, dari tanggal kirim.
-- - Alert baru: konfirmasi terima cabang tertunda.
-- =====================================================================

insert into seragam.config (key, value, type, label, description, grup, sort_order) values
  ('notif_email_to', '"operation@apotekalpro.id"', 'text', 'Penerima email harian',
   'Alamat email ringkasan harian. Pisahkan dengan koma untuk lebih dari satu penerima.', 'Notifikasi', 10),
  ('notif_email_aktif', 'true', 'bool', 'Kirim email harian',
   'Tidak = email harian berhenti dikirim (alert di aplikasi tetap tampil).', 'Notifikasi', 20),
  ('apa_confirm_days', '7', 'int', 'Batas konfirmasi terima cabang (hari)',
   'Cabang yang belum mengonfirmasi terima lebih dari sekian hari setelah batch dikirim muncul di alert.', 'Jadwal distribusi', 60)
on conflict (key) do nothing;

-- ---------- Role APA per cabang ----------
alter table seragam.app_user add column kode_cabang text references seragam.branch (kode_cabang);
alter table seragam.app_user add constraint app_user_apa_cabang check (role <> 'apa' or kode_cabang is not null);

-- APA hanya lewat RPC: tidak ikut policy baca tabel/view.
create or replace function seragam.is_app_user()
returns boolean language sql stable security definer set search_path = seragam, public as $$
  select exists (select 1 from seragam.app_user where user_id = auth.uid() and aktif and role in ('admin', 'staf', 'viewer'))
$$;

create or replace function seragam.apa_cabang()
returns text language sql stable security definer set search_path = seragam, public as $$
  select kode_cabang from seragam.app_user where user_id = auth.uid() and aktif and role = 'apa'
$$;

-- Dipanggil Edge Function dengan service role key.
create or replace function seragam._is_service()
returns boolean language sql stable as $$
  -- coalesce ke false: NULL di "if not _is_service()" akan melewati pengecekan role.
  select coalesce(coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role', false)
$$;

create or replace function seragam.fn_me(p jsonb default '{}')
returns jsonb language sql stable security definer set search_path = seragam, public as $$
  select coalesce(
    (select jsonb_build_object('user_id', u.user_id, 'email', u.email, 'nama', u.nama, 'role', u.role,
                               'kode_cabang', u.kode_cabang, 'cabang_nama', b.nama)
       from seragam.app_user u left join seragam.branch b on b.kode_cabang = u.kode_cabang
      where u.user_id = auth.uid() and u.aktif),
    jsonb_build_object('user_id', auth.uid(), 'role', null))
$$;

create or replace function seragam.fn_user_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public, auth as $$
declare v_uid uuid; v_email text := lower(trim(p ->> 'email')); v_role text := p ->> 'role';
        v_aktif boolean := coalesce((p ->> 'aktif')::boolean, true); v_cab text := nullif(upper(trim(p ->> 'kode_cabang')), '');
begin
  perform seragam.require_role('admin');
  if v_role not in ('admin', 'staf', 'viewer', 'apa') then raise exception 'VALIDASI: Role tidak dikenal.'; end if;
  if v_role = 'apa' and v_cab is null then raise exception 'VALIDASI: Pilih cabang untuk akun APA / Branch Manager.'; end if;
  if v_cab is not null and not exists (select 1 from seragam.branch where kode_cabang = v_cab) then
    raise exception 'VALIDASI: Cabang % tidak dikenal.', v_cab;
  end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    raise exception 'USER_TIDAK_ADA: Email % belum punya akun login. Buat dulu di Supabase → Authentication → Add user, lalu ulangi.', v_email;
  end if;
  if v_uid = auth.uid() and (v_role <> 'admin' or not v_aktif) then
    raise exception 'VALIDASI: Anda tidak bisa menurunkan role atau menonaktifkan akun sendiri.';
  end if;
  insert into seragam.app_user (user_id, email, nama, role, aktif, kode_cabang)
  values (v_uid, v_email, coalesce(nullif(trim(p ->> 'nama'), ''), v_email), v_role, v_aktif, case when v_role = 'apa' then v_cab end)
  on conflict (user_id) do update set nama = excluded.nama, role = excluded.role, aktif = excluded.aktif, email = excluded.email,
                                      kode_cabang = excluded.kode_cabang;
  return jsonb_build_object('ok', true);
end $$;

-- Konfirmasi terima: admin/staf untuk cabang mana pun; APA hanya cabangnya sendiri & wajib BAST.
create or replace function seragam.fn_batch_receive(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare b seragam.batch; bb seragam.batch_branch; v_tgl date := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
        v_sisa int; v_role text; v_cab text := p ->> 'kode_cabang';
begin
  v_role := seragam.require_role('admin', 'staf', 'apa');
  if v_role = 'apa' then
    v_cab := seragam.apa_cabang();
    if coalesce(p ->> 'kode_cabang', v_cab) <> v_cab then raise exception 'AKSES_DITOLAK: Anda hanya bisa mengonfirmasi kiriman untuk cabang Anda.'; end if;
    if coalesce(p ->> 'bast_path', '') = '' then raise exception 'VALIDASI: Unggah foto/scan BAST yang sudah ditandatangani.'; end if;
  end if;
  select * into b from seragam.batch where id = (p ->> 'batch_id')::bigint for update;
  if not found then raise exception 'TIDAK_DITEMUKAN: Batch tidak ditemukan.'; end if;
  if b.status not in ('SHIPPED', 'SELESAI') then raise exception 'STATUS: Konfirmasi terima hanya untuk batch yang sudah dikirim.'; end if;
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal terima tidak boleh di masa depan.'; end if;
  if v_tgl < b.shipped_at then raise exception 'VALIDASI: Tanggal terima tidak boleh sebelum tanggal kirim (%).', to_char(b.shipped_at, 'DD-MM-YYYY'); end if;
  select * into bb from seragam.batch_branch where batch_id = b.id and kode_cabang = v_cab;
  if not found then raise exception 'TIDAK_DITEMUKAN: Cabang ini tidak ada di batch %.', b.kode; end if;
  if v_role = 'apa' and bb.received_at is not null then
    raise exception 'STATUS: Kiriman ini sudah dikonfirmasi diterima pada %. Hubungi Ops Support bila ada kesalahan.', to_char(bb.received_at, 'DD-MM-YYYY');
  end if;
  update seragam.batch_branch set received_at = v_tgl, received_by = auth.uid(), recorded_at = now(),
    bast_path = coalesce(nullif(p ->> 'bast_path', ''), bast_path), catatan = nullif(trim(p ->> 'catatan'), '')
  where batch_id = b.id and kode_cabang = v_cab;
  select count(*) into v_sisa from seragam.batch_branch where batch_id = b.id and received_at is null;
  if v_sisa = 0 then
    update seragam.batch set status = 'SELESAI', selesai_at = now() where id = b.id;
  end if;
  return jsonb_build_object('ok', true, 'cabang_belum', v_sisa, 'selesai', v_sisa = 0);
end $$;

-- Beranda APA: kiriman ke cabangnya, paket joiner yang ditahan, seragam yang harus dikembalikan.
-- Admin/staf/viewer boleh memanggil dengan {kode_cabang} untuk melihat tampilan APA.
create or replace function seragam.fn_apa_home(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
declare v_role text; v_cab text;
begin
  v_role := seragam.require_role('admin', 'staf', 'viewer', 'apa');
  v_cab := case when v_role = 'apa' then seragam.apa_cabang() else nullif(upper(trim(p ->> 'kode_cabang')), '') end;
  if v_cab is null then raise exception 'VALIDASI: Akun ini belum dikaitkan ke cabang. Hubungi admin Ops Support.'; end if;
  return jsonb_build_object(
    'cabang', (select jsonb_build_object('kode_cabang', kode_cabang, 'nama', nama, 'area', area, 'alamat', alamat)
                 from seragam.branch where kode_cabang = v_cab),
    'pengiriman', coalesce((
      select jsonb_agg(x order by (x ->> 'received_at') nulls first, (x ->> 'shipped_at') desc)
      from (
        select jsonb_build_object(
          'batch_id', b.id, 'kode', b.kode, 'shipped_at', b.shipped_at, 'received_at', bb.received_at, 'ada_bast', bb.bast_path is not null,
          'pcs', (select coalesce(sum(bl.qty), 0) from seragam.batch_line bl where bl.batch_id = b.id and bl.kode_cabang = v_cab),
          'karyawan', (
            select coalesce(jsonb_agg(jsonb_build_object('nama', e.nama, 'jabatan', e.jabatan, 'status', e.status,
                                                         'planned_join_date', e.planned_join_date, 'items', k.items) order by e.nama), '[]')
            from (select bl.nik, jsonb_agg(jsonb_build_object('label', s.label, 'qty', bl.qty) order by s.item_sort) as items
                    from seragam.batch_line bl join seragam.v_sku s on s.sku_code = bl.sku_code
                   where bl.batch_id = b.id and bl.kode_cabang = v_cab group by bl.nik) k
            join seragam.employee e on e.nik = k.nik)) as x
        from seragam.batch b
        join seragam.batch_branch bb on bb.batch_id = b.id and bb.kode_cabang = v_cab
        where b.status in ('SHIPPED', 'SELESAI') and (bb.received_at is null or bb.received_at > current_date - 60)
      ) t), '[]'),
    'ditahan', coalesce((
      select jsonb_agg(jsonb_build_object('nama', nama, 'jabatan', jabatan, 'planned_join_date', planned_join_date, 'pcs', pcs) order by planned_join_date)
      from (select nama, jabatan, planned_join_date, sum(qty)::int as pcs from seragam.v_batch_line
             where kode_cabang = v_cab and penyerahan = 'DITAHAN_APA' group by nik, nama, jabatan, planned_join_date) d), '[]'),
    'retur', coalesce((
      select jsonb_agg(jsonb_build_object('nama', e.nama, 'jabatan', e.jabatan, 'sumber', r.sumber, 'tanggal_acuan', r.tanggal_acuan, 'items', r.items)
                       order by r.tanggal_acuan)
      from (select lv.nik, lv.sumber, lv.tanggal_acuan,
                   jsonb_agg(jsonb_build_object('item_nama', it.nama, 'qty', lv.wajib_sekarang - lv.dihapuskan) order by it.sort_order) as items
              from seragam.v_return_leaver lv join seragam.item it on it.item_code = lv.item_code
             where lv.wajib_sekarang - lv.dihapuskan > 0 group by lv.nik, lv.sumber, lv.tanggal_acuan) r
      join seragam.employee e on e.nik = r.nik and e.kode_cabang = v_cab), '[]'),
    'akan_resign', coalesce((
      select jsonb_agg(jsonb_build_object('nama', a.nama, 'jabatan', a.jabatan, 'planned_resign_date', a.planned_resign_date, 'items', a.items)
                       order by a.planned_resign_date)
      from seragam.v_akan_resign a where a.kode_cabang = v_cab), '[]')
  );
end $$;

-- ---------- Batas tukar dari tanggal diterima cabang ----------
create or replace view seragam.v_issue_last with (security_invoker = true) as
select distinct on (l.nik, s.item_code) l.nik, s.item_code, l.sku_code, l.tanggal, l.id as ledger_id,
       (select bb.received_at from seragam.batch_line bl
          join seragam.batch_branch bb on bb.batch_id = bl.batch_id and bb.kode_cabang = bl.kode_cabang
         where bl.batch_id = l.batch_id and bl.nik = l.nik limit 1) as diterima
from seragam.ledger l
join seragam.sku s on s.sku_code = l.sku_code
where l.tx_type = 'ISSUE' and l.nik is not null
  and not exists (select 1 from seragam.ledger r where r.reversal_of = l.id)
order by l.nik, s.item_code, l.tanggal desc, l.id desc;

create or replace function seragam.fn_exchange_check(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
declare e seragam.employee; v_item text := upper(trim(p ->> 'item_code')); il record; v_net int; v_tgl date; v_batas int;
        v_acuan date; v_jenis text;
begin
  perform seragam.require_role('admin', 'staf', 'viewer');
  select * into e from seragam.employee where nik = upper(trim(p ->> 'nik'));
  if not found then raise exception 'TIDAK_DITEMUKAN: Karyawan tidak ditemukan.'; end if;
  v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
  v_batas := seragam.cfg_int('exchange_window_days', 14);
  select * into il from seragam.v_issue_last where nik = e.nik and item_code = v_item;
  select coalesce(issued - returned, 0) into v_net from seragam.v_issued where nik = e.nik and item_code = v_item;
  v_net := coalesce(v_net, 0);
  v_acuan := coalesce(il.diterima, il.tanggal);
  v_jenis := case when il.diterima is not null then 'DITERIMA' else 'DIKIRIM' end;
  return jsonb_build_object(
    'issue_date', v_acuan, 'acuan', v_jenis, 'tanggal_kirim', il.tanggal, 'tanggal_terima', il.diterima,
    'sku_in', il.sku_code, 'issued_net', v_net, 'batas',  v_batas,
    'hari', case when v_acuan is not null then greatest(0, v_tgl - v_acuan) end,
    'ok', e.status in ('AKTIF', 'OFFERING') and il.tanggal is not null and v_net > 0 and v_tgl - v_acuan <= v_batas,
    'alasan_tolak', case
      when e.status not in ('AKTIF', 'OFFERING') then 'Karyawan berstatus ' || lower(e.status::text) || '; tukar hanya untuk karyawan aktif.'
      when il.tanggal is null or v_net <= 0 then 'Karyawan belum pernah menerima item ini dari alokasi.'
      when v_tgl - v_acuan > v_batas then 'Sudah ' || (v_tgl - v_acuan) || ' hari sejak barang '
                                          || case v_jenis when 'DITERIMA' then 'diterima cabang' else 'dikirim' end
                                          || ' (' || to_char(v_acuan, 'DD-MM-YYYY') || '); batas tukar ' || v_batas || ' hari.'
    end);
end $$;

-- ---------- Snapshot KPI harian & KPI bulanan ----------
create table seragam.kpi_daily (
  tanggal         date primary key,
  karyawan_aktif  int not null,
  aktif_lengkap   int not null,
  sku_aktif       int not null,
  sku_stockout    int not null,
  outstanding_pcs int not null,
  karantina_pcs   int not null,
  retur_belum_pcs int not null,
  created_at      timestamptz not null default now()
);

create or replace function seragam.fn_kpi_snapshot(p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_tgl date := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
begin
  if not seragam._is_service() then perform seragam.require_role('admin'); end if;
  insert into seragam.kpi_daily (tanggal, karyawan_aktif, aktif_lengkap, sku_aktif, sku_stockout, outstanding_pcs, karantina_pcs, retur_belum_pcs)
  select v_tgl, k.karyawan_aktif, k.aktif_lengkap, k.sku_aktif, k.sku_stockout, k.total_outstanding_pcs,
         (select coalesce(sum(qty), 0) from seragam.v_stock where stock_status = 'KARANTINA'),
         (select sisa from seragam.v_kpi_return)
  from seragam.v_kpi_current k
  on conflict (tanggal) do update set karyawan_aktif = excluded.karyawan_aktif, aktif_lengkap = excluded.aktif_lengkap,
    sku_aktif = excluded.sku_aktif, sku_stockout = excluded.sku_stockout, outstanding_pcs = excluded.outstanding_pcs,
    karantina_pcs = excluded.karantina_pcs, retur_belum_pcs = excluded.retur_belum_pcs, created_at = now();
  return jsonb_build_object('ok', true, 'tanggal', v_tgl);
end $$;

-- Semua KPI PRD §2 per bulan (6 bulan terakhir). Kolom pembilang/penyebut supaya persentase bisa dihitung ulang.
create view seragam.v_kpi_monthly with (security_invoker = true) as
with
m as (select generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month')::date as periode),
snap as (
  select distinct on (date_trunc('month', tanggal)) date_trunc('month', tanggal)::date as periode, *
  from seragam.kpi_daily order by date_trunc('month', tanggal), tanggal desc
),
opn as (
  select date_trunc('month', o.tanggal)::date as periode,
         sum(abs(coalesce(l.qty_fisik, l.qty_sistem) - l.qty_sistem))::int as selisih, sum(l.qty_sistem)::int as stok_sistem
  from seragam.stock_opname o join seragam.stock_opname_line l on l.opname_id = o.id
  where o.status = 'APPROVED' and not o.is_opening group by 1
),
joiner as (
  select date_trunc('month', e.planned_join_date)::date as periode, e.nik,
         (e.status = 'BATAL_JOIN' or (e.status = 'OFFERING' and e.join_date is null
            and e.planned_join_date + seragam.cfg_int('noshow_grace_days', 7) < current_date)) as noshow
  from seragam.employee e
  where e.planned_join_date >= date_trunc('month', current_date) - interval '5 months'
    and exists (select 1 from seragam.ledger l where l.nik = e.nik and l.tx_type = 'ISSUE' and l.affects_stock)
),
ns as (select periode, count(*)::int as joiner_dikirim, count(*) filter (where noshow)::int as noshow from joiner group by periode),
rr as (
  select date_trunc('month', tanggal_acuan)::date as periode, sum(dikembalikan)::int as dikembalikan,
         sum(wajib_sekarang + dikembalikan)::int as wajib
  from seragam.v_return_leaver where sumber in ('RESIGN', 'PKL_SELESAI') group by 1
)
select m.periode,
       snap.karyawan_aktif, snap.aktif_lengkap, snap.sku_aktif, snap.sku_stockout,
       ip.tepat_waktu as ppm_tepat_waktu, ip.ada_import as ppm_ada_import,
       coalesce(bm.batch_dikirim, 0) as batch_dikirim, coalesce(bm.tepat_waktu, 0) as batch_tepat_waktu,
       coalesce(jm.joiner, 0) as joiner_join, coalesce(jm.tiba_sebelum_join, 0) as joiner_tiba_sebelum_join, coalesce(jm.late_hire, 0) as joiner_late_hire,
       coalesce(ns.joiner_dikirim, 0) as joiner_dikirim, coalesce(ns.noshow, 0) as joiner_noshow,
       coalesce(ex.tukar, 0) as tukar, coalesce(ex.issue, 0) as issue,
       coalesce(rr.dikembalikan, 0) as retur_kembali, coalesce(rr.wajib, 0) as retur_wajib,
       opn.selisih as opname_selisih, opn.stok_sistem as opname_stok_sistem
from m
left join snap on snap.periode = m.periode
left join seragam.v_kpi_import_monthly ip on ip.periode = m.periode
left join seragam.v_kpi_batch_monthly bm on bm.periode = m.periode
left join seragam.v_kpi_joiner_monthly jm on jm.periode = m.periode
left join ns on ns.periode = m.periode
left join seragam.v_kpi_exchange_monthly ex on ex.periode = m.periode
left join rr on rr.periode = m.periode
left join opn on opn.periode = m.periode;

-- ---------- Alert: tambah konfirmasi terima cabang tertunda ----------
create or replace view seragam.v_alert with (security_invoker = true) as
with
outs as materialized (
  select nik, item_code, sku_target, size_status, outstanding from seragam.v_outstanding
),
unmapped as materialized (select count(*)::int n, coalesce(sum(jumlah_karyawan), 0)::int k from seragam.v_unmapped_position),
size_kosong as materialized (select count(distinct nik)::int n from outs where size_status = 'KOSONG'),
size_invalid as materialized (select count(distinct nik)::int n from outs where size_status = 'TIDAK_TERSEDIA'),
plan as materialized (select status from seragam.v_sku_planning where active),
kritis as materialized (select count(*)::int n from plan where status = 'KRITIS'),
perlu_order as materialized (select count(*)::int n from plan where status = 'ORDER'),
po_telat as materialized (select count(*)::int n from seragam.v_po where terlambat),
lv as materialized (select * from seragam.v_return_leaver),
retur_telat as materialized (
  select count(distinct nik)::int n from lv
  where sumber in ('RESIGN', 'PKL_SELESAI') and wajib_sekarang - dihapuskan > 0
    and current_date - tanggal_acuan > seragam.cfg_int('return_alert_days', 14)
),
retur_cabang as materialized (
  select count(distinct nik)::int n from lv where sumber in ('BATAL_JOIN', 'NOSHOW') and wajib_sekarang - dihapuskan > 0
),
terima_tertunda as materialized (
  select count(*)::int n from seragam.batch_branch bb join seragam.batch b on b.id = bb.batch_id
  where b.status = 'SHIPPED' and bb.received_at is null and current_date - b.shipped_at > seragam.cfg_int('apa_confirm_days', 7)
),
stok_status as materialized (
  select coalesce(sum(qty) filter (where stock_status = 'KARANTINA'), 0)::int as karantina,
         coalesce(sum(qty) filter (where stock_status = 'AFKIR'), 0)::int as afkir
  from seragam.v_stock
),
imp as materialized (
  select exists (
    select 1 from seragam.import_log
    where status = 'COMMITTED' and periode = date_trunc('month', current_date)::date
  ) as sudah
),
opening as materialized (select exists (select 1 from seragam.ledger where tx_type = 'OPENING') as ada),
telat as materialized (
  select count(*)::int n from seragam.batch
  where status in ('DRAFT', 'PICKING', 'PACKED') and current_date > deadline_kirim
),
late_hire as materialized (
  select count(distinct o.nik)::int n
  from outs o
  join seragam.employee e on e.nik = o.nik and e.is_late_hire
  left join seragam.v_in_batch ib on ib.nik = o.nik and ib.item_code = o.item_code
  where o.outstanding - coalesce(ib.qty, 0) > 0
)
select * from (
  select 'IMPORT_TERLAMBAT' as kode, 'KRITIS' as level,
         'Import data PPM bulan ini belum dilakukan' as judul,
         'Lewat tanggal cutoff (' || seragam.cfg_int('cutoff_day', 5) || '). Antrian alokasi memakai data lama.' as detail,
         1 as jumlah, '/import' as link, 1 as urutan
  from imp where not imp.sudah and extract(day from current_date) > seragam.cfg_int('cutoff_day', 5)
  union all
  select 'BATCH_TERLAMBAT', 'KRITIS', 'Batch melewati deadline kirim',
         'Batch belum berstatus dikirim padahal deadline sudah lewat.', n, '/batch', 2
  from telat where n > 0
  union all
  select 'SKU_KRITIS', 'KRITIS', 'SKU berstatus kritis',
         'Available tidak cukup untuk antrian atau sudah di bawah safety stock. Buat PO dari saran order.', n, '/pengadaan?status=KRITIS', 3
  from kritis where n > 0
  union all
  select 'RETUR_TERLAMBAT', 'PERINGATAN', 'Resign belum mengembalikan seragam',
         'Lebih dari ' || seragam.cfg_int('return_alert_days', 14) || ' hari sejak tanggal resign.', n, '/retur?terlambat=1', 4
  from retur_telat where n > 0
  union all
  select 'KONFIRMASI_TERTUNDA', 'PERINGATAN', 'Cabang belum mengonfirmasi terima',
         'Lebih dari ' || seragam.cfg_int('apa_confirm_days', 7) || ' hari sejak batch dikirim. Kirim link konfirmasi ke APA.', n, '/batch', 5
  from terima_tertunda where n > 0
  union all
  select 'PERMINTAAN_RETUR', 'PERINGATAN', 'Paket joiner batal join / no-show masih di cabang',
         'Minta cabang mengembalikan paket ke gudang, lalu catat pengembalian.', n, '/retur?sumber=cabang', 6
  from retur_cabang where n > 0
  union all
  select 'SKU_ORDER', 'PERINGATAN', 'SKU sudah mencapai titik pesan ulang',
         'Available + dalam pemesanan ≤ ROP. Pesan sekarang supaya barang datang sebelum habis.', n, '/pengadaan?status=ORDER', 7
  from perlu_order where n > 0
  union all
  select 'PO_TERLAMBAT', 'PERINGATAN', 'PO melewati perkiraan tiba',
         'Barang belum diterima lengkap padahal ETA sudah lewat. Hubungi vendor.', n, '/pengadaan?tab=po&status=terlambat', 8
  from po_telat where n > 0
  union all
  select 'JABATAN_BELUM_DIMAPPING', 'PERINGATAN', 'Jabatan belum dimapping ke paket',
         k || ' karyawan tidak masuk antrian sampai jabatannya dimapping.', n, '/master/jabatan', 9
  from unmapped where n > 0
  union all
  select 'UKURAN_TIDAK_TERSEDIA', 'PERINGATAN', 'Ukuran tidak tersedia untuk item',
         'Perlu keputusan manual: ganti ukuran, pesan khusus, atau ganti item.', n, '/antrian?tab=tidak_tersedia', 10
  from size_invalid where n > 0
  union all
  select 'UKURAN_KOSONG', 'PERINGATAN', 'Karyawan belum punya data ukuran',
         'Tagih ke PPM sebelum cutoff berikutnya.', n, '/antrian?tab=menunggu_ukuran', 11
  from size_kosong where n > 0
  union all
  select 'QC_MENUNGGU', 'INFO', 'Barang karantina menunggu QC',
         'Barang kembali belum bisa dipakai sampai di-QC (pcs).', karantina, '/qc', 12
  from stok_status where karantina > 0
  union all
  select 'AFKIR_BELUM_MUSNAH', 'INFO', 'Barang afkir menunggu pemusnahan',
         'Musnahkan logo lalu catat pemusnahan (pcs).', afkir, '/qc?tab=afkir', 13
  from stok_status where afkir > 0
  union all
  select 'HIRE_MENDADAK', 'INFO', 'Hire mendadak menunggu batch ad-hoc',
         'Buat batch ad-hoc dengan cakupan "Hire mendadak".', n, '/antrian?hire=1', 14
  from late_hire where n > 0
  union all
  select 'STOK_AWAL_BELUM', 'INFO', 'Stok awal belum diinput',
         'Lakukan stock opname pertama untuk membentuk saldo awal (OPENING).', 1, '/opname', 15
  from opening where not opening.ada
) a;

-- ---------- Email harian ----------
create table seragam.notification_log (
  id          bigint generated always as identity primary key,
  sent_at     timestamptz not null default now(),
  jenis       text not null default 'RINGKASAN_HARIAN',
  pemicu      text not null,               -- JADWAL / TES oleh <email>
  penerima    text,
  subjek      text,
  status      text not null check (status in ('TERKIRIM', 'GAGAL', 'DILEWATI')),
  pesan       text,
  provider_id text
);

-- Isi ringkasan harian (dipakai Edge Function dan pratinjau di aplikasi).
create or replace function seragam.fn_digest(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
begin
  if not seragam._is_service() then perform seragam.require_role('admin'); end if;
  return jsonb_build_object(
    'tanggal', current_date,
    'penerima', coalesce(seragam.cfg('notif_email_to') #>> '{}', ''),
    'aktif', coalesce((seragam.cfg('notif_email_aktif') #>> '{}')::boolean, true),
    'kpi', (select to_jsonb(k) from seragam.v_kpi_current k),
    'alerts', coalesce((select jsonb_agg(to_jsonb(a) order by a.urutan) from seragam.v_alert a), '[]'),
    'batch', coalesce((
      select jsonb_agg(jsonb_build_object('kode', kode, 'jenis', jenis, 'status', status, 'deadline_kirim', deadline_kirim,
                                          'terlambat', terlambat, 'cabang_belum', jumlah_cabang - cabang_diterima, 'jumlah_cabang', jumlah_cabang)
                       order by deadline_kirim)
      from seragam.v_batch where status not in ('SELESAI', 'DIBATALKAN')), '[]'),
    'joiner', coalesce((
      select jsonb_agg(jsonb_build_object('nama', nama, 'jabatan', jabatan, 'cabang_nama', cabang_nama,
                                          'planned_join_date', planned_join_date, 'belum_pcs', outstanding_total) order by planned_join_date)
      from seragam.v_employee_list
      where status = 'OFFERING' and planned_join_date between current_date and current_date + 7 and outstanding_total > 0), '[]'),
    'po_telat', coalesce((
      select jsonb_agg(jsonb_build_object('kode', kode, 'vendor_nama', vendor_nama, 'eta', eta, 'sisa', sisa) order by eta)
      from seragam.v_po where terlambat), '[]'),
    'retur_telat', coalesce((
      select jsonb_agg(x order by (x ->> 'aging')::int desc) from (
        select jsonb_build_object('nama', e.nama, 'cabang_nama', b.nama, 'aging', current_date - lv.tanggal_acuan,
                                  'sisa', sum(lv.wajib_sekarang - lv.dihapuskan)) as x
        from seragam.v_return_leaver lv
        join seragam.employee e on e.nik = lv.nik join seragam.branch b on b.kode_cabang = e.kode_cabang
        where lv.sumber in ('RESIGN', 'PKL_SELESAI') and lv.wajib_sekarang - lv.dihapuskan > 0
          and current_date - lv.tanggal_acuan > seragam.cfg_int('return_alert_days', 14)
        group by e.nik, e.nama, b.nama, lv.tanggal_acuan
        order by current_date - lv.tanggal_acuan desc limit 10) t), '[]')
  );
end $$;

create or replace function seragam.fn_notification_log(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint;
begin
  if not seragam._is_service() then perform seragam.require_role('admin'); end if;
  insert into seragam.notification_log (jenis, pemicu, penerima, subjek, status, pesan, provider_id)
  values (coalesce(p ->> 'jenis', 'RINGKASAN_HARIAN'), coalesce(p ->> 'pemicu', 'JADWAL'), p ->> 'penerima', p ->> 'subjek',
          p ->> 'status', left(p ->> 'pesan', 2000), p ->> 'provider_id')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create view seragam.v_notification_log with (security_invoker = true) as
select * from seragam.notification_log;

-- ---------- Storage: APA mengunggah BAST untuk cabangnya ----------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'seragam_bast_insert_apa') then
      execute $p$create policy seragam_bast_insert_apa on storage.objects for insert to authenticated
               with check (bucket_id = 'seragam-bast' and seragam.apa_cabang() is not null
                           and name like 'batch-%/' || seragam.apa_cabang() || '-%')$p$;
    end if;
  end if;
end $$;

-- ---------- RLS & grant ----------
do $$
declare t text;
begin
  foreach t in array array['kpi_daily', 'notification_log'] loop
    execute format('alter table seragam.%I enable row level security', t);
    execute format('create policy %I on seragam.%I for select to authenticated using (seragam.is_app_user())', t || '_read', t);
  end loop;
  -- Edge Function memakai service role: butuh akses fungsi ringkasan & log.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema seragam to service_role;
    grant execute on function seragam.fn_digest(jsonb), seragam.fn_kpi_snapshot(jsonb), seragam.fn_notification_log(jsonb),
                              seragam.fn_me(jsonb) to service_role;
  end if;
end $$;

grant select on all tables in schema seragam to authenticated;
grant execute on all functions in schema seragam to authenticated;
revoke execute on function seragam._is_service() from authenticated;

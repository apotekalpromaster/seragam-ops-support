-- =====================================================================
-- Migration: perbaikan hasil code review (setelah M5)
--
-- 1. Keamanan: fungsi internal (_ledger_insert, write_audit, _import_evaluate, …)
--    ternyata bisa dieksekusi semua pengguna login di project Supabase bersama
--    (EXECUTE default ke PUBLIC + "grant … on all functions" tiap migration).
--    → _apply_hardening(): cabut semua, beri authenticated hanya fn_* dan helper
--      yang dipakai view/RLS. WAJIB dipanggil di akhir setiap migration baru.
-- 2. Zona waktu: database UTC, pengguna WIB. current_date di fungsi & view kini
--    tanggal WIB (fungsi: SET timezone; view: seragam.today()).
-- 3. fn_return_receive menolak item ganda dalam satu permintaan.
-- 4. v_karantina_lot: pengurangan karantina tanpa lot (mis. ADJ opname negatif)
--    dibebankan ke lot tertua (FIFO), jadi sisa QC = stok karantina nyata.
-- 5. SKU default retur/tukar = SKU terakhir yang diterima karyawan (ISSUE atau
--    barang pengganti tukar), bukan selalu SKU ISSUE.
-- 6. Policy upload BAST untuk APA hanya ke batch yang memuat cabangnya.
-- 7. Pembelian yang semua barisnya dikoreksi lewat Riwayat transaksi ikut
--    ditandai dibatalkan.
-- =====================================================================

-- ---------- 2. Tanggal WIB ----------
create or replace function seragam.today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Jakarta')::date
$$;

-- ---------- 5. SKU terakhir yang diterima karyawan per item ----------
create view seragam.v_last_sku with (security_invoker = true) as
select distinct on (l.nik, s.item_code) l.nik, s.item_code, l.sku_code, l.tanggal
from seragam.ledger l
join seragam.sku s on s.sku_code = l.sku_code
where l.tx_type in ('ISSUE', 'EXC_OUT') and l.nik is not null
  and not exists (select 1 from seragam.ledger r where r.reversal_of = l.id)
order by l.nik, s.item_code, l.tanggal desc, l.id desc;

create or replace view seragam.v_return_obligation with (security_invoker = true) as
with
wo as materialized (select nik, item_code, sum(qty)::int as q from seragam.return_writeoff group by nik, item_code),
lv as materialized (select * from seragam.v_return_leaver),
mut as materialized (
  select ei.nik, 'MUTASI'::text as sumber,
         (select max((il.committed_at at time zone 'Asia/Jakarta')::date) from seragam.import_diff d join seragam.import_log il on il.id = d.import_id
           where d.nik = ei.nik and d.change_type = 'MUTASI_JABATAN' and il.status = 'COMMITTED') as tanggal_acuan,
         ei.item_code, ei.over_issued as wajib_sekarang,
         coalesce((select i.returned from seragam.v_issued i where i.nik = ei.nik and i.item_code = ei.item_code), 0) as dikembalikan,
         coalesce(wo.q, 0) as dihapuskan
  -- OFFSET 0: jangan dorong filter over_issued ke perhitungan hak (lihat v_queue).
  from (select * from seragam.v_employee_item offset 0) ei
  join seragam.employee e on e.nik = ei.nik and e.status in ('AKTIF', 'OFFERING')
  left join wo on wo.nik = ei.nik and wo.item_code = ei.item_code
  where ei.over_issued > 0 and not exists (select 1 from lv where lv.nik = ei.nik)
),
alls as (select * from lv union all select * from mut)
select o.nik, e.nama, e.jabatan, e.kode_cabang, b.nama as cabang_nama, b.area, e.status as employee_status, e.is_loan,
       o.sumber, o.tanggal_acuan, (seragam.today() - o.tanggal_acuan) as aging_hari,
       o.item_code, it.nama as item_nama, it.sort_order as item_sort,
       ls.sku_code, s.label as sku_label, p.price,
       o.wajib_sekarang + o.dikembalikan as wajib,
       o.dikembalikan, o.dihapuskan,
       greatest(0, o.wajib_sekarang - o.dihapuskan) as sisa,
       (greatest(0, o.wajib_sekarang - o.dihapuskan) * coalesce(p.price, 0))::numeric(16, 2) as nilai,
       case when greatest(0, o.wajib_sekarang - o.dihapuskan) = 0 and o.dihapuskan > 0 then 'DIHAPUSKAN'
            when greatest(0, o.wajib_sekarang - o.dihapuskan) = 0 then 'LENGKAP'
            when o.dikembalikan > 0 or o.dihapuskan > 0 then 'SEBAGIAN'
            else 'BELUM' end as status
from alls o
join seragam.employee e on e.nik = o.nik
join seragam.branch b on b.kode_cabang = e.kode_cabang
join seragam.item it on it.item_code = o.item_code
left join seragam.v_last_sku ls on ls.nik = o.nik and ls.item_code = o.item_code
left join seragam.v_sku s on s.sku_code = ls.sku_code
left join seragam.v_sku_price_current p on p.sku_code = ls.sku_code;

create or replace function seragam.fn_exchange_check(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
declare e seragam.employee; v_item text := upper(trim(p ->> 'item_code')); il record; v_net int; v_tgl date; v_batas int;
        v_acuan date; v_jenis text; v_held text;
begin
  perform seragam.require_role('admin', 'staf', 'viewer');
  select * into e from seragam.employee where nik = upper(trim(p ->> 'nik'));
  if not found then raise exception 'TIDAK_DITEMUKAN: Karyawan tidak ditemukan.'; end if;
  v_tgl := coalesce(seragam.try_date(p ->> 'tanggal'), current_date);
  v_batas := seragam.cfg_int('exchange_window_days', 14);
  select * into il from seragam.v_issue_last where nik = e.nik and item_code = v_item;
  select sku_code into v_held from seragam.v_last_sku where nik = e.nik and item_code = v_item;
  select coalesce(issued - returned, 0) into v_net from seragam.v_issued where nik = e.nik and item_code = v_item;
  v_net := coalesce(v_net, 0);
  v_acuan := coalesce(il.diterima, il.tanggal);
  v_jenis := case when il.diterima is not null then 'DITERIMA' else 'DIKIRIM' end;
  return jsonb_build_object(
    'issue_date', v_acuan, 'acuan', v_jenis, 'tanggal_kirim', il.tanggal, 'tanggal_terima', il.diterima,
    'sku_in', coalesce(v_held, il.sku_code), 'issued_net', v_net, 'batas', v_batas,
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

-- ---------- 3. Retur: tolak item ganda ----------
create or replace function seragam.fn_return_receive(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_nik text := upper(trim(p ->> 'nik')); v_tgl date; r jsonb; v_item text; v_skucode text; v_qty int; ob record;
        v_sumber text; v_id bigint; v_kode text; v_pcs int := 0; seen text[] := '{}';
begin
  perform seragam.require_role('admin', 'staf');
  if not exists (select 1 from seragam.employee where nik = v_nik) then raise exception 'TIDAK_DITEMUKAN: Karyawan tidak ditemukan.'; end if;
  v_tgl := seragam.try_date(p ->> 'tanggal');
  if v_tgl is null then raise exception 'VALIDASI: Tanggal pengembalian wajib diisi.'; end if;
  if v_tgl > current_date then raise exception 'VALIDASI: Tanggal pengembalian tidak boleh di masa depan.'; end if;
  create temp table _ob on commit drop as
    select item_code, sku_code, sumber, sisa from seragam.v_return_obligation where nik = v_nik;
  for r in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    v_item := upper(trim(r ->> 'item_code'));
    if v_item = any (seen) then raise exception 'VALIDASI: Item % tercantum lebih dari sekali. Gabungkan qty-nya dalam satu baris.', v_item; end if;
    seen := seen || v_item;
    begin v_qty := coalesce((r ->> 'qty')::int, 0); exception when others then raise exception 'VALIDASI: Qty harus bilangan bulat.'; end;
    if v_qty = 0 then continue; end if;
    if v_qty < 0 then raise exception 'VALIDASI: Qty tidak boleh negatif.'; end if;
    select * into ob from _ob where item_code = v_item;
    if not found or ob.sisa = 0 then
      raise exception 'VALIDASI: Karyawan ini tidak punya kewajiban mengembalikan %. Barang hasil beli tidak perlu dikembalikan.', v_item;
    end if;
    if v_qty > ob.sisa then raise exception 'VALIDASI: Qty % (%) melebihi sisa wajib kembali (%).', v_item, v_qty, ob.sisa; end if;
    v_skucode := coalesce(nullif(upper(trim(r ->> 'sku_code')), ''), ob.sku_code);
    if not exists (select 1 from seragam.sku where sku_code = v_skucode and item_code = v_item) then
      raise exception 'VALIDASI: SKU % bukan item %.', v_skucode, v_item;
    end if;
    v_sumber := ob.sumber; v_pcs := v_pcs + v_qty;
  end loop;
  if v_pcs = 0 then drop table _ob; raise exception 'KOSONG: Isi qty yang dikembalikan minimal untuk satu item.'; end if;
  v_kode := seragam._next_kode('RT', v_tgl, 'return_receipt');
  insert into seragam.return_receipt (kode, tanggal, nik, sumber, catatan, created_by)
  values (v_kode, v_tgl, v_nik, v_sumber, nullif(trim(p ->> 'catatan'), ''), auth.uid())
  returning id into v_id;
  for r in select * from jsonb_array_elements(p -> 'lines') loop
    v_item := upper(trim(r ->> 'item_code')); v_qty := coalesce((r ->> 'qty')::int, 0);
    if v_qty = 0 then continue; end if;
    select * into ob from _ob where item_code = v_item;
    v_skucode := coalesce(nullif(upper(trim(r ->> 'sku_code')), ''), ob.sku_code);
    perform seragam._ledger_insert('RET', v_skucode, v_qty, 'KARANTINA', v_nik,
      'Pengembalian ' || lower(replace(ob.sumber, '_', ' ')), v_kode, v_tgl, p_return => v_id);
  end loop;
  drop table _ob;
  return jsonb_build_object('ok', true, 'id', v_id, 'kode', v_kode, 'pcs', v_pcs);
end $$;

-- ---------- 4. Lot karantina: pengurangan tanpa lot → FIFO ----------
create or replace view seragam.v_karantina_lot with (security_invoker = true) as
with
src as materialized (
  select l.id as lot_id, l.tanggal, l.tx_type, l.sku_code, l.nik, l.return_id, l.exchange_id,
         l.qty + coalesce((select sum(r.qty) from seragam.ledger r where r.reversal_of = l.id), 0) as qty_masuk
  from seragam.ledger l
  where l.stock_status = 'KARANTINA' and l.qty > 0 and l.tx_type in ('RET', 'EXC_IN', 'ADJ', 'OPENING')
),
used as materialized (
  select lot_id, -sum(qty)::int as q from seragam.ledger
  where lot_id is not null and stock_status = 'KARANTINA' group by lot_id
),
-- Pengurangan karantina yang tidak menunjuk lot mana pun (mis. selisih opname negatif)
tanpa_lot as materialized (
  select l.sku_code, -sum(l.qty)::int as q from seragam.ledger l
  where l.stock_status = 'KARANTINA' and l.qty < 0 and l.lot_id is null
    and not (l.tx_type = 'REVERSAL' and exists (select 1 from src where src.lot_id = l.reversal_of))
  group by l.sku_code
),
lot as (
  select s.*, greatest(s.qty_masuk - coalesce(u.q, 0), 0) as sisa_lot,
         sum(greatest(s.qty_masuk - coalesce(u.q, 0), 0)) over (partition by s.sku_code order by s.tanggal, s.lot_id) as kumulatif
  from src s left join used u on u.lot_id = s.lot_id
),
fifo as (
  select l.*, coalesce(u.q, 0) as qty_qc,
         greatest(0, least(l.sisa_lot, l.kumulatif - coalesce(t.q, 0)))::int as sisa
  from lot l left join used u on u.lot_id = l.lot_id left join tanpa_lot t on t.sku_code = l.sku_code
)
select f.lot_id, f.tanggal, f.tx_type, f.sku_code, sk.label as sku_label, sk.item_code, sk.item_sort, sk.gender, sk.size_order,
       f.nik, e.nama,
       case f.tx_type when 'RET' then rr.sumber when 'EXC_IN' then 'TUKAR' else 'OPNAME' end as sumber,
       coalesce(rr.kode, ex.kode) as dokumen,
       not (f.tx_type = 'RET' and rr.sumber in ('BATAL_JOIN', 'NOSHOW')) as bekas_pakai,
       case when (f.tx_type = 'RET' and rr.sumber in ('BATAL_JOIN', 'NOSHOW'))
              or coalesce((seragam.cfg('allow_reissue_grade_a') #>> '{}')::boolean, false) then 'LAYAK'
            else 'CADANGAN' end as tujuan_grade_a,
       f.qty_masuk::int as qty_masuk, f.qty_qc, f.sisa,
       (seragam.today() - f.tanggal) as aging_hari
from fifo f
join seragam.v_sku sk on sk.sku_code = f.sku_code
left join seragam.employee e on e.nik = f.nik
left join seragam.return_receipt rr on rr.id = f.return_id
left join seragam.exchange ex on ex.id = f.exchange_id
where f.sisa > 0;

-- ---------- 7. Koreksi transaksi: pembelian yang semua barisnya dibalik → dibatalkan ----------
create or replace function seragam.fn_ledger_reverse(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare l seragam.ledger; partner seragam.ledger; v_id bigint; v_alasan text := trim(coalesce(p ->> 'alasan', ''));
begin
  perform seragam.require_role('admin');
  select * into l from seragam.ledger where id = (p ->> 'id')::bigint;
  if not found then raise exception 'TIDAK_DITEMUKAN: Transaksi tidak ditemukan.'; end if;
  if l.tx_type = 'REVERSAL' then raise exception 'VALIDASI: Transaksi koreksi tidak bisa dikoreksi lagi. Buat transaksi yang benar.'; end if;
  if exists (select 1 from seragam.ledger where reversal_of = l.id) then
    raise exception 'VALIDASI: Transaksi #% sudah pernah dikoreksi.', l.id;
  end if;
  if length(v_alasan) < 5 then raise exception 'VALIDASI: Alasan koreksi wajib diisi (minimal 5 karakter).'; end if;
  select * into partner from seragam.ledger x
   where (l.pair_id is not null and x.id = l.pair_id) or (x.pair_id = l.id) limit 1;
  if exists (select 1 from seragam.ledger q
              where q.lot_id in (l.id, partner.id) and q.stock_status = 'KARANTINA'
              group by q.lot_id having sum(q.qty) <> 0) then
    raise exception 'STATUS: Sebagian barang dari transaksi ini sudah di-QC. Koreksi hasil QC-nya dulu.';
  end if;
  v_id := seragam._ledger_insert('REVERSAL', l.sku_code, -l.qty, l.stock_status, l.nik, v_alasan, 'REV#' || l.id, current_date,
                                 null, l.affects_stock, l.id, l.tx_type, p_lot => l.lot_id);
  if partner.id is not null and not exists (select 1 from seragam.ledger where reversal_of = partner.id) then
    perform seragam._ledger_insert('REVERSAL', partner.sku_code, -partner.qty, partner.stock_status, partner.nik, v_alasan,
                                   'REV#' || partner.id, current_date, null, partner.affects_stock, partner.id, partner.tx_type,
                                   p_lot => partner.lot_id);
  end if;
  if l.sale_id is not null and not exists (
       select 1 from seragam.ledger x where x.sale_id = l.sale_id and x.tx_type = 'SALE'
          and not exists (select 1 from seragam.ledger r where r.reversal_of = x.id)) then
    update seragam.sale set dibatalkan_at = now(), dibatalkan_by = auth.uid(), alasan_batal = v_alasan
     where id = l.sale_id and dibatalkan_at is null;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'pasangan', partner.id);
end $$;

-- ---------- 6. Upload BAST oleh APA: hanya batch terkirim yang memuat cabangnya ----------
create or replace function seragam.apa_boleh_unggah(p_name text)
returns boolean language sql stable security definer set search_path = seragam, public as $$
  select exists (
    select 1 from seragam.batch_branch bb join seragam.batch b on b.id = bb.batch_id
    where bb.kode_cabang = seragam.apa_cabang() and b.status in ('SHIPPED', 'SELESAI')
      and split_part(p_name, '/', 1) = 'batch-' || bb.batch_id
      and left(split_part(p_name, '/', 2), length(bb.kode_cabang) + 1) = bb.kode_cabang || '-')
$$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists seragam_bast_insert_apa on storage.objects';
    execute $p$create policy seragam_bast_insert_apa on storage.objects for insert to authenticated
             with check (bucket_id = 'seragam-bast' and seragam.apa_boleh_unggah(name))$p$;
  end if;
end $$;

-- ---------- 2b. View: current_date → seragam.today() ----------
do $$
declare v record; d text;
begin
  for v in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'seragam' and c.relkind = 'v' and pg_get_viewdef(c.oid) ilike '%current_date%' loop
    d := regexp_replace(pg_get_viewdef(v.oid), 'CURRENT_DATE', 'seragam.today()', 'gi');
    execute format('create or replace view seragam.%I with (security_invoker = true) as %s', v.relname, d);
  end loop;
end $$;

-- ---------- 1 + 2c. Hak eksekusi fungsi & zona waktu fungsi ----------
-- Panggil di akhir SETIAP migration baru: create or replace mengembalikan EXECUTE ke PUBLIC
-- dan menghapus SET timezone.
create or replace function seragam._apply_hardening()
returns void language plpgsql as $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'seragam' and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    -- authenticated: RPC (fn_*) + helper yang dievaluasi sebagai pemanggil (view, policy RLS & storage)
    if f.proname like 'fn\_%' or f.proname in ('cfg', 'cfg_int', 'cfg_num', 'app_role', 'is_app_user', 'today', 'apa_cabang', 'apa_boleh_unggah') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname <> 'today' then
      execute format('alter function %s set timezone to %L', f.sig, 'Asia/Jakarta');
    end if;
  end loop;
end $$;

grant select on all tables in schema seragam to authenticated;
select seragam._apply_hardening();

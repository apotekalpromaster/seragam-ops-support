-- =====================================================================
-- Migration 4: RPC master, config, paket, mapping, override, user
--
-- Konvensi: setiap RPC menerima satu argumen `p jsonb` dan mengembalikan
-- jsonb. Error diawali KODE: lalu pesan Bahasa Indonesia yang bisa
-- langsung ditampilkan ke pengguna.
-- =====================================================================

-- ---------- Helper ----------
create or replace function seragam.try_date(v text)
returns date language plpgsql immutable as $$
begin
  if v is null or trim(v) = '' then return null; end if;
  return v::date;
exception when others then
  return null;
end $$;

-- Versi paket yang berlaku untuk karyawan dengan tanggal join tertentu.
create or replace function seragam.version_for(p_package text, p_join date)
returns int language sql stable security definer set search_path = seragam, public as $$
  select pv.version_no
  from seragam.package_version pv
  where pv.package_code = p_package
    and (   (pv.scope = 'SEMUA_AKTIF' and pv.effective_date <= current_date)
         or (pv.scope = 'KARYAWAN_BARU' and pv.effective_date <= p_join))
  order by pv.version_no desc
  limit 1
$$;

-- SKU target untuk satu karyawan × item (dipakai di preview dampak).
create or replace function seragam.employee_item_sku(p_nik text, p_item text)
returns table (size_code text, sku_code text, size_status text)
language sql stable security definer set search_path = seragam, public as $$
  with x as (
    select i.item_code, i.gender_specific, e.gender,
           nullif(upper(trim(case i.size_group
             when 'KEMEJA' then e.size_kemeja when 'POLO' then e.size_polo
             when 'BLAZER' then e.size_blazer else e.size_lain ->> i.size_group end)), '') as sz
    from seragam.employee e, seragam.item i
    where e.nik = p_nik and i.item_code = p_item
  )
  select x.sz, s.sku_code,
         case when x.sz is null then 'KOSONG'
              when s.sku_code is null or not exists (select 1 from seragam.item_size isz where isz.item_code = x.item_code and isz.size_code = x.sz)
                then 'TIDAK_TERSEDIA'
              else 'OK' end
  from x
  left join seragam.sku s on s.item_code = x.item_code
                         and s.gender = case when x.gender_specific then x.gender else 'U' end
                         and s.size_code = x.sz and s.active
$$;

-- Hitung dampak perubahan hak untuk sekumpulan karyawan.
-- p_changes: [{nik, items: {ITEM: qty, ...}}] — items = entitlement BARU lengkap.
create or replace function seragam.impact(p_changes jsonb)
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
declare result jsonb;
begin
  with ch as (
    select c ->> 'nik' as nik, c -> 'items' as items
    from jsonb_array_elements(p_changes) c
  ),
  keys as (
    select ch.nik, k.item_code from ch, lateral (
      select jsonb_object_keys(ch.items) as item_code
      union select ei.item_code from seragam.v_employee_item ei where ei.nik = ch.nik
    ) k
  ),
  calc as (
    select k.nik, k.item_code,
           coalesce((ch.items ->> k.item_code)::int, 0) as new_qty,
           coalesce(ei.entitlement, 0) as old_qty,
           coalesce(ei.issued_net, 0) as issued_net
    from keys k
    join ch on ch.nik = k.nik
    left join seragam.v_employee_item ei on ei.nik = k.nik and ei.item_code = k.item_code
  ),
  delta as (
    select c.*, greatest(0, c.new_qty - c.issued_net) - greatest(0, c.old_qty - c.issued_net) as d_out,
           t.sku_code, t.size_status
    from calc c
    left join lateral seragam.employee_item_sku(c.nik, c.item_code) t on true
  )
  select jsonb_build_object(
    'karyawan_terdampak', (select count(distinct nik) from delta where new_qty <> old_qty),
    'karyawan_dicek', (select count(*) from ch),
    'tambahan_outstanding', coalesce((
      select jsonb_agg(x order by x ->> 'label') from (
        select jsonb_build_object(
                 'sku_code', coalesce(d.sku_code, '—'),
                 'label', coalesce(s.label, (select nama from seragam.item where item_code = d.item_code) || ' (ukuran belum valid)'),
                 'qty', sum(d.d_out)) as x
        from delta d left join seragam.v_sku s on s.sku_code = d.sku_code
        where d.d_out <> 0
        group by d.sku_code, s.label, d.item_code
      ) z), '[]'::jsonb),
    'total_tambahan_pcs', coalesce((select sum(d_out) from delta where d_out > 0), 0),
    'total_berkurang_pcs', coalesce((select -sum(d_out) from delta where d_out < 0), 0),
    'karyawan_over_issued', (select count(distinct nik) from delta where issued_net > new_qty),
    'karyawan_tanpa_ukuran_valid', (select count(distinct nik) from delta where d_out > 0 and size_status <> 'OK')
  ) into result;
  return result;
end $$;

create or replace function seragam.write_audit(p_aksi text, p_entitas text, p_id text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = seragam, public as $$
  insert into seragam.audit_log (user_id, user_email, aksi, entitas, entitas_id, before, after)
  values (auth.uid(), (select email from seragam.app_user where user_id = auth.uid()), p_aksi, p_entitas, p_id, p_before, p_after)
$$;

-- ---------- Identitas ----------
create or replace function seragam.fn_me(p jsonb default '{}')
returns jsonb language sql stable security definer set search_path = seragam, public as $$
  select coalesce(
    (select jsonb_build_object('user_id', user_id, 'email', email, 'nama', nama, 'role', role)
       from seragam.app_user where user_id = auth.uid() and aktif),
    jsonb_build_object('user_id', auth.uid(), 'role', null))
$$;

-- ---------- Config ----------
create or replace function seragam.fn_config_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare c seragam.config; v jsonb := p -> 'value';
begin
  perform seragam.require_role('admin');
  select * into c from seragam.config where key = p ->> 'key';
  if not found then raise exception 'TIDAK_DITEMUKAN: Parameter % tidak dikenal.', p ->> 'key'; end if;
  if c.type = 'int' and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)) then
    raise exception 'VALIDASI: % harus bilangan bulat.', c.label;
  elsif c.type = 'number' and jsonb_typeof(v) <> 'number' then
    raise exception 'VALIDASI: % harus angka.', c.label;
  elsif c.type = 'bool' and jsonb_typeof(v) <> 'boolean' then
    raise exception 'VALIDASI: % harus Ya/Tidak.', c.label;
  end if;
  if c.key = 'cutoff_day' and ((v #>> '{}')::int not between 1 and 28) then
    raise exception 'VALIDASI: Tanggal cutoff harus antara 1 dan 28.';
  end if;
  if c.key = 'ship_deadline_day' and ((v #>> '{}')::int not between 1 and 28) then
    raise exception 'VALIDASI: Tanggal deadline kirim harus antara 1 dan 28.';
  end if;
  update seragam.config set value = v, updated_by = auth.uid(), updated_at = now() where key = c.key;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Item & SKU ----------
create or replace function seragam.fn_item_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare
  v_code text := upper(trim(p ->> 'item_code'));
  v_gs boolean := (p ->> 'gender_specific')::boolean;
  v_sizes text[] := array(select upper(trim(x)) from jsonb_array_elements_text(p -> 'sizes') x);
  v_is_new boolean := coalesce((p ->> 'is_new')::boolean, false);
  v_bad text;
  v_created int := 0;
  v_deact int := 0;
begin
  perform seragam.require_role('admin');
  if v_code is null or v_code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' then
    raise exception 'VALIDASI: Kode item hanya huruf kapital, angka, dan tanda hubung (contoh: RMP atau BLZ-APT).';
  end if;
  if coalesce(trim(p ->> 'nama'), '') = '' then raise exception 'VALIDASI: Nama item wajib diisi.'; end if;
  if coalesce(array_length(v_sizes, 1), 0) = 0 then raise exception 'VALIDASI: Pilih minimal satu ukuran.'; end if;
  select s into v_bad from unnest(v_sizes) s where not exists (select 1 from seragam.size z where z.size_code = s) limit 1;
  if v_bad is not null then raise exception 'VALIDASI: Ukuran % tidak dikenal.', v_bad; end if;

  if v_is_new then
    if exists (select 1 from seragam.item where item_code = v_code) then
      raise exception 'DUPLIKAT: Kode item % sudah dipakai.', v_code;
    end if;
    insert into seragam.item (item_code, nama, gender_specific, size_group, active, sort_order)
    values (v_code, trim(p ->> 'nama'), v_gs, upper(coalesce(nullif(trim(p ->> 'size_group'), ''), v_code)),
            coalesce((p ->> 'active')::boolean, true),
            coalesce((p ->> 'sort_order')::int, (select coalesce(max(sort_order), 0) + 10 from seragam.item)));
  else
    update seragam.item set
      nama = trim(p ->> 'nama'),
      gender_specific = v_gs,
      size_group = upper(coalesce(nullif(trim(p ->> 'size_group'), ''), size_group)),
      active = coalesce((p ->> 'active')::boolean, active),
      sort_order = coalesce((p ->> 'sort_order')::int, sort_order)
    where item_code = v_code;
    if not found then raise exception 'TIDAK_DITEMUKAN: Item % tidak ada.', v_code; end if;
  end if;

  delete from seragam.item_size where item_code = v_code and size_code <> all (v_sizes);
  insert into seragam.item_size (item_code, size_code)
  select v_code, s from unnest(v_sizes) s on conflict do nothing;

  -- Generate SKU: item × gender × ukuran. SKU yang tidak lagi valid dinonaktifkan (tidak dihapus,
  -- karena bisa sudah punya histori ledger).
  with g as (
    select unnest(case when v_gs then array['P', 'W'] else array['U'] end) as gender
  ), target as (
    select v_code || '-' || g.gender || '-' || s as sku_code, g.gender, s as size_code from g, unnest(v_sizes) s
  ), ins as (
    insert into seragam.sku (sku_code, item_code, gender, size_code)
    select t.sku_code, v_code, t.gender, t.size_code from target t
    on conflict (sku_code) do update set active = true where seragam.sku.active = false
    returning 1
  )
  select count(*) into v_created from ins;

  update seragam.sku set active = false
  where item_code = v_code and active
    and sku_code not in (
      select v_code || '-' || g || '-' || s
      from unnest(case when v_gs then array['P', 'W'] else array['U'] end) g, unnest(v_sizes) s);
  get diagnostics v_deact = row_count;

  return jsonb_build_object('ok', true, 'item_code', v_code, 'sku_aktif_baru', v_created, 'sku_dinonaktifkan', v_deact);
end $$;

create or replace function seragam.fn_sku_update(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
begin
  perform seragam.require_role('admin');
  update seragam.sku set
    vendor_id = case when p ? 'vendor_id' then (p ->> 'vendor_id')::bigint else vendor_id end,
    lead_time_days = case when p ? 'lead_time_days' then (p ->> 'lead_time_days')::int else lead_time_days end,
    moq = coalesce((p ->> 'moq')::int, moq),
    active = coalesce((p ->> 'active')::boolean, active)
  where sku_code = p ->> 'sku_code';
  if not found then raise exception 'TIDAK_DITEMUKAN: SKU % tidak ada.', p ->> 'sku_code'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Bulk: {rows: [{sku_code, price, valid_from, vendor, lead_time_days, moq}]}
-- vendor (nama) opsional; dibuat otomatis bila belum ada.
create or replace function seragam.fn_sku_bulk_update(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare r jsonb; n int := 0; errs jsonb := '[]'; i int := 0; v_vendor bigint;
begin
  perform seragam.require_role('admin');
  for r in select * from jsonb_array_elements(p -> 'rows') loop
    i := i + 1;
    if not exists (select 1 from seragam.sku where sku_code = upper(trim(r ->> 'sku_code'))) then
      errs := errs || jsonb_build_object('baris', i, 'pesan', 'SKU ' || coalesce(r ->> 'sku_code', '(kosong)') || ' tidak dikenal');
    elsif r ? 'price' and (r ->> 'price') is not null and (r ->> 'price') !~ '^\d+(\.\d+)?$' then
      errs := errs || jsonb_build_object('baris', i, 'pesan', 'Harga harus angka tanpa titik ribuan');
    end if;
  end loop;
  if jsonb_array_length(errs) > 0 then
    return jsonb_build_object('ok', false, 'errors', errs);
  end if;

  for r in select * from jsonb_array_elements(p -> 'rows') loop
    v_vendor := null;
    if coalesce(trim(r ->> 'vendor'), '') <> '' then
      insert into seragam.vendor (nama) values (trim(r ->> 'vendor')) on conflict (nama) do nothing;
      select id into v_vendor from seragam.vendor where nama = trim(r ->> 'vendor');
    end if;
    update seragam.sku set
      vendor_id = coalesce(v_vendor, vendor_id),
      lead_time_days = coalesce((r ->> 'lead_time_days')::int, lead_time_days),
      moq = coalesce((r ->> 'moq')::int, moq)
    where sku_code = upper(trim(r ->> 'sku_code'));
    if (r ->> 'price') is not null then
      insert into seragam.sku_price (sku_code, price, valid_from, created_by)
      values (upper(trim(r ->> 'sku_code')), (r ->> 'price')::numeric,
              coalesce(seragam.try_date(r ->> 'valid_from'), current_date), auth.uid())
      on conflict (sku_code, valid_from) do update set price = excluded.price;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'jumlah', n);
end $$;

create or replace function seragam.fn_vendor_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint;
begin
  perform seragam.require_role('admin');
  if coalesce(trim(p ->> 'nama'), '') = '' then raise exception 'VALIDASI: Nama vendor wajib diisi.'; end if;
  if (p ->> 'id') is null then
    insert into seragam.vendor (nama, kontak, lead_time_default, active)
    values (trim(p ->> 'nama'), p ->> 'kontak', coalesce((p ->> 'lead_time_default')::int, 30), coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update seragam.vendor set nama = trim(p ->> 'nama'), kontak = p ->> 'kontak',
      lead_time_default = coalesce((p ->> 'lead_time_default')::int, lead_time_default),
      active = coalesce((p ->> 'active')::boolean, active)
    where id = (p ->> 'id')::bigint returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  raise exception 'DUPLIKAT: Vendor dengan nama itu sudah ada.';
end $$;

-- ---------- Cabang ----------
-- {rows: [{kode_cabang, nama, area, alamat, is_new_opening, go_date, active}]}
create or replace function seragam.fn_branch_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare r jsonb; n int := 0; i int := 0; errs jsonb := '[]';
begin
  perform seragam.require_role('admin');
  for r in select * from jsonb_array_elements(p -> 'rows') loop
    i := i + 1;
    if coalesce(trim(r ->> 'kode_cabang'), '') = '' or coalesce(trim(r ->> 'nama'), '') = '' then
      errs := errs || jsonb_build_object('baris', i, 'pesan', 'Kode cabang dan nama cabang wajib diisi');
    end if;
  end loop;
  if jsonb_array_length(errs) > 0 then return jsonb_build_object('ok', false, 'errors', errs); end if;

  for r in select * from jsonb_array_elements(p -> 'rows') loop
    insert into seragam.branch (kode_cabang, nama, area, alamat, is_new_opening, go_date, active)
    values (upper(trim(r ->> 'kode_cabang')), trim(r ->> 'nama'), nullif(trim(r ->> 'area'), ''), r ->> 'alamat',
            coalesce((r ->> 'is_new_opening')::boolean, false), seragam.try_date(r ->> 'go_date'),
            coalesce((r ->> 'active')::boolean, true))
    on conflict (kode_cabang) do update set
      nama = excluded.nama, area = excluded.area, alamat = coalesce(excluded.alamat, seragam.branch.alamat),
      is_new_opening = excluded.is_new_opening, go_date = excluded.go_date, active = excluded.active;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'jumlah', n);
end $$;

-- ---------- Size curve & size chart ----------
create or replace function seragam.fn_size_curve_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare bad record;
begin
  perform seragam.require_role('admin');
  delete from seragam.size_curve where item_code = p ->> 'item_code' and gender = p ->> 'gender';
  insert into seragam.size_curve (item_code, gender, size_code, proporsi)
  select p ->> 'item_code', p ->> 'gender', r ->> 'size_code', (r ->> 'proporsi')::numeric
  from jsonb_array_elements(p -> 'rows') r where (r ->> 'proporsi')::numeric > 0;
  select sum(proporsi) as total into bad from seragam.size_curve
   where item_code = p ->> 'item_code' and gender = p ->> 'gender';
  if bad.total is not null and abs(bad.total - 1) > 0.01 then
    raise exception 'VALIDASI: Total proporsi harus 100 persen (sekarang % persen).', round(bad.total * 100, 1);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function seragam.fn_size_chart_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare r jsonb; n int := 0;
begin
  perform seragam.require_role('admin');
  for r in select * from jsonb_array_elements(p -> 'rows') loop
    if coalesce(trim(r ->> 'keterangan'), '') = '' then
      delete from seragam.size_chart where item_code = upper(r ->> 'item_code') and gender = upper(r ->> 'gender') and size_code = upper(r ->> 'size_code');
    else
      insert into seragam.size_chart (item_code, gender, size_code, keterangan)
      values (upper(r ->> 'item_code'), upper(r ->> 'gender'), upper(r ->> 'size_code'), trim(r ->> 'keterangan'))
      on conflict (item_code, gender, size_code) do update set keterangan = excluded.keterangan;
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'jumlah', n);
end $$;

-- ---------- Paket ----------
create or replace function seragam._validate_items(p_items jsonb)
returns void language plpgsql stable security definer set search_path = seragam, public as $$
declare k text; v jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'object' then
    raise exception 'VALIDASI: Isi qty per item.';
  end if;
  for k, v in select * from jsonb_each(p_items) loop
    if not exists (select 1 from seragam.item where item_code = k) then
      raise exception 'VALIDASI: Item % tidak dikenal.', k;
    end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
      raise exception 'VALIDASI: Qty % harus bilangan bulat 0 atau lebih.', k;
    end if;
  end loop;
end $$;

create or replace function seragam.fn_package_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_code text := upper(trim(p ->> 'package_code'));
begin
  perform seragam.require_role('admin');
  if v_code is null or v_code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' then
    raise exception 'VALIDASI: Kode paket hanya huruf kapital, angka, dan tanda hubung (contoh: GA-C).';
  end if;
  if coalesce(trim(p ->> 'nama'), '') = '' then raise exception 'VALIDASI: Nama paket wajib diisi.'; end if;
  if exists (select 1 from seragam.package where package_code = v_code) then
    raise exception 'DUPLIKAT: Kode paket % sudah dipakai. Pilih kode lain.', v_code;
  end if;
  perform seragam._validate_items(p -> 'items');
  insert into seragam.package (package_code, nama, deskripsi, created_by)
  values (v_code, trim(p ->> 'nama'), nullif(trim(p ->> 'deskripsi'), ''), auth.uid());
  insert into seragam.package_version (package_code, version_no, effective_date, scope, catatan, created_by)
  values (v_code, 1, coalesce(seragam.try_date(p ->> 'effective_date'), current_date), 'SEMUA_AKTIF', 'Versi awal', auth.uid());
  insert into seragam.package_item (package_code, version_no, item_code, qty)
  select v_code, 1, k, (v #>> '{}')::int from jsonb_each(p -> 'items') as t(k, v);
  return jsonb_build_object('ok', true, 'package_code', v_code);
end $$;

create or replace function seragam.fn_package_update_info(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
begin
  perform seragam.require_role('admin');
  if coalesce(trim(p ->> 'nama'), '') = '' then raise exception 'VALIDASI: Nama paket wajib diisi.'; end if;
  update seragam.package set nama = trim(p ->> 'nama'), deskripsi = nullif(trim(p ->> 'deskripsi'), '')
  where package_code = p ->> 'package_code';
  if not found then raise exception 'TIDAK_DITEMUKAN: Paket tidak ada.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Karyawan yang terkena versi baru sebuah paket, beserta hak barunya.
create or replace function seragam._package_version_changes(p_code text, p_items jsonb, p_scope text, p_eff date)
returns jsonb language sql stable security definer set search_path = seragam, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('nik', ep.nik, 'items', p_items)), '[]'::jsonb)
  from seragam.v_employee_package ep
  join seragam.employee e on e.nik = ep.nik
  where ep.package_code = p_code
    and e.status in ('AKTIF', 'OFFERING')
    and (p_scope = 'SEMUA_AKTIF' or coalesce(e.planned_join_date, e.join_date) >= p_eff)
$$;

create or replace function seragam.fn_package_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
declare v_scope text := coalesce(p ->> 'scope', 'SEMUA_AKTIF');
begin
  perform seragam.require_role('admin');
  perform seragam._validate_items(p -> 'items');
  return seragam.impact(seragam._package_version_changes(
    p ->> 'package_code', p -> 'items', v_scope, coalesce(seragam.try_date(p ->> 'effective_date'), current_date)));
end $$;

create or replace function seragam.fn_package_new_version(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare
  v_code text := p ->> 'package_code';
  v_scope text := coalesce(p ->> 'scope', 'SEMUA_AKTIF');
  v_eff date := coalesce(seragam.try_date(p ->> 'effective_date'), current_date);
  v_no int;
  v_impact jsonb;
begin
  perform seragam.require_role('admin');
  if v_scope not in ('SEMUA_AKTIF', 'KARYAWAN_BARU') then raise exception 'VALIDASI: Pilih cakupan perubahan.'; end if;
  perform seragam._validate_items(p -> 'items');
  if not exists (select 1 from seragam.package where package_code = v_code) then
    raise exception 'TIDAK_DITEMUKAN: Paket % tidak ada.', v_code;
  end if;
  -- Tidak membuat versi baru bila qty sama persis dengan versi terakhir.
  if (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(p -> 'items') t(k, v) where (v #>> '{}')::int > 0)
     = (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each((select items from seragam.v_package where package_code = v_code)) t(k, v) where (v #>> '{}')::int > 0)
  then
    raise exception 'TIDAK_BERUBAH: Qty sama dengan versi terakhir, tidak ada versi baru yang dibuat.';
  end if;
  v_impact := seragam.impact(seragam._package_version_changes(v_code, p -> 'items', v_scope, v_eff));
  select coalesce(max(version_no), 0) + 1 into v_no from seragam.package_version where package_code = v_code;
  insert into seragam.package_version (package_code, version_no, effective_date, scope, catatan, created_by)
  values (v_code, v_no, v_eff, v_scope, nullif(trim(p ->> 'catatan'), ''), auth.uid());
  insert into seragam.package_item (package_code, version_no, item_code, qty)
  select v_code, v_no, k, (v #>> '{}')::int from jsonb_each(p -> 'items') as t(k, v);
  return jsonb_build_object('ok', true, 'version_no', v_no, 'dampak', v_impact);
end $$;

create or replace function seragam.fn_package_set_active(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_code text := p ->> 'package_code'; v_active boolean := (p ->> 'active')::boolean; n_jab int; n_ovr int;
begin
  perform seragam.require_role('admin');
  if not v_active then
    select count(*) into n_jab from seragam.position_map where package_code = v_code;
    select count(*) into n_ovr from seragam.employee_package_override o join seragam.employee e on e.nik = o.nik
     where o.package_code = v_code and e.status in ('AKTIF', 'OFFERING');
    if n_jab > 0 or n_ovr > 0 then
      raise exception 'PAKET_DIPAKAI: Paket masih dipakai % jabatan dan % override karyawan aktif. Pindahkan dulu ke paket lain di menu Mapping Jabatan / Override.', n_jab, n_ovr;
    end if;
  end if;
  update seragam.package set active = v_active where package_code = v_code;
  return jsonb_build_object('ok', true);
end $$;

create or replace function seragam.fn_package_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_code text := p ->> 'package_code';
begin
  perform seragam.require_role('admin');
  if exists (select 1 from seragam.position_map where package_code = v_code)
     or exists (select 1 from seragam.employee_package_override where package_code = v_code)
     or exists (select 1 from seragam.audit_log where entitas in ('position_map', 'employee_package_override')
                  and (after ->> 'package_code' = v_code or before ->> 'package_code' = v_code)) then
    raise exception 'PAKET_DIPAKAI: Paket ini pernah/masih dipakai sehingga tidak bisa dihapus. Nonaktifkan saja setelah semua jabatannya dipindah.';
  end if;
  delete from seragam.package where package_code = v_code;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Mapping jabatan ----------
create or replace function seragam._mapping_changes(p_jabatan text[], p_package text)
returns jsonb language sql stable security definer set search_path = seragam, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'nik', e.nik,
    'items', case when p_package is null then '{}'::jsonb else coalesce((
      select jsonb_object_agg(pi.item_code, pi.qty) from seragam.package_item pi
      where pi.package_code = p_package
        and pi.version_no = seragam.version_for(p_package, coalesce(e.planned_join_date, e.join_date))
    ), '{}'::jsonb) end)), '[]'::jsonb)
  from seragam.employee e
  where e.jabatan = any (p_jabatan)
    and e.status in ('AKTIF', 'OFFERING')
    and not exists (select 1 from seragam.employee_package_override o where o.nik = e.nik)
$$;

create or replace function seragam.fn_mapping_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = seragam, public as $$
begin
  perform seragam.require_role('admin');
  return seragam.impact(seragam._mapping_changes(
    array(select jsonb_array_elements_text(p -> 'jabatan')), nullif(p ->> 'package_code', '')));
end $$;

-- {jabatan: [..], package_code} — package_code null = hapus mapping.
create or replace function seragam.fn_mapping_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_pkg text := nullif(p ->> 'package_code', ''); v_jab text[]; v_impact jsonb;
begin
  perform seragam.require_role('admin');
  v_jab := array(select trim(x) from jsonb_array_elements_text(p -> 'jabatan') x where trim(x) <> '');
  if coalesce(array_length(v_jab, 1), 0) = 0 then raise exception 'VALIDASI: Pilih minimal satu jabatan.'; end if;
  if v_pkg is not null and not exists (select 1 from seragam.package where package_code = v_pkg and active) then
    raise exception 'VALIDASI: Paket % tidak ada atau tidak aktif.', v_pkg;
  end if;
  v_impact := seragam.impact(seragam._mapping_changes(v_jab, v_pkg));
  if v_pkg is null then
    delete from seragam.position_map where jabatan = any (v_jab);
  else
    insert into seragam.position_map (jabatan, package_code, updated_by, updated_at)
    select j, v_pkg, auth.uid(), now() from unnest(v_jab) j
    on conflict (jabatan) do update set package_code = excluded.package_code, updated_by = excluded.updated_by, updated_at = now()
    where seragam.position_map.package_code is distinct from excluded.package_code;
  end if;
  return jsonb_build_object('ok', true, 'jumlah', array_length(v_jab, 1), 'dampak', v_impact);
end $$;

-- {rows: [{jabatan, package_code}]} dari template mapping
create or replace function seragam.fn_mapping_bulk(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare r jsonb; i int := 0; errs jsonb := '[]'; n int := 0;
begin
  perform seragam.require_role('admin');
  for r in select * from jsonb_array_elements(p -> 'rows') loop
    i := i + 1;
    if coalesce(trim(r ->> 'jabatan'), '') = '' then
      errs := errs || jsonb_build_object('baris', i, 'pesan', 'Jabatan kosong');
    elsif not exists (select 1 from seragam.package where package_code = upper(trim(r ->> 'package_code')) and active) then
      errs := errs || jsonb_build_object('baris', i, 'pesan', 'Paket ' || coalesce(r ->> 'package_code', '(kosong)') || ' tidak ada atau tidak aktif');
    end if;
  end loop;
  if jsonb_array_length(errs) > 0 then return jsonb_build_object('ok', false, 'errors', errs); end if;
  for r in select * from jsonb_array_elements(p -> 'rows') loop
    insert into seragam.position_map (jabatan, package_code, updated_by)
    values (trim(r ->> 'jabatan'), upper(trim(r ->> 'package_code')), auth.uid())
    on conflict (jabatan) do update set package_code = excluded.package_code, updated_by = excluded.updated_by, updated_at = now()
    where seragam.position_map.package_code is distinct from excluded.package_code;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'jumlah', n);
end $$;

-- ---------- Override per karyawan ----------
create or replace function seragam.fn_override_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_nik text := trim(p ->> 'nik'); v_pkg text := p ->> 'package_code';
begin
  perform seragam.require_role('admin');
  if not exists (select 1 from seragam.employee where nik = v_nik) then
    raise exception 'TIDAK_DITEMUKAN: Karyawan dengan NIK % tidak ada.', v_nik;
  end if;
  if not exists (select 1 from seragam.package where package_code = v_pkg and active) then
    raise exception 'VALIDASI: Pilih paket yang aktif.';
  end if;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 5 then
    raise exception 'VALIDASI: Alasan override wajib diisi (minimal 5 karakter).';
  end if;
  insert into seragam.employee_package_override (nik, package_code, alasan, created_by)
  values (v_nik, v_pkg, trim(p ->> 'alasan'), auth.uid())
  on conflict (nik) do update set package_code = excluded.package_code, alasan = excluded.alasan,
    created_by = excluded.created_by, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function seragam.fn_override_remove(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
begin
  perform seragam.require_role('admin');
  delete from seragam.employee_package_override where nik = p ->> 'nik';
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Ukuran karyawan (koreksi manual) ----------
create or replace function seragam.fn_employee_set_size(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare before_row jsonb; after_row jsonb; v_nik text := p ->> 'nik'; k text;
begin
  perform seragam.require_role('admin', 'staf');
  select jsonb_build_object('size_kemeja', size_kemeja, 'size_polo', size_polo, 'size_blazer', size_blazer, 'size_lain', size_lain)
    into before_row from seragam.employee where nik = v_nik;
  if before_row is null then raise exception 'TIDAK_DITEMUKAN: Karyawan tidak ada.'; end if;
  foreach k in array array['size_kemeja', 'size_polo', 'size_blazer'] loop
    if p ? k and nullif(upper(trim(p ->> k)), '') is not null
       and not exists (select 1 from seragam.size where size_code = upper(trim(p ->> k))) then
      raise exception 'VALIDASI: Ukuran % tidak dikenal.', p ->> k;
    end if;
  end loop;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 3 then
    raise exception 'VALIDASI: Tulis alasan perubahan ukuran (mis. "konfirmasi ulang ke karyawan").';
  end if;
  update seragam.employee set
    size_kemeja = case when p ? 'size_kemeja' then nullif(upper(trim(p ->> 'size_kemeja')), '') else size_kemeja end,
    size_polo   = case when p ? 'size_polo'   then nullif(upper(trim(p ->> 'size_polo')), '')   else size_polo end,
    size_blazer = case when p ? 'size_blazer' then nullif(upper(trim(p ->> 'size_blazer')), '') else size_blazer end,
    size_lain   = case when p ? 'size_lain'   then p -> 'size_lain' else size_lain end,
    updated_at = now()
  where nik = v_nik;
  select jsonb_build_object('size_kemeja', size_kemeja, 'size_polo', size_polo, 'size_blazer', size_blazer, 'size_lain', size_lain, 'alasan', p ->> 'alasan')
    into after_row from seragam.employee where nik = v_nik;
  perform seragam.write_audit('UBAH_UKURAN', 'employee', v_nik, before_row, after_row);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- User aplikasi ----------
create or replace function seragam.fn_user_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public, auth as $$
declare v_uid uuid; v_email text := lower(trim(p ->> 'email')); v_role text := p ->> 'role'; v_aktif boolean := coalesce((p ->> 'aktif')::boolean, true);
begin
  perform seragam.require_role('admin');
  if v_role not in ('admin', 'staf', 'viewer', 'apa') then raise exception 'VALIDASI: Role tidak dikenal.'; end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    raise exception 'USER_TIDAK_ADA: Email % belum punya akun login. Buat dulu di Supabase → Authentication → Add user, lalu ulangi.', v_email;
  end if;
  if v_uid = auth.uid() and (v_role <> 'admin' or not v_aktif) then
    raise exception 'VALIDASI: Anda tidak bisa menurunkan role atau menonaktifkan akun sendiri.';
  end if;
  insert into seragam.app_user (user_id, email, nama, role, aktif)
  values (v_uid, v_email, coalesce(nullif(trim(p ->> 'nama'), ''), v_email), v_role, v_aktif)
  on conflict (user_id) do update set nama = excluded.nama, role = excluded.role, aktif = excluded.aktif, email = excluded.email;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Import column map ----------
create or replace function seragam.fn_column_map_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare k text; v text;
begin
  perform seragam.require_role('admin');
  for k, v in select * from jsonb_each_text(p -> 'map') loop
    if coalesce(v, '') = '' then
      delete from seragam.import_column_map where field = k;
    else
      insert into seragam.import_column_map (field, source_column) values (k, v)
      on conflict (field) do update set source_column = excluded.source_column, updated_at = now();
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

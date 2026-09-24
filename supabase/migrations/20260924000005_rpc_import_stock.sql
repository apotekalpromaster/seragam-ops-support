-- =====================================================================
-- Migration 5: RPC import PPM, ledger, stock opname, migrasi historis
-- =====================================================================

-- ---------- Normalisasi nilai dari file PPM ----------
create or replace function seragam.norm_size(v text)
returns text language sql immutable as $$
  select case u
    when '' then null
    when 'XXXL' then '3XL' when '2XL' then 'XXL' when 'XXXXL' then '4XL' when 'XXXXXL' then '5XL'
    else u end
  from (select upper(regexp_replace(coalesce(v, ''), '\s', '', 'g')) as u) x
$$;

-- p_l_means_male: true bila file memakai kode L/P (Laki-laki/Perempuan),
-- sehingga "P" berarti Perempuan.
create or replace function seragam.norm_gender(v text, p_lp_style boolean)
returns text language sql immutable as $$
  select case
    when u in ('PRIA', 'LAKI-LAKI', 'LAKILAKI', 'LAKI', 'L', 'M', 'MALE') then 'P'
    when u in ('WANITA', 'PEREMPUAN', 'W', 'F', 'FEMALE') then 'W'
    when u = 'P' then case when p_lp_style then 'W' else 'P' end
    else null end
  from (select upper(regexp_replace(coalesce(v, ''), '[\s_]', '', 'g')) as u) x
$$;

create or replace function seragam.norm_status(v text)
returns seragam.employee_status language sql immutable as $$
  select case
    when u in ('AKTIF', 'ACTIVE', 'AKTIVE') then 'AKTIF'::seragam.employee_status
    when u in ('OFFERING', 'OFFER', 'JOINER', 'CALON', 'CALONKARYAWAN', 'AKANJOIN') then 'OFFERING'
    when u in ('RESIGN', 'RESIGNED', 'KELUAR', 'NONAKTIF', 'TIDAKAKTIF') then 'RESIGN'
    when u in ('BATALJOIN', 'BATAL', 'NOSHOW', 'CANCEL', 'CANCELLED') then 'BATAL_JOIN'
    else null end
  from (select upper(regexp_replace(coalesce(v, ''), '[\s_-]', '', 'g')) as u) x
$$;

-- ---------- Evaluasi staging: validasi + diff ----------
-- Dipanggil saat preview dan diulang saat commit, supaya diff selalu
-- dihitung terhadap data karyawan terbaru.
create or replace function seragam._import_evaluate(p_import_id bigint)
returns void language plpgsql security definer set search_path = seragam, public as $$
declare
  r record;
  d jsonb;
  e seragam.employee;
  errs jsonb; warns jsonb; diffs seragam.diff_type[]; detail jsonb;
  v_lp boolean;
  v_gender text; v_status seragam.employee_status; v_pkg text; v_ver int; v_join date;
  it record; v_sz text;
  n_err int; n_warn int;
  v_dups text[];
begin
  select coalesce(array_agg(nik), '{}') into v_dups from (
    select nik from seragam.import_staging where import_id = p_import_id and nik is not null
    group by nik having count(*) > 1) x;

  -- Deteksi gaya kode gender: jika ada nilai "L", maka "P" = Perempuan.
  select exists (
    select 1 from seragam.import_staging s
    where s.import_id = p_import_id and upper(trim(s.data ->> 'gender_raw')) = 'L'
  ) into v_lp;

  for r in select * from seragam.import_staging where import_id = p_import_id order by row_no loop
    d := r.data;
    errs := '[]'; warns := '[]'; diffs := '{}'; detail := '[]';

    -- Validasi yang membuat baris dilewati
    if coalesce(d ->> 'nik', '') = '' then
      errs := errs || jsonb_build_object('field', 'nik', 'message', 'NIK kosong.');
    elsif r.nik = any (v_dups) then
      errs := errs || jsonb_build_object('field', 'nik', 'message',
        'NIK ' || r.nik || ' muncul lebih dari sekali di file (baris ' ||
        (select string_agg(s2.row_no::text, ', ' order by s2.row_no) from seragam.import_staging s2
          where s2.import_id = p_import_id and s2.nik = r.nik) || '). Hapus baris duplikat di file.');
    end if;
    if coalesce(d ->> 'nama', '') = '' then
      errs := errs || jsonb_build_object('field', 'nama', 'message', 'Nama kosong.');
    end if;
    v_gender := seragam.norm_gender(d ->> 'gender_raw', v_lp);
    if v_gender is null then
      errs := errs || jsonb_build_object('field', 'gender', 'message',
        case when coalesce(d ->> 'gender_raw', '') = '' then 'Gender kosong.'
             else 'Gender "' || (d ->> 'gender_raw') || '" tidak dikenal. Gunakan Pria/Wanita atau L/P.' end);
    end if;
    v_status := seragam.norm_status(d ->> 'status_raw');
    if v_status is null then
      errs := errs || jsonb_build_object('field', 'status', 'message',
        'Status "' || coalesce(d ->> 'status_raw', '') || '" tidak dikenal. Gunakan AKTIF, OFFERING, RESIGN, atau BATAL_JOIN.');
    end if;
    if coalesce(d ->> 'jabatan', '') = '' then
      errs := errs || jsonb_build_object('field', 'jabatan', 'message', 'Jabatan kosong.');
    end if;
    if coalesce(d ->> 'kode_cabang', '') = '' then
      errs := errs || jsonb_build_object('field', 'kode_cabang', 'message', 'Kode cabang kosong.');
    elsif not exists (select 1 from seragam.branch b where b.kode_cabang = d ->> 'kode_cabang') then
      errs := errs || jsonb_build_object('field', 'kode_cabang', 'message',
        'Cabang "' || (d ->> 'kode_cabang') || '" belum terdaftar. Tambahkan di Master → Cabang lalu ulangi import.');
    end if;
    -- Tanggal tidak valid → peringatan, nilai diabaikan
    if coalesce(d ->> 'planned_join_date_raw', '') <> '' and seragam.try_date(d ->> 'planned_join_date_raw') is null then
      warns := warns || jsonb_build_object('field', 'planned_join_date', 'message', 'Tanggal rencana join tidak terbaca: ' || (d ->> 'planned_join_date_raw'));
    end if;
    if coalesce(d ->> 'join_date_raw', '') <> '' and seragam.try_date(d ->> 'join_date_raw') is null then
      warns := warns || jsonb_build_object('field', 'join_date', 'message', 'Tanggal join tidak terbaca: ' || (d ->> 'join_date_raw'));
    end if;
    if coalesce(d ->> 'resign_date_raw', '') <> '' and seragam.try_date(d ->> 'resign_date_raw') is null then
      warns := warns || jsonb_build_object('field', 'resign_date', 'message', 'Tanggal resign tidak terbaca: ' || (d ->> 'resign_date_raw'));
    end if;
    if v_status = 'OFFERING' and seragam.try_date(d ->> 'planned_join_date_raw') is null then
      warns := warns || jsonb_build_object('field', 'planned_join_date', 'message', 'Joiner (OFFERING) tanpa tanggal rencana join.');
    end if;

    select * into e from seragam.employee where nik = r.nik;

    if jsonb_array_length(errs) = 0 then
      -- Peringatan hak seragam: jabatan belum dimapping, ukuran kosong / tidak tersedia
      v_pkg := coalesce(
        (select o.package_code from seragam.employee_package_override o where o.nik = r.nik),
        (select pm.package_code from seragam.position_map pm where pm.jabatan = d ->> 'jabatan'));
      if v_status in ('AKTIF', 'OFFERING') then
        if v_pkg is null then
          warns := warns || jsonb_build_object('field', 'jabatan', 'message',
            'Jabatan "' || (d ->> 'jabatan') || '" belum dimapping ke paket. Karyawan tidak masuk antrian sampai dimapping.');
        else
          v_join := coalesce(seragam.try_date(d ->> 'planned_join_date_raw'), seragam.try_date(d ->> 'join_date_raw'),
                             e.planned_join_date, e.join_date);
          v_ver := seragam.version_for(v_pkg, v_join);
          for it in
            select i.item_code, i.nama, i.size_group, i.gender_specific
            from seragam.package_item pi join seragam.item i on i.item_code = pi.item_code and i.active
            where pi.package_code = v_pkg and pi.version_no = v_ver and pi.qty > 0
          loop
            v_sz := case it.size_group
              when 'KEMEJA' then coalesce(seragam.norm_size(d ->> 'size_kemeja'), e.size_kemeja)
              when 'POLO' then coalesce(seragam.norm_size(d ->> 'size_polo'), e.size_polo)
              when 'BLAZER' then coalesce(seragam.norm_size(d ->> 'size_blazer'), e.size_blazer)
              else e.size_lain ->> it.size_group end;
            if v_sz is null then
              warns := warns || jsonb_build_object('field', 'size_' || lower(it.size_group), 'kode', 'UKURAN_KOSONG',
                'message', 'Ukuran ' || lower(it.nama) || ' kosong. Masuk daftar Menunggu Ukuran.');
            elsif not exists (select 1 from seragam.item_size isz where isz.item_code = it.item_code and isz.size_code = v_sz) then
              warns := warns || jsonb_build_object('field', 'size_' || lower(it.size_group), 'kode', 'UKURAN_TIDAK_TERSEDIA',
                'message', 'Ukuran ' || v_sz || ' tidak tersedia untuk ' || it.nama || ' (tersedia: ' ||
                (select string_agg(isz.size_code, ', ' order by sz.size_order) from seragam.item_size isz
                   join seragam.size sz on sz.size_code = isz.size_code where isz.item_code = it.item_code) ||
                '). Masuk daftar Ukuran Tidak Tersedia.');
            end if;
          end loop;
        end if;
      end if;

      -- Diff terhadap data sebelumnya
      if e.nik is null then
        diffs := diffs || case when v_status = 'OFFERING' then 'NEW_OFFERING'::seragam.diff_type else 'NEW_AKTIF'::seragam.diff_type end;
        detail := detail || jsonb_build_object('type', diffs[1], 'old', null, 'new', v_status::text);
        if v_status = 'RESIGN' then
          diffs := diffs || 'RESIGN'::seragam.diff_type;
          detail := detail || jsonb_build_object('type', 'RESIGN', 'old', null, 'new', d ->> 'resign_date_raw');
        end if;
      else
        if e.status is distinct from v_status then
          if e.status = 'OFFERING' and v_status = 'AKTIF' then
            diffs := diffs || 'JOINED'::seragam.diff_type;
            detail := detail || jsonb_build_object('type', 'JOINED', 'old', e.status::text, 'new', v_status::text);
          elsif v_status = 'BATAL_JOIN' then
            diffs := diffs || 'BATAL_JOIN'::seragam.diff_type;
            detail := detail || jsonb_build_object('type', 'BATAL_JOIN', 'old', e.status::text, 'new', v_status::text);
          elsif v_status = 'RESIGN' then
            diffs := diffs || 'RESIGN'::seragam.diff_type;
            detail := detail || jsonb_build_object('type', 'RESIGN', 'old', e.status::text,
              'new', coalesce(d ->> 'resign_date_raw', v_status::text));
          else
            -- perubahan status lain (mis. RESIGN → AKTIF: rehire)
            diffs := diffs || 'NEW_AKTIF'::seragam.diff_type;
            detail := detail || jsonb_build_object('type', 'NEW_AKTIF', 'old', e.status::text, 'new', v_status::text);
          end if;
        end if;
        if seragam.try_date(d ->> 'planned_join_date_raw') is not null
           and e.planned_join_date is distinct from seragam.try_date(d ->> 'planned_join_date_raw')
           and e.planned_join_date is not null then
          diffs := diffs || 'JOIN_DATE_CHANGE'::seragam.diff_type;
          detail := detail || jsonb_build_object('type', 'JOIN_DATE_CHANGE', 'old', e.planned_join_date::text,
            'new', seragam.try_date(d ->> 'planned_join_date_raw')::text);
        end if;
        if v_status <> 'RESIGN' and e.planned_resign_date is null
           and seragam.try_date(d ->> 'planned_resign_date_raw') is not null then
          diffs := diffs || 'RENCANA_RESIGN'::seragam.diff_type;
          detail := detail || jsonb_build_object('type', 'RENCANA_RESIGN', 'old', null,
            'new', seragam.try_date(d ->> 'planned_resign_date_raw')::text);
        end if;
        if e.jabatan is distinct from d ->> 'jabatan' then
          diffs := diffs || 'MUTASI_JABATAN'::seragam.diff_type;
          detail := detail || jsonb_build_object('type', 'MUTASI_JABATAN', 'old', e.jabatan, 'new', d ->> 'jabatan');
        end if;
        if e.kode_cabang is distinct from d ->> 'kode_cabang' then
          diffs := diffs || 'PINDAH_CABANG'::seragam.diff_type;
          detail := detail || jsonb_build_object('type', 'PINDAH_CABANG', 'old', e.kode_cabang, 'new', d ->> 'kode_cabang');
        end if;
        if (seragam.norm_size(d ->> 'size_kemeja') is not null and seragam.norm_size(d ->> 'size_kemeja') is distinct from e.size_kemeja)
           or (seragam.norm_size(d ->> 'size_polo') is not null and seragam.norm_size(d ->> 'size_polo') is distinct from e.size_polo)
           or (seragam.norm_size(d ->> 'size_blazer') is not null and seragam.norm_size(d ->> 'size_blazer') is distinct from e.size_blazer) then
          diffs := diffs || 'UBAH_UKURAN'::seragam.diff_type;
          detail := detail || jsonb_build_object('type', 'UBAH_UKURAN',
            'old', concat_ws(' / ', coalesce(e.size_kemeja, '-'), coalesce(e.size_polo, '-'), coalesce(e.size_blazer, '-')),
            'new', concat_ws(' / ', coalesce(seragam.norm_size(d ->> 'size_kemeja'), e.size_kemeja, '-'),
                                    coalesce(seragam.norm_size(d ->> 'size_polo'), e.size_polo, '-'),
                                    coalesce(seragam.norm_size(d ->> 'size_blazer'), e.size_blazer, '-')));
        end if;
        if cardinality(diffs) = 0 then
          diffs := array['TIDAK_BERUBAH'::seragam.diff_type];
        end if;
      end if;
    end if;

    update seragam.import_staging
       set errors = errs, warnings = warns, diff_types = diffs, diff_detail = detail,
           data = d || jsonb_build_object('gender', v_gender, 'status', v_status)
     where import_id = p_import_id and row_no = r.row_no;
  end loop;

  select count(*) filter (where jsonb_array_length(errors) > 0),
         count(*) filter (where jsonb_array_length(errors) = 0 and jsonb_array_length(warnings) > 0)
    into n_err, n_warn
  from seragam.import_staging where import_id = p_import_id;

  update seragam.import_log set
    total_rows = (select count(*) from seragam.import_staging where import_id = p_import_id),
    n_new = (select count(*) from seragam.import_staging where import_id = p_import_id
              and diff_types && array['NEW_OFFERING', 'NEW_AKTIF']::seragam.diff_type[]),
    n_resign = (select count(*) from seragam.import_staging where import_id = p_import_id
              and 'RESIGN' = any (diff_types)),
    n_mutasi = (select count(*) from seragam.import_staging where import_id = p_import_id
              and diff_types && array['MUTASI_JABATAN', 'PINDAH_CABANG']::seragam.diff_type[]),
    n_error = n_err,
    n_warning = n_warn
  where id = p_import_id;
end $$;

-- {file_name, file_hash, periode (YYYY-MM-DD), rows: [{nik, nama, gender, jabatan, kode_cabang,
--   status_karyawan, status, planned_join_date, join_date, planned_resign_date, resign_date,
--   size_kemeja, size_polo, size_blazer}]}
create or replace function seragam.fn_import_preview(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint; v_prev seragam.import_log; v_hash text := p ->> 'file_hash';
begin
  perform seragam.require_role('admin');
  if coalesce(v_hash, '') = '' then raise exception 'VALIDASI: file_hash wajib.'; end if;
  if jsonb_typeof(p -> 'rows') <> 'array' or jsonb_array_length(p -> 'rows') = 0 then
    raise exception 'VALIDASI: File tidak berisi baris data. Periksa sheet dan baris header.';
  end if;
  select * into v_prev from seragam.import_log where file_hash = v_hash and status = 'COMMITTED';
  if found then
    raise exception 'IMPORT_DUPLIKAT: File ini sudah pernah diimport (import #% pada %). Tidak ada data yang diubah.',
      v_prev.id, to_char(v_prev.committed_at at time zone 'Asia/Jakarta', 'DD-MM-YYYY HH24:MI');
  end if;
  -- Preview lama yang belum di-commit dibatalkan otomatis.
  update seragam.import_log set status = 'DIBATALKAN' where status = 'PREVIEW';

  insert into seragam.import_log (periode, file_name, file_hash, created_by)
  values (date_trunc('month', coalesce(seragam.try_date(p ->> 'periode'), current_date))::date,
          coalesce(p ->> 'file_name', 'tanpa-nama'), v_hash, auth.uid())
  returning id into v_id;

  insert into seragam.import_staging (import_id, row_no, nik, data)
  select v_id, coalesce((r ->> '_row')::int, ord::int + 1), nullif(upper(trim(r ->> 'nik')), ''),
    jsonb_build_object(
      'nik', nullif(upper(trim(r ->> 'nik')), ''),
      'nama', nullif(trim(r ->> 'nama'), ''),
      'gender_raw', nullif(trim(r ->> 'gender'), ''),
      'jabatan', nullif(regexp_replace(trim(r ->> 'jabatan'), '\s+', ' ', 'g'), ''),
      'kode_cabang', nullif(upper(trim(r ->> 'kode_cabang')), ''),
      'status_karyawan', nullif(upper(trim(r ->> 'status_karyawan')), ''),
      'status_raw', nullif(trim(r ->> 'status'), ''),
      'planned_join_date_raw', nullif(trim(r ->> 'planned_join_date'), ''),
      'join_date_raw', nullif(trim(r ->> 'join_date'), ''),
      'planned_resign_date_raw', nullif(trim(r ->> 'planned_resign_date'), ''),
      'resign_date_raw', nullif(trim(r ->> 'resign_date'), ''),
      'size_kemeja', seragam.norm_size(r ->> 'size_kemeja'),
      'size_polo', seragam.norm_size(r ->> 'size_polo'),
      'size_blazer', seragam.norm_size(r ->> 'size_blazer'))
  from jsonb_array_elements(p -> 'rows') with ordinality as t(r, ord);

  perform seragam._import_evaluate(v_id);
  return (select to_jsonb(il) from seragam.import_log il where il.id = v_id);
end $$;

create or replace function seragam.fn_import_commit(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare
  v_id bigint := (p ->> 'import_id')::bigint;
  v_log seragam.import_log;
  r record; d jsonb; t jsonb;
  v_applied int := 0;
begin
  perform seragam.require_role('admin');
  select * into v_log from seragam.import_log where id = v_id for update;
  if not found then raise exception 'TIDAK_DITEMUKAN: Import tidak ditemukan.'; end if;
  if v_log.status <> 'PREVIEW' then
    raise exception 'STATUS: Import ini berstatus %, tidak bisa di-commit. Upload ulang file bila perlu.', v_log.status;
  end if;
  if exists (select 1 from seragam.import_log where file_hash = v_log.file_hash and status = 'COMMITTED') then
    raise exception 'IMPORT_DUPLIKAT: File ini sudah pernah diimport. Tidak ada data yang diubah.';
  end if;

  -- Hitung ulang terhadap data terbaru
  perform seragam._import_evaluate(v_id);

  for r in select * from seragam.import_staging
           where import_id = v_id and jsonb_array_length(errors) = 0 order by row_no loop
    d := r.data;
    insert into seragam.employee as e (
      nik, nama, gender, jabatan, kode_cabang, status_karyawan, is_loan,
      planned_join_date, join_date, planned_resign_date, resign_date, status,
      size_kemeja, size_polo, size_blazer, updated_from_import_id)
    values (
      d ->> 'nik', d ->> 'nama', d ->> 'gender', d ->> 'jabatan', d ->> 'kode_cabang', d ->> 'status_karyawan',
      coalesce(d ->> 'status_karyawan', '') in ('PKL', 'MAGANG', 'INTERN', 'INTERNSHIP'),
      seragam.try_date(d ->> 'planned_join_date_raw'),
      coalesce(seragam.try_date(d ->> 'join_date_raw'),
               case when d ->> 'status' = 'AKTIF' then seragam.try_date(d ->> 'planned_join_date_raw') end),
      seragam.try_date(d ->> 'planned_resign_date_raw'),
      seragam.try_date(d ->> 'resign_date_raw'),
      (d ->> 'status')::seragam.employee_status,
      d ->> 'size_kemeja', d ->> 'size_polo', d ->> 'size_blazer', v_id)
    on conflict (nik) do update set
      nama = excluded.nama,
      gender = excluded.gender,
      jabatan = excluded.jabatan,
      kode_cabang = excluded.kode_cabang,
      status_karyawan = coalesce(excluded.status_karyawan, e.status_karyawan),
      is_loan = excluded.is_loan or (excluded.status_karyawan is null and e.is_loan),
      -- Tanggal & ukuran kosong di file tidak menghapus data lama
      planned_join_date = coalesce(excluded.planned_join_date, e.planned_join_date),
      join_date = coalesce(excluded.join_date, e.join_date,
                           case when excluded.status = 'AKTIF' then coalesce(excluded.planned_join_date, e.planned_join_date) end),
      planned_resign_date = coalesce(excluded.planned_resign_date, e.planned_resign_date),
      resign_date = coalesce(excluded.resign_date, e.resign_date,
                             case when excluded.status = 'RESIGN' then current_date end),
      status = excluded.status,
      size_kemeja = coalesce(excluded.size_kemeja, e.size_kemeja),
      size_polo = coalesce(excluded.size_polo, e.size_polo),
      size_blazer = coalesce(excluded.size_blazer, e.size_blazer),
      updated_from_import_id = case when r.diff_types = array['TIDAK_BERUBAH'::seragam.diff_type]
                                    then e.updated_from_import_id else excluded.updated_from_import_id end,
      updated_at = case when r.diff_types = array['TIDAK_BERUBAH'::seragam.diff_type] then e.updated_at else now() end;

    for t in select * from jsonb_array_elements(r.diff_detail) loop
      if t ->> 'type' <> 'TIDAK_BERUBAH' then
        insert into seragam.import_diff (import_id, nik, change_type, old_value, new_value)
        values (v_id, d ->> 'nik', (t ->> 'type')::seragam.diff_type, t ->> 'old', t ->> 'new');
      end if;
    end loop;
    v_applied := v_applied + 1;
  end loop;

  update seragam.import_log set status = 'COMMITTED', committed_at = now(), committed_by = auth.uid()
  where id = v_id;
  return jsonb_build_object('ok', true, 'import_id', v_id, 'baris_diproses', v_applied,
                            'baris_dilewati', (select n_error from seragam.import_log where id = v_id));
end $$;

create or replace function seragam.fn_import_cancel(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
begin
  perform seragam.require_role('admin');
  update seragam.import_log set status = 'DIBATALKAN'
  where id = (p ->> 'import_id')::bigint and status = 'PREVIEW';
  if not found then raise exception 'STATUS: Import ini sudah tidak dalam tahap preview.'; end if;
  delete from seragam.import_staging where import_id = (p ->> 'import_id')::bigint;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Ledger ----------
-- Satu-satunya pintu tulis ke ledger. Menolak stok negatif.
create or replace function seragam._ledger_insert(
  p_tx seragam.tx_type, p_sku text, p_qty int, p_status seragam.stock_status,
  p_nik text default null, p_reason text default null, p_ref text default null,
  p_tanggal date default current_date, p_opname bigint default null,
  p_affects_stock boolean default true, p_reversal_of bigint default null, p_reversed_tx seragam.tx_type default null)
returns bigint language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint; v_onhand int;
begin
  if p_qty = 0 then return null; end if;
  if p_affects_stock and p_qty < 0 then
    select coalesce(sum(qty), 0) into v_onhand from seragam.ledger
     where sku_code = p_sku and stock_status = p_status and affects_stock;
    if v_onhand + p_qty < 0 then
      raise exception 'STOK_TIDAK_CUKUP: Stok % (%) hanya %, tidak bisa dikurangi %.', p_sku, p_status, v_onhand, -p_qty;
    end if;
  end if;
  insert into seragam.ledger (tanggal, tx_type, sku_code, qty, stock_status, nik, reason, ref_doc, opname_id,
                              unit_price, affects_stock, reversal_of, reversed_tx_type, created_by)
  values (p_tanggal, p_tx, p_sku, p_qty, p_status, p_nik, p_reason, p_ref, p_opname,
          (select price from seragam.v_sku_price_current where sku_code = p_sku),
          p_affects_stock, p_reversal_of, p_reversed_tx, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function seragam.fn_ledger_reverse(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare l seragam.ledger; v_id bigint;
begin
  perform seragam.require_role('admin');
  select * into l from seragam.ledger where id = (p ->> 'id')::bigint;
  if not found then raise exception 'TIDAK_DITEMUKAN: Transaksi tidak ditemukan.'; end if;
  if l.tx_type = 'REVERSAL' then raise exception 'VALIDASI: Transaksi koreksi tidak bisa dikoreksi lagi. Buat transaksi yang benar.'; end if;
  if exists (select 1 from seragam.ledger where reversal_of = l.id) then
    raise exception 'VALIDASI: Transaksi #% sudah pernah dikoreksi.', l.id;
  end if;
  if length(coalesce(trim(p ->> 'alasan'), '')) < 5 then
    raise exception 'VALIDASI: Alasan koreksi wajib diisi (minimal 5 karakter).';
  end if;
  v_id := seragam._ledger_insert('REVERSAL', l.sku_code, -l.qty, l.stock_status, l.nik,
            trim(p ->> 'alasan'), 'REV#' || l.id, current_date, null, l.affects_stock, l.id, l.tx_type);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ISSUE historis dari spreadsheet lama.
-- {rows: [{nik, item_code, size, qty, tanggal}]} — semua-atau-tidak-sama-sekali.
create or replace function seragam.fn_issue_history_import(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare r jsonb; i int := 0; errs jsonb := '[]'; v_sku text; v_gender text; n int := 0; v_ref text;
begin
  perform seragam.require_role('admin');
  v_ref := 'MIGRASI-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD-HH24MISS');
  for pass in 1 .. 2 loop
    i := 0;
    for r in select * from jsonb_array_elements(p -> 'rows') loop
      i := i + 1;
      select case when it.gender_specific then e.gender else 'U' end into v_gender
      from seragam.employee e, seragam.item it
      where e.nik = upper(trim(r ->> 'nik')) and it.item_code = upper(trim(r ->> 'item_code'));
      v_sku := upper(trim(r ->> 'item_code')) || '-' || coalesce(v_gender, '?') || '-' || coalesce(seragam.norm_size(r ->> 'size'), '?');
      if pass = 1 then
        if not exists (select 1 from seragam.employee where nik = upper(trim(r ->> 'nik'))) then
          errs := errs || jsonb_build_object('baris', i, 'pesan', 'NIK ' || coalesce(r ->> 'nik', '(kosong)') || ' belum ada. Import data PPM dulu.');
        elsif not exists (select 1 from seragam.item where item_code = upper(trim(r ->> 'item_code'))) then
          errs := errs || jsonb_build_object('baris', i, 'pesan', 'Kode item ' || coalesce(r ->> 'item_code', '(kosong)') || ' tidak dikenal.');
        elsif not exists (select 1 from seragam.sku where sku_code = v_sku) then
          errs := errs || jsonb_build_object('baris', i, 'pesan', 'Ukuran ' || coalesce(r ->> 'size', '(kosong)') || ' tidak ada untuk item ini (SKU ' || v_sku || ').');
        elsif coalesce((r ->> 'qty')::text, '') !~ '^\d+$' or (r ->> 'qty')::int <= 0 then
          errs := errs || jsonb_build_object('baris', i, 'pesan', 'Qty harus bilangan bulat > 0.');
        elsif seragam.try_date(r ->> 'tanggal') is null then
          errs := errs || jsonb_build_object('baris', i, 'pesan', 'Tanggal tidak terbaca.');
        end if;
      else
        perform seragam._ledger_insert('ISSUE', v_sku, -(r ->> 'qty')::int, 'LAYAK', upper(trim(r ->> 'nik')),
          'Riwayat distribusi sebelum sistem', v_ref, seragam.try_date(r ->> 'tanggal'), null, false);
        n := n + 1;
      end if;
    end loop;
    if pass = 1 and jsonb_array_length(errs) > 0 then
      return jsonb_build_object('ok', false, 'errors', errs);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'jumlah', n, 'ref_doc', v_ref);
end $$;

-- ---------- Stock opname ----------
create or replace function seragam.fn_opname_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint; v_opening boolean;
begin
  perform seragam.require_role('admin', 'staf');
  if exists (select 1 from seragam.stock_opname where status in ('DRAFT', 'SUBMITTED')) then
    raise exception 'OPNAME_AKTIF: Masih ada opname yang belum selesai. Selesaikan atau batalkan dulu.';
  end if;
  v_opening := not exists (select 1 from seragam.ledger where affects_stock);
  insert into seragam.stock_opname (tanggal, is_opening, catatan, created_by)
  values (coalesce(seragam.try_date(p ->> 'tanggal'), current_date), v_opening, nullif(trim(p ->> 'catatan'), ''), auth.uid())
  returning id into v_id;
  insert into seragam.stock_opname_line (opname_id, sku_code, stock_status, qty_sistem)
  select v_id, x.sku_code, x.stock_status, coalesce(st.qty, 0)
  from (
    select s.sku_code, 'LAYAK'::seragam.stock_status as stock_status from seragam.v_sku s where s.active
    union
    select sku_code, stock_status from seragam.v_stock where qty <> 0
  ) x
  left join seragam.v_stock st on st.sku_code = x.sku_code and st.stock_status = x.stock_status;
  return jsonb_build_object('ok', true, 'id', v_id, 'is_opening', v_opening);
end $$;

-- {opname_id, lines: [{sku_code, stock_status, qty_fisik, alasan}]}
create or replace function seragam.fn_opname_save_lines(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint := (p ->> 'opname_id')::bigint; r jsonb; n int := 0; v_status seragam.stock_status;
begin
  perform seragam.require_role('admin', 'staf');
  if not exists (select 1 from seragam.stock_opname where id = v_id and status = 'DRAFT') then
    raise exception 'STATUS: Opname ini sudah tidak bisa diubah (bukan DRAFT).';
  end if;
  for r in select * from jsonb_array_elements(p -> 'lines') loop
    if (r ->> 'qty_fisik') is not null and (r ->> 'qty_fisik') !~ '^\d+$' then
      raise exception 'VALIDASI: Qty fisik % harus bilangan bulat 0 atau lebih.', r ->> 'sku_code';
    end if;
    v_status := coalesce((r ->> 'stock_status')::seragam.stock_status, 'LAYAK');
    insert into seragam.stock_opname_line (opname_id, sku_code, stock_status, qty_sistem, qty_fisik, alasan)
    values (v_id, upper(trim(r ->> 'sku_code')), v_status,
            coalesce((select qty from seragam.v_stock where sku_code = upper(trim(r ->> 'sku_code')) and stock_status = v_status), 0),
            (r ->> 'qty_fisik')::int, nullif(trim(r ->> 'alasan'), ''))
    on conflict (opname_id, sku_code, stock_status) do update
      set qty_fisik = excluded.qty_fisik,
          alasan = case when r ? 'alasan' then excluded.alasan else seragam.stock_opname_line.alasan end;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'jumlah', n);
exception when foreign_key_violation then
  raise exception 'VALIDASI: Ada kode SKU yang tidak dikenal di daftar.';
end $$;

create or replace function seragam.fn_opname_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint := (p ->> 'opname_id')::bigint; o seragam.stock_opname; n_blank int; n_no_reason int;
begin
  perform seragam.require_role('admin', 'staf');
  select * into o from seragam.stock_opname where id = v_id;
  if o.status is distinct from 'DRAFT' then raise exception 'STATUS: Hanya opname DRAFT yang bisa diajukan.'; end if;
  -- Segarkan qty sistem sebelum dibandingkan
  update seragam.stock_opname_line l set qty_sistem = coalesce(st.qty, 0)
  from (select l2.sku_code, l2.stock_status, s.qty from seragam.stock_opname_line l2
        left join seragam.v_stock s on s.sku_code = l2.sku_code and s.stock_status = l2.stock_status
        where l2.opname_id = v_id) st
  where l.opname_id = v_id and l.sku_code = st.sku_code and l.stock_status = st.stock_status;
  select count(*) into n_blank from seragam.stock_opname_line where opname_id = v_id and qty_fisik is null;
  if n_blank > 0 then
    raise exception 'VALIDASI: Masih ada % baris yang qty fisiknya kosong. Isi 0 bila barang memang tidak ada.', n_blank;
  end if;
  if not o.is_opening then
    select count(*) into n_no_reason from seragam.stock_opname_line
     where opname_id = v_id and qty_fisik <> qty_sistem and coalesce(trim(alasan), '') = '';
    if n_no_reason > 0 then
      raise exception 'VALIDASI: % baris punya selisih tanpa alasan. Tulis alasan selisih di setiap baris tersebut.', n_no_reason;
    end if;
  end if;
  update seragam.stock_opname set status = 'SUBMITTED', submitted_by = auth.uid(), submitted_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function seragam.fn_opname_approve(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
declare v_id bigint := (p ->> 'opname_id')::bigint; o seragam.stock_opname; l record; v_cur int; n int := 0;
begin
  perform seragam.require_role('admin');
  select * into o from seragam.stock_opname where id = v_id for update;
  if o.status is distinct from 'SUBMITTED' then raise exception 'STATUS: Hanya opname yang sudah diajukan yang bisa disetujui.'; end if;
  if o.is_opening and exists (select 1 from seragam.ledger where affects_stock) then
    raise exception 'STATUS: Stok awal sudah terbentuk dari transaksi lain. Batalkan opname ini dan buat opname baru.';
  end if;
  for l in select * from seragam.stock_opname_line where opname_id = v_id loop
    select coalesce(sum(qty), 0) into v_cur from seragam.ledger
     where sku_code = l.sku_code and stock_status = l.stock_status and affects_stock;
    if l.qty_fisik - v_cur <> 0 then
      perform seragam._ledger_insert(
        case when o.is_opening then 'OPENING'::seragam.tx_type else 'ADJ'::seragam.tx_type end,
        l.sku_code, l.qty_fisik - v_cur, l.stock_status, null,
        coalesce(l.alasan, case when o.is_opening then 'Saldo awal' end), 'OPNAME#' || v_id, o.tanggal, v_id);
      n := n + 1;
    end if;
  end loop;
  update seragam.stock_opname set status = 'APPROVED', approved_by = auth.uid(), approved_at = now() where id = v_id;
  return jsonb_build_object('ok', true, 'transaksi', n);
end $$;

create or replace function seragam.fn_opname_cancel(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
begin
  perform seragam.require_role('admin', 'staf');
  update seragam.stock_opname set status = 'DIBATALKAN'
  where id = (p ->> 'opname_id')::bigint and status in ('DRAFT', 'SUBMITTED');
  if not found then raise exception 'STATUS: Opname ini sudah selesai atau dibatalkan.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Kembalikan SUBMITTED ke DRAFT untuk diperbaiki (admin menolak).
create or replace function seragam.fn_opname_reopen(p jsonb)
returns jsonb language plpgsql security definer set search_path = seragam, public as $$
begin
  perform seragam.require_role('admin');
  update seragam.stock_opname set status = 'DRAFT', submitted_at = null, submitted_by = null
  where id = (p ->> 'opname_id')::bigint and status = 'SUBMITTED';
  if not found then raise exception 'STATUS: Hanya opname yang diajukan yang bisa dikembalikan ke draft.'; end if;
  return jsonb_build_object('ok', true);
end $$;

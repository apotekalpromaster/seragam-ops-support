-- =====================================================================
-- Dashboard Alokasi Seragam — Ops Support Apotek Alpro
-- Migration 1: schema, enum, tabel master & transaksi (M1)
--
-- Semua objek ada di schema `seragam` supaya tidak bercampur dengan app
-- lain di project Supabase yang sama. Tulis data HANYA lewat fungsi RPC
-- (lihat migration 3); tabel tidak punya policy INSERT/UPDATE/DELETE.
-- =====================================================================

create schema if not exists seragam;

-- ---------- Enum ----------
create type seragam.employee_status as enum ('OFFERING', 'AKTIF', 'BATAL_JOIN', 'RESIGN');

create type seragam.tx_type as enum (
  'OPENING',  -- saldo awal dari stock opname pertama      (+ LAYAK)
  'IN',       -- terima barang dari PO                      (+ LAYAK)
  'ISSUE',    -- alokasi ke karyawan saat batch SHIPPED     (- LAYAK)
  'EXC_OUT',  -- keluar barang pengganti (tukar cacat)      (- LAYAK)
  'EXC_IN',   -- masuk barang yang ditukar                  (+ KARANTINA)
  'SALE',     -- pembelian oleh karyawan                    (- LAYAK)
  'RET',      -- pengembalian resign/mutasi/PKL/no-show     (+ KARANTINA)
  'QC_MOVE',  -- pindah status hasil QC (dua baris)
  'DISPOSE',  -- pemusnahan barang afkir                    (- AFKIR)
  'ADJ',      -- selisih stock opname (approval admin)      (+/-)
  'REVERSAL'  -- koreksi transaksi salah (reversal_of)
);

create type seragam.stock_status as enum ('LAYAK', 'KARANTINA', 'CADANGAN', 'AFKIR');

create type seragam.diff_type as enum (
  'NEW_OFFERING', 'NEW_AKTIF', 'JOINED', 'BATAL_JOIN', 'JOIN_DATE_CHANGE',
  'RENCANA_RESIGN', 'RESIGN', 'MUTASI_JABATAN', 'PINDAH_CABANG', 'UBAH_UKURAN',
  'TIDAK_BERUBAH'
);

-- ---------- Pengguna aplikasi ----------
-- User Auth dipakai bersama app lain; hanya user yang terdaftar di sini
-- yang bisa membaca data seragam.
create table seragam.app_user (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  nama       text not null,
  role       text not null check (role in ('admin', 'staf', 'viewer', 'apa')),
  aktif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Konfigurasi ----------
create table seragam.config (
  key         text primary key,
  value       jsonb not null,
  type        text not null check (type in ('int', 'number', 'bool', 'text', 'json')),
  label       text not null,
  description text,
  grup        text not null default 'Umum',
  sort_order  int not null default 0,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

-- ---------- Ukuran, item, SKU ----------
create table seragam.size (
  size_code  text primary key,
  size_order int not null unique
);

create table seragam.item (
  item_code       text primary key check (item_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  nama            text not null,
  gender_specific boolean not null,
  -- Kolom ukuran karyawan yang dipakai item ini: KEMEJA / POLO / BLAZER,
  -- atau grup baru (disimpan di employee.size_lain) untuk item baru.
  size_group      text not null check (size_group ~ '^[A-Z0-9_]+$'),
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

create table seragam.item_size (
  item_code text not null references seragam.item (item_code) on delete cascade,
  size_code text not null references seragam.size (size_code),
  primary key (item_code, size_code)
);

create table seragam.vendor (
  id                bigint generated always as identity primary key,
  nama              text not null unique,
  kontak            text,
  lead_time_default int not null default 30 check (lead_time_default >= 0),
  active            boolean not null default true
);

create table seragam.sku (
  sku_code       text primary key,
  item_code      text not null references seragam.item (item_code),
  gender         char(1) not null check (gender in ('P', 'W', 'U')),
  size_code      text not null references seragam.size (size_code),
  vendor_id      bigint references seragam.vendor (id),
  lead_time_days int check (lead_time_days >= 0),
  moq            int not null default 1 check (moq >= 1),
  active         boolean not null default true,
  unique (item_code, gender, size_code)
);

-- Riwayat harga. Harga berlaku = baris dengan valid_from terbaru <= hari ini.
create table seragam.sku_price (
  id         bigint generated always as identity primary key,
  sku_code   text not null references seragam.sku (sku_code),
  price      numeric(14, 2) not null check (price >= 0),
  valid_from date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (sku_code, valid_from)
);

-- Proporsi ukuran per item & gender, untuk forecast SKU tanpa histori.
create table seragam.size_curve (
  item_code text not null references seragam.item (item_code) on delete cascade,
  gender    char(1) not null check (gender in ('P', 'W', 'U')),
  size_code text not null references seragam.size (size_code),
  proporsi  numeric(6, 4) not null check (proporsi >= 0 and proporsi <= 1),
  primary key (item_code, gender, size_code)
);

-- Size chart vendor (ukuran badan dalam cm) untuk ditampilkan di form ukuran.
create table seragam.size_chart (
  item_code  text not null references seragam.item (item_code) on delete cascade,
  gender     char(1) not null check (gender in ('P', 'W', 'U')),
  size_code  text not null references seragam.size (size_code),
  keterangan text not null,
  primary key (item_code, gender, size_code)
);

-- ---------- Paket alokasi ----------
create table seragam.package (
  package_code text primary key check (package_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  nama         text not null,
  deskripsi    text,
  active       boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

create table seragam.package_version (
  package_code   text not null references seragam.package (package_code) on delete cascade,
  version_no     int not null check (version_no >= 1),
  effective_date date not null,
  scope          text not null check (scope in ('SEMUA_AKTIF', 'KARYAWAN_BARU')),
  catatan        text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  primary key (package_code, version_no)
);

-- Item yang tidak ada barisnya dianggap qty 0 (item baru otomatis 0).
create table seragam.package_item (
  package_code text not null,
  version_no   int not null,
  item_code    text not null references seragam.item (item_code),
  qty          int not null check (qty >= 0),
  primary key (package_code, version_no, item_code),
  foreign key (package_code, version_no) references seragam.package_version (package_code, version_no) on delete cascade
);

create table seragam.position_map (
  jabatan      text primary key,
  package_code text not null references seragam.package (package_code),
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);

-- ---------- Cabang & karyawan ----------
create table seragam.branch (
  kode_cabang    text primary key,
  nama           text not null,
  area           text,
  alamat         text,
  is_new_opening boolean not null default false,
  go_date        date,
  active         boolean not null default true
);

create table seragam.employee (
  nik                    text primary key,
  nama                   text not null,
  gender                 char(1) not null check (gender in ('P', 'W')),
  jabatan                text not null,
  kode_cabang            text not null references seragam.branch (kode_cabang),
  status_karyawan        text,           -- TETAP / KONTRAK / PROBATION / PART_TIME / PKL
  is_loan                boolean not null default false, -- PKL/magang: seragam dipinjam
  planned_join_date      date,
  join_date              date,
  planned_resign_date    date,
  resign_date            date,
  is_late_hire           boolean not null default false,
  status                 seragam.employee_status not null,
  size_kemeja            text,
  size_polo              text,
  size_blazer            text,
  size_lain              jsonb not null default '{}', -- ukuran untuk size_group lain
  updated_from_import_id bigint,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index employee_status_idx on seragam.employee (status);
create index employee_jabatan_idx on seragam.employee (jabatan);
create index employee_cabang_idx on seragam.employee (kode_cabang);

create table seragam.employee_package_override (
  nik          text primary key references seragam.employee (nik) on delete cascade,
  package_code text not null references seragam.package (package_code),
  alasan       text not null check (length(trim(alasan)) >= 5),
  created_by   uuid,
  created_at   timestamptz not null default now()
);

-- ---------- Import data PPM ----------
create table seragam.import_log (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  periode      date not null,          -- tanggal 1 bulan cutoff
  file_name    text not null,
  file_hash    text not null,
  status       text not null default 'PREVIEW' check (status in ('PREVIEW', 'COMMITTED', 'DIBATALKAN')),
  total_rows   int not null default 0,
  n_new        int not null default 0,
  n_resign     int not null default 0,
  n_mutasi     int not null default 0,
  n_error      int not null default 0,
  n_warning    int not null default 0,
  created_by   uuid,
  committed_at timestamptz,
  committed_by uuid
);
-- Idempotent: file yang sama tidak bisa di-commit dua kali.
create unique index import_log_hash_committed_uq on seragam.import_log (file_hash) where status = 'COMMITTED';

create table seragam.import_staging (
  import_id   bigint not null references seragam.import_log (id) on delete cascade,
  row_no      int not null,
  nik         text,
  data        jsonb not null,               -- baris yang sudah dinormalisasi
  errors      jsonb not null default '[]',  -- [{field, message}] — baris dilewati
  warnings    jsonb not null default '[]',  -- [{field, message}] — baris masuk, diberi tanda
  diff_types  seragam.diff_type[] not null default '{}',
  diff_detail jsonb not null default '[]',  -- [{type, old, new}]
  primary key (import_id, row_no)
);
create index import_staging_nik_idx on seragam.import_staging (import_id, nik);

create table seragam.import_diff (
  id          bigint generated always as identity primary key,
  import_id   bigint not null references seragam.import_log (id),
  nik         text not null,
  change_type seragam.diff_type not null,
  old_value   text,
  new_value   text
);
create index import_diff_import_idx on seragam.import_diff (import_id);
create index import_diff_nik_idx on seragam.import_diff (nik);

-- Mapping kolom file PPM → field sistem, disimpan untuk import berikutnya.
create table seragam.import_column_map (
  field         text primary key,
  source_column text not null,
  updated_at    timestamptz not null default now()
);

-- ---------- Ledger (immutable) ----------
create table seragam.ledger (
  id               bigint generated always as identity primary key,
  tanggal          date not null default current_date,
  tx_type          seragam.tx_type not null,
  sku_code         text not null references seragam.sku (sku_code),
  qty              int not null check (qty <> 0),
  stock_status     seragam.stock_status not null,
  nik              text references seragam.employee (nik),
  batch_id         bigint,
  po_id            bigint,
  request_id       bigint,
  opname_id        bigint,
  unit_price       numeric(14, 2),
  reason           text,
  ref_doc          text,
  -- false untuk ISSUE historis hasil migrasi: tercatat sebagai pemenuhan hak,
  -- tetapi tidak mengurangi stok (stok awal diambil dari opname).
  affects_stock    boolean not null default true,
  reversal_of      bigint unique references seragam.ledger (id),
  reversed_tx_type seragam.tx_type,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check ((tx_type = 'REVERSAL') = (reversal_of is not null)),
  check ((tx_type = 'REVERSAL') = (reversed_tx_type is not null))
);
create index ledger_sku_idx on seragam.ledger (sku_code, stock_status);
create index ledger_nik_idx on seragam.ledger (nik) where nik is not null;
create index ledger_tanggal_idx on seragam.ledger (tanggal);

-- ---------- Stock opname ----------
create table seragam.stock_opname (
  id           bigint generated always as identity primary key,
  tanggal      date not null,
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'DIBATALKAN')),
  is_opening   boolean not null default false,
  catatan      text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by  uuid,
  approved_at  timestamptz
);

create table seragam.stock_opname_line (
  opname_id    bigint not null references seragam.stock_opname (id) on delete cascade,
  sku_code     text not null references seragam.sku (sku_code),
  stock_status seragam.stock_status not null,
  qty_sistem   int not null default 0,
  qty_fisik    int check (qty_fisik >= 0),
  alasan       text,
  primary key (opname_id, sku_code, stock_status)
);

-- ---------- Audit log (immutable) ----------
create table seragam.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  user_email text,
  aksi       text not null,
  entitas    text not null,
  entitas_id text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entitas_idx on seragam.audit_log (entitas, entitas_id);
create index audit_log_created_idx on seragam.audit_log (created_at desc);

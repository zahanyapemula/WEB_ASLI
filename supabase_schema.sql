-- Jalankan SEKALI di Supabase Dashboard -> SQL Editor.
-- Data cloud Web PKM dipisahkan berdasarkan auth.users.id.
create table if not exists public.user_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id, key)
);

-- Role is stored in a database-owned table, never trusted from client metadata.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'umkm' check (role in ('admin', 'cashier', 'umkm')),
  owner_name text not null default '',
  owner_code text unique check (owner_code is null or owner_code ~ '^[0-9]{4}$'),
  store_name text not null default '',
  store_code text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists store_name text not null default '';
alter table public.user_profiles add column if not exists store_code text;
alter table public.user_profiles add column if not exists avatar_url text;

create or replace function public.is_inventory_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = (select auth.uid())
      and role in ('admin', 'cashier')
  );
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

create or replace function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_code text;
  req_role text;
  s_name text;
  s_code text;
  av_url text;
begin
  req_role := coalesce(nullif(trim(new.raw_user_meta_data ->> 'role'), ''), 'umkm');
  s_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), '');
  s_code := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_code'), ''), '');
  av_url := coalesce(nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''), null);

  -- 1. OWNER TOKO (Admin) atau Kasir
  if req_role in ('admin', 'cashier') then
    insert into public.user_profiles (user_id, role, owner_name, owner_code, store_name, store_code, avatar_url)
    values (
      new.id,
      req_role,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
      null,
      s_name,
      nullif(upper(s_code), ''),
      av_url
    )
    on conflict (user_id) do update set
      role = excluded.role,
      store_name = coalesce(nullif(excluded.store_name, ''), public.user_profiles.store_name),
      store_code = coalesce(nullif(excluded.store_code, ''), public.user_profiles.store_code),
      avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.user_profiles.avatar_url);
    return new;
  end if;

  -- 2. UMKM PENITIP
  if s_code <> '' then
    -- Pastikan kode toko terdaftar dan milik owner toko yang sah
    if not exists (
      select 1 from public.user_profiles
      where upper(store_code) = upper(s_code)
        and role in ('admin', 'cashier')
    ) then
      raise exception 'Kode Toko "%" tidak ditemukan. Pastikan kode toko sesuai dengan milik Owner Toko.', s_code;
    end if;

    if s_name = '' then
      select store_name into s_name
      from public.user_profiles
      where upper(store_code) = upper(s_code) and role in ('admin', 'cashier')
      limit 1;
    end if;
  end if;

  new_code := nullif(trim(new.raw_user_meta_data ->> 'owner_code'), '');
  if new_code is not null then
    if new_code !~ '^[0-9]{4}$' then
      raise exception 'Kode UMKM harus terdiri dari 4 angka.';
    end if;

    if exists (
      select 1 from public.user_profiles where owner_code = new_code
    ) then
      raise exception 'Kode UMKM sudah terhubung ke akun UMKM lain.';
    end if;

    if not exists (
      select 1
      from public.user_data d
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
      ) as product(value)
      where d.key = 'products'
        and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = new_code
    ) then
      raise exception 'Kode UMKM tidak ditemukan. Minta Owner/Kasir memastikan produk dengan kode tersebut sudah disimpan.';
    end if;
  else
    loop
      new_code := lpad((floor(random() * 10000))::integer::text, 4, '0');
      exit when not exists (
        select 1 from public.user_profiles where owner_code = new_code
      ) and not exists (
        select 1
        from public.user_data d
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
        ) as product(value)
        where d.key = 'products'
          and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = new_code
      );
    end loop;
  end if;

  insert into public.user_profiles (user_id, role, owner_name, owner_code, store_name, store_code, avatar_url)
  values (
    new.id,
    'umkm',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new_code,
    s_name,
    nullif(upper(s_code), ''),
    av_url
  )
  on conflict (user_id) do update set
    store_code = coalesce(nullif(excluded.store_code, ''), public.user_profiles.store_code),
    avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.user_profiles.avatar_url);
  return new;
end;
$$;
revoke all on function public.create_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.create_user_profile();

-- Existing accounts are deliberately created as UMKM; promote trusted accounts
-- to admin/cashier manually after reviewing their identity.
do $$
declare
  account record;
  new_code text;
begin
  for account in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    left join public.user_profiles p on p.user_id = u.id
    where p.user_id is null
  loop
    loop
      new_code := lpad((floor(random() * 10000))::integer::text, 4, '0');
      exit when not exists (
        select 1 from public.user_profiles where owner_code = new_code
      ) and not exists (
        select 1
        from public.user_data d
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
        ) as product(value)
        where d.key = 'products'
          and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = new_code
      );
    end loop;

    insert into public.user_profiles (user_id, role, owner_name, owner_code)
    values (
      account.id,
      'umkm',
      coalesce(nullif(trim(account.raw_user_meta_data ->> 'name'), ''), split_part(account.email, '@', 1)),
      new_code
    )
    on conflict (user_id) do nothing;
  end loop;
end;
$$;

alter table public.user_data enable row level security;
alter table public.user_profiles enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;
drop policy if exists "user_data_admin_select" on public.user_data;
drop policy if exists "user_data_admin_insert" on public.user_data;
drop policy if exists "user_data_admin_update" on public.user_data;
drop policy if exists "user_data_admin_delete" on public.user_data;

create policy "user_data_select_own" on public.user_data for select using (auth.uid() = user_id and public.is_inventory_admin());
create policy "user_data_insert_own" on public.user_data for insert with check (auth.uid() = user_id and public.is_inventory_admin());
create policy "user_data_update_own" on public.user_data for update using (auth.uid() = user_id and public.is_inventory_admin()) with check (auth.uid() = user_id and public.is_inventory_admin());
create policy "user_data_delete_own" on public.user_data for delete using (auth.uid() = user_id and public.is_inventory_admin());
create policy "user_data_admin_select" on public.user_data for select using (public.is_inventory_admin());
create policy "user_data_admin_insert" on public.user_data for insert with check (public.is_inventory_admin());
create policy "user_data_admin_update" on public.user_data for update using (public.is_inventory_admin()) with check (public.is_inventory_admin());
create policy "user_data_admin_delete" on public.user_data for delete using (public.is_inventory_admin());

drop policy if exists "user_profiles_select_self_or_admin" on public.user_profiles;
drop policy if exists "user_profiles_update_admin" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;

create policy "user_profiles_select_self_or_admin"
on public.user_profiles for select
using (auth.uid() = user_id or public.is_inventory_admin());

create policy "user_profiles_update_own"
on public.user_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_profiles_update_admin"
on public.user_profiles for update
using (public.is_system_admin())
with check (public.is_system_admin());

grant execute on function public.is_inventory_admin() to authenticated;
grant execute on function public.is_system_admin() to authenticated;
revoke all on function public.is_inventory_admin() from public, anon;
revoke all on function public.is_system_admin() from public, anon;
grant select on public.user_profiles to authenticated;
grant update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.user_data to authenticated;

-- Supabase Dashboard -> Authentication -> Providers -> Email: ON.
-- Jika ingin akun langsung aktif tanpa klik email konfirmasi, matikan Confirm email.


-- FOTO PROFIL / AVATAR
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;
drop policy if exists "avatars_select_public" on storage.objects;

create policy "avatars_select_public"
on storage.objects for select
using (bucket_id = 'avatars');

create policy "avatars_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Shared owner payment status and inventory history; no frontend secret keys required.
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  product_code text not null default '',
  product_name text not null default '',
  owner_code text not null check (owner_code ~ '^[0-9]{4}$'),
  owner_name text not null default '',
  movement_type text not null check (movement_type in ('opening', 'stock_in', 'stock_out', 'sale')),
  quantity numeric(14, 3) not null check (quantity > 0),
  gross_amount numeric(14, 2) not null default 0 check (gross_amount >= 0),
  occurred_at timestamptz not null default now(),
  sale_id text,
  note text,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_owner_date_idx
  on public.stock_movements (owner_code, occurred_at);
create index if not exists stock_movements_product_date_idx
  on public.stock_movements (product_id, occurred_at);
alter table public.stock_movements
  add column if not exists gross_amount numeric(14, 2) not null default 0
  check (gross_amount >= 0);

alter table public.stock_movements enable row level security;
drop policy if exists "stock_movements_select_owner_or_admin" on public.stock_movements;
drop policy if exists "stock_movements_insert_owner_or_admin" on public.stock_movements;
drop policy if exists "stock_movements_insert_admin_cashier" on public.stock_movements;
create policy "stock_movements_select_owner_or_admin"
on public.stock_movements for select to authenticated
using (
  public.is_inventory_admin()
  or exists (
    select 1 from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role = 'umkm'
      and p.owner_code = stock_movements.owner_code
  )
);
create policy "stock_movements_insert_admin_cashier"
on public.stock_movements for insert to authenticated
with check (public.is_inventory_admin() and actor_user_id = auth.uid());
grant select, insert on public.stock_movements to authenticated;

create table if not exists public.owner_settlements (
  owner_code text not null check (owner_code ~ '^[0-9]{4}$'),
  owner_name text not null default '',
  settlement_date date not null,
  units_sold integer not null default 0 check (units_sold >= 0),
  gross_amount numeric(14, 2) not null default 0 check (gross_amount >= 0),
  paid_at timestamptz not null default now(),
  paid_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (owner_code, settlement_date)
);

alter table public.owner_settlements enable row level security;
drop policy if exists "owner_settlements_select_owner_or_admin" on public.owner_settlements;
drop policy if exists "owner_settlements_insert_admin" on public.owner_settlements;
drop policy if exists "owner_settlements_update_admin" on public.owner_settlements;
create policy "owner_settlements_select_owner_or_admin"
on public.owner_settlements for select to authenticated
using (
  public.is_inventory_admin()
  or exists (
    select 1 from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role = 'umkm'
      and p.owner_code = owner_settlements.owner_code
  )
);
create policy "owner_settlements_insert_admin"
on public.owner_settlements for insert to authenticated
with check (
  public.is_inventory_admin()
  and paid_by = auth.uid()
);
create policy "owner_settlements_update_admin"
on public.owner_settlements for update to authenticated
using (public.is_inventory_admin())
with check (
  public.is_inventory_admin()
  and paid_by = auth.uid()
);
grant select, insert, update on public.owner_settlements to authenticated;

-- Buku Kas exposes only owner-scoped sale lines to UMKM accounts.
-- Admin/Kasir receive all cash entries and store sales; UMKM receive only their own consignment sale lines.
create or replace function public.get_bookkeeping_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_role text;
  caller_owner_code text;
  caller_store_code text;
  cash_entries jsonb := '[]'::jsonb;
  sale_items jsonb := '[]'::jsonb;
begin
  select p.role, p.owner_code, p.store_code
    into caller_role, caller_owner_code, caller_store_code
  from public.user_profiles p
  where p.user_id = (select auth.uid());

  if caller_role is null or caller_role not in ('admin', 'cashier', 'umkm') then
    raise exception 'Buku Kas hanya dapat diakses oleh Admin, Kasir, atau UMKM.';
  end if;

  if caller_role in ('admin', 'cashier') then
    select coalesce(
      jsonb_agg(jsonb_build_object('user_id', d.user_id, 'entry', entry.value)),
      '[]'::jsonb
    )
    into cash_entries
    from public.user_data d
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
    ) as entry(value)
    where d.key = 'cash'
      and (
        d.user_id = (select auth.uid())
        or (caller_store_code is not null and caller_store_code <> '' and d.user_id in (
          select p2.user_id from public.user_profiles p2 where upper(p2.store_code) = upper(caller_store_code)
        ))
      );

    select coalesce(
      jsonb_agg(jsonb_build_object(
        'sale_id', sale.value ->> 'id',
        'date', sale.value ->> 'date',
        'source_user_id', d.user_id,
        'name', item.value ->> 'name',
        'barcode', item.value ->> 'barcode',
        'code', coalesce(item.value ->> 'code', item.value ->> 'productCode', ''),
        'owner_code', coalesce(item.value ->> 'ownerCode', item.value ->> 'owner_code', ''),
        'owner_name', coalesce(item.value ->> 'owner', item.value ->> 'owner_name', ''),
        'qty', coalesce(item.value ->> 'qty', '0'),
        'price', coalesce(item.value ->> 'price', '0'),
        'cost', coalesce(item.value ->> 'cost', '0'),
        'total', coalesce(item.value ->> 'total', '0')
      )),
      '[]'::jsonb
    )
    into sale_items
    from public.user_data d
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
    ) as sale(value)
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(sale.value -> 'items') = 'array' then sale.value -> 'items'
        else '[]'::jsonb
      end
    ) as item(value)
    where d.key = 'sales'
      and (
        d.user_id = (select auth.uid())
        or (caller_store_code is not null and caller_store_code <> '' and d.user_id in (
          select p2.user_id from public.user_profiles p2 where upper(p2.store_code) = upper(caller_store_code)
        ))
      );
  elsif caller_role = 'umkm' and caller_owner_code is not null and caller_owner_code <> '' then
    -- UMKM: Kas umum toko disterilkan (selalu kosong), hanya membaca penjualan produk titipan dengan owner_code miliknya
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'sale_id', sale.value ->> 'id',
        'date', sale.value ->> 'date',
        'source_user_id', d.user_id,
        'name', item.value ->> 'name',
        'barcode', item.value ->> 'barcode',
        'code', coalesce(item.value ->> 'code', item.value ->> 'productCode', ''),
        'owner_code', coalesce(item.value ->> 'ownerCode', item.value ->> 'owner_code', ''),
        'owner_name', coalesce(item.value ->> 'owner', item.value ->> 'owner_name', ''),
        'qty', coalesce(item.value ->> 'qty', '0'),
        'price', coalesce(item.value ->> 'price', '0'),
        'cost', coalesce(item.value ->> 'cost', '0'),
        'total', coalesce(item.value ->> 'total', '0')
      )),
      '[]'::jsonb
    )
    into sale_items
    from public.user_data d
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
    ) as sale(value)
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(sale.value -> 'items') = 'array' then sale.value -> 'items'
        else '[]'::jsonb
      end
    ) as item(value)
    where d.key = 'sales'
      and coalesce(item.value ->> 'ownerCode', item.value ->> 'owner_code') = caller_owner_code;
  end if;

  return jsonb_build_object('cash', cash_entries, 'sales', sale_items);
end;
$$;

revoke all on function public.get_bookkeeping_data() from public, anon;
grant execute on function public.get_bookkeeping_data() to authenticated;

-- Fungsi hapus catatan kas manual (admin / kasir)
create or replace function public.delete_cash_entry(p_entry_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  caller_store_code text;
  target_user_ids uuid[];
  row_rec record;
  new_arr jsonb;
begin
  if caller_id is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  select p.role, coalesce(p.store_code, '')
    into caller_role, caller_store_code
  from public.user_profiles p
  where p.user_id = caller_id;

  if caller_role is null or caller_role not in ('admin', 'cashier') then
    raise exception 'Hanya Admin/Kasir yang dapat menghapus catatan kas.';
  end if;

  if caller_store_code <> '' then
    select coalesce(array_agg(p2.user_id), array[caller_id])
      into target_user_ids
    from public.user_profiles p2
    where upper(p2.store_code) = upper(caller_store_code);
  else
    target_user_ids := array[caller_id];
  end if;

  for row_rec in
    select d.user_id, d.value
    from public.user_data d
    where d.key = 'cash'
      and d.user_id = any(target_user_ids)
    for update
  loop
    select coalesce(
      jsonb_agg(elem.val),
      '[]'::jsonb
    )
    into new_arr
    from jsonb_array_elements(case when jsonb_typeof(row_rec.value) = 'array' then row_rec.value else '[]'::jsonb end) as elem(val)
    where coalesce(elem.val ->> 'id', '') <> p_entry_id;

    update public.user_data
    set value = new_arr,
        updated_at = now()
    where user_id = row_rec.user_id and key = 'cash';
  end loop;

  return jsonb_build_object('success', true, 'deleted_id', p_entry_id);
end;
$$;

revoke all on function public.delete_cash_entry(text) from public, anon;
grant execute on function public.delete_cash_entry(text) to authenticated;

-- Existing UMKM accounts can safely relink to the code already stored on their products.
create or replace function public.claim_owner_code(p_owner_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  requested_code text := nullif(trim(p_owner_code), '');
begin
  if caller_id is null then
    raise exception 'Silakan login sebelum menghubungkan kode UMKM.';
  end if;

  select p.role into caller_role
  from public.user_profiles p
  where p.user_id = caller_id;

  if caller_role is distinct from 'umkm' then
    raise exception 'Pengaitan kode hanya tersedia untuk akun UMKM.';
  end if;

  if requested_code is null or requested_code !~ '^[0-9]{4}$' then
    raise exception 'Kode UMKM harus terdiri dari 4 angka.';
  end if;

  if exists (
    select 1 from public.user_profiles p
    where p.owner_code = requested_code and p.user_id <> caller_id
  ) then
    raise exception 'Kode UMKM sudah terhubung ke akun lain.';
  end if;

  if not exists (
    select 1
    from public.user_data d
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
    ) as product(value)
    where d.key = 'products'
      and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = requested_code
  ) then
    raise exception 'Kode UMKM tidak ditemukan pada produk yang tersimpan.';
  end if;

  update public.user_profiles
  set owner_code = requested_code
  where user_id = caller_id and role = 'umkm';

  return jsonb_build_object('owner_code', requested_code);
end;
$$;

revoke all on function public.claim_owner_code(text) from public, anon;
grant execute on function public.claim_owner_code(text) to authenticated;

-- UMKM accounts can read only products assigned to their profile owner code.
create or replace function public.get_owner_storage_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_role text;
  caller_owner_code text;
  owner_products jsonb;
begin
  select p.role, p.owner_code
    into caller_role, caller_owner_code
  from public.user_profiles p
  where p.user_id = (select auth.uid());

  if caller_role is distinct from 'umkm' or caller_owner_code is null then
    raise exception 'Fungsi ini hanya tersedia untuk akun UMKM.';
  end if;

  select coalesce(
    jsonb_agg(
      product.value
      order by d.user_id, product.ordinality
    ),
    '[]'::jsonb
  )
  into owner_products
  from public.user_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
  ) with ordinality as product(value, ordinality)
  where d.key = 'products'
    and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code;

  return jsonb_build_object('products', owner_products);
end;
$$;

revoke all on function public.get_owner_storage_products() from public, anon;
grant execute on function public.get_owner_storage_products() to authenticated;

-- UMKM accounts may update only the ingredient array of their own products.
create or replace function public.update_owner_product_ingredients(
  p_product_id text,
  p_ingredients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  caller_owner_code text;
  matching_products integer;
  updated_product jsonb;
begin
  select p.role, p.owner_code
    into caller_role, caller_owner_code
  from public.user_profiles p
  where p.user_id = (select auth.uid());

  if caller_role is distinct from 'umkm' or caller_owner_code is null then
    raise exception 'Fungsi ini hanya tersedia untuk akun UMKM.';
  end if;

  if p_product_id is null or p_product_id = ''
    or p_ingredients is null
    or jsonb_typeof(p_ingredients) is distinct from 'array'
  then
    raise exception 'Data ingredient tidak valid.';
  end if;

  if jsonb_array_length(p_ingredients) > 100
    or exists (
      select 1
      from jsonb_array_elements(p_ingredients) as ingredient(value)
      where jsonb_typeof(ingredient.value) <> 'object'
        or nullif(trim(ingredient.value ->> 'name'), '') is null
    )
  then
    raise exception 'Data ingredient tidak valid.';
  end if;

  select count(*)
    into matching_products
  from public.user_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
  ) as product(value)
  where d.key = 'products'
    and product.value ->> 'id' = p_product_id
    and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code;

  if matching_products <> 1 then
    raise exception 'Produk titipan tidak ditemukan atau tidak unik untuk akun ini.';
  end if;

  update public.user_data d
  set value = (
    select jsonb_agg(
      case
        when product.value ->> 'id' = p_product_id
          and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code
        then jsonb_set(product.value, '{ingredients}', p_ingredients, true)
        else product.value
      end
      order by product.ordinality
    )
    from jsonb_array_elements(d.value) with ordinality as product(value, ordinality)
  ),
  updated_at = now()
  where d.key = 'products'
    and jsonb_typeof(d.value) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(d.value) as product(value)
      where product.value ->> 'id' = p_product_id
        and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code
    );

  select product.value
    into updated_product
  from public.user_data d
  cross join lateral jsonb_array_elements(d.value) as product(value)
  where d.key = 'products'
    and product.value ->> 'id' = p_product_id
    and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code;

  return jsonb_build_object('product', updated_product);
end;
$$;

revoke all on function public.update_owner_product_ingredients(text, jsonb) from public, anon;
grant execute on function public.update_owner_product_ingredients(text, jsonb) to authenticated;

-- UMKM accounts may update stock and/or ingredient array of their own products.
-- Sisa stok tidak lagi direset otomatis pada 01.00 WITA; pemilik (owner) dapat mengubah stok secara manual
-- atau mereset stok ke 0 bila ada pengembalian dana (refund) untuk sisa produk.
create or replace function public.update_owner_product_storage(
  p_product_id text,
  p_stock numeric,
  p_ingredients jsonb default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  caller_owner_code text;
  caller_owner_name text;
  updated_product jsonb;
  target_user_id uuid;
  current_product jsonb;
  previous_stock numeric;
  stock_delta numeric;
  movement_note text;
begin
  select p.role, p.owner_code, coalesce(p.owner_name, '')
    into caller_role, caller_owner_code, caller_owner_name
  from public.user_profiles p
  where p.user_id = (select auth.uid());

  if caller_role is distinct from 'umkm' or caller_owner_code is null then
    raise exception 'Fungsi ini hanya tersedia untuk akun UMKM.';
  end if;

  if p_product_id is null or p_product_id = '' then
    raise exception 'ID produk tidak valid.';
  end if;

  if p_stock is null or p_stock < 0 then
    raise exception 'Jumlah stok tidak valid (harus >= 0).';
  end if;

  if p_ingredients is not null and (
    jsonb_typeof(p_ingredients) is distinct from 'array'
    or jsonb_array_length(p_ingredients) > 100
    or exists (
      select 1
      from jsonb_array_elements(p_ingredients) as ingredient(value)
      where jsonb_typeof(ingredient.value) <> 'object'
        or nullif(trim(ingredient.value ->> 'name'), '') is null
    )
  ) then
    raise exception 'Data ingredient tidak valid.';
  end if;

  select d.user_id, product.value
    into target_user_id, current_product
  from public.user_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
  ) as product(value)
  where d.key = 'products'
    and product.value ->> 'id' = p_product_id
    and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code
  limit 1;

  if target_user_id is null or current_product is null then
    raise exception 'Produk titipan tidak ditemukan atau bukan milik akun ini.';
  end if;

  previous_stock := greatest(0, coalesce((current_product ->> 'stock')::numeric, 0));
  stock_delta := p_stock - previous_stock;

  update public.user_data d
  set value = (
    select jsonb_agg(
      case
        when product.value ->> 'id' = p_product_id
          and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code
        then
          case
            when p_ingredients is not null then
              jsonb_set(
                jsonb_set(product.value, '{stock}', to_jsonb(p_stock), true),
                '{ingredients}',
                p_ingredients,
                true
              )
            else
              jsonb_set(product.value, '{stock}', to_jsonb(p_stock), true)
          end
        else product.value
      end
      order by product.ordinality
    )
    from jsonb_array_elements(d.value) with ordinality as product(value, ordinality)
  ),
  updated_at = now()
  where d.user_id = target_user_id
    and d.key = 'products';

  if stock_delta <> 0 then
    if p_stock = 0 then
      movement_note := coalesce(nullif(trim(p_note), ''), 'Pengembalian dana (refund) sisa produk oleh pemilik (owner)');
    elsif stock_delta > 0 then
      movement_note := coalesce(nullif(trim(p_note), ''), 'Penambahan stok oleh pemilik (owner)');
    else
      movement_note := coalesce(nullif(trim(p_note), ''), 'Pengurangan stok oleh pemilik (owner)');
    end if;

    insert into public.stock_movements (
      product_id,
      product_code,
      product_name,
      owner_code,
      owner_name,
      movement_type,
      quantity,
      occurred_at,
      note,
      actor_user_id
    ) values (
      p_product_id,
      coalesce(current_product ->> 'code', current_product ->> 'productCode', ''),
      coalesce(current_product ->> 'name', ''),
      caller_owner_code,
      coalesce(nullif(trim(caller_owner_name), ''), current_product ->> 'owner', current_product ->> 'owner_name', ''),
      case when stock_delta > 0 then 'stock_in' else 'stock_out' end,
      abs(stock_delta),
      now(),
      movement_note,
      (select auth.uid())
    );
  end if;

  select product.value
    into updated_product
  from public.user_data d
  cross join lateral jsonb_array_elements(d.value) as product(value)
  where d.user_id = target_user_id
    and d.key = 'products'
    and product.value ->> 'id' = p_product_id
    and coalesce(product.value ->> 'ownerCode', product.value ->> 'owner_code') = caller_owner_code
  limit 1;

  return jsonb_build_object('product', updated_product);
end;
$$;

revoke all on function public.update_owner_product_storage(text, numeric, jsonb, text) from public, anon;
grant execute on function public.update_owner_product_storage(text, numeric, jsonb, text) to authenticated;

-- Pembatalan cron job otomatis pukul 01.00 WITA:
-- Jadwal reset harian otomatis ditiadakan karena sisa barang tidak selalu dikembalikan.
-- Stok dikelola dan dapat direset ke 0 secara manual oleh pemilik saat ada refund sisa produk.
create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'reset-consignment-stock-wita';
  end if;
end;
$$;

-- ====================================================================
-- PANCATATAN TRANSAKSI KASIR SIMULTAN (ANTI RACE-CONDITION & REALTIME)
-- Mencegah transaksi tertimpa saat dua perangkat kasir melakukan checkout bersamaan.
-- ====================================================================

create or replace function public.record_pos_transaction(
  p_sale jsonb,
  p_cash jsonb default null,
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  caller_store_code text;
  target_user_id uuid;
  final_sales jsonb;
  final_cash jsonb;
  updated_products jsonb;
begin
  if caller_id is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  select p.role, coalesce(p.store_code, '')
    into caller_role, caller_store_code
  from public.user_profiles p
  where p.user_id = caller_id;

  if caller_role not in ('admin', 'cashier') then
    raise exception 'Hanya Admin atau Kasir yang dapat mencatat transaksi.';
  end if;

  target_user_id := caller_id;
  if caller_role = 'cashier' and caller_store_code <> '' then
    select p2.user_id into target_user_id
    from public.user_profiles p2
    where upper(p2.store_code) = upper(caller_store_code)
      and p2.role in ('admin', 'cashier')
    order by (case when p2.role = 'admin' then 0 else 1 end), p2.created_at asc
    limit 1;
    if target_user_id is null then
      target_user_id := caller_id;
    end if;
  end if;

  if p_sale is null or jsonb_typeof(p_sale) <> 'object' or nullif(trim(p_sale ->> 'id'), '') is null then
    raise exception 'Data transaksi penjualan tidak valid.';
  end if;

  -- Kunci baris sales dan cash milik target_user_id untuk mencegah race condition
  perform 1 from public.user_data
  where user_id = target_user_id and key in ('sales', 'cash')
  for update;

  -- 1. APPEND TRANSAKSI PENJUALAN SECARA ATOMIK
  insert into public.user_data (user_id, key, value, updated_at)
  values (target_user_id, 'sales', jsonb_build_array(p_sale), now())
  on conflict (user_id, key) do update
  set value = (
    case
      when jsonb_typeof(user_data.value) = 'array' then
        case
          when exists (
            select 1 from jsonb_array_elements(user_data.value) as s(val)
            where s.val ->> 'id' = p_sale ->> 'id'
          ) then user_data.value
          else user_data.value || jsonb_build_array(p_sale)
        end
      else jsonb_build_array(p_sale)
    end
  ),
  updated_at = now()
  returning value into final_sales;

  -- 2. APPEND BUKU KAS SECARA ATOMIK
  if p_cash is not null and jsonb_typeof(p_cash) = 'object' then
    insert into public.user_data (user_id, key, value, updated_at)
    values (target_user_id, 'cash', jsonb_build_array(p_cash), now())
    on conflict (user_id, key) do update
    set value = (
      case
        when jsonb_typeof(user_data.value) = 'array' then
          case
            when exists (
              select 1 from jsonb_array_elements(user_data.value) as c(val)
              where c.val ->> 'id' = p_cash ->> 'id'
                 or (c.val ->> 'saleId' is not null and c.val ->> 'saleId' = p_cash ->> 'saleId')
            ) then user_data.value
            else user_data.value || jsonb_build_array(p_cash)
          end
        else jsonb_build_array(p_cash)
      end
    ),
    updated_at = now()
    returning value into final_cash;
  end if;

  -- 3. PENGURANGAN STOK PRODUK SECARA ATOMIK
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    perform 1 from public.user_data d
    where d.key = 'products'
      and (
        d.user_id = target_user_id
        or (caller_store_code <> '' and d.user_id in (
          select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
        ))
      )
    for update;

    update public.user_data d
    set value = (
      select jsonb_agg(
        case
          when sold_calc.total_sold is not null and sold_calc.total_sold > 0 then
            jsonb_set(
              prod.value,
              '{stock}',
              to_jsonb(greatest(0, coalesce((prod.value ->> 'stock')::numeric, 0) - sold_calc.total_sold)),
              true
            )
          else prod.value
        end
        order by prod.ordinality
      )
      from jsonb_array_elements(d.value) with ordinality as prod(value, ordinality)
      left join lateral (
        select sum((it.value ->> 'qty')::numeric) as total_sold
        from jsonb_array_elements(p_items) as it(value)
        where (it.value ->> 'id' is not null and it.value ->> 'id' = prod.value ->> 'id')
           or (
             nullif(trim(prod.value ->> 'barcode'), '') is not null
             and nullif(trim(it.value ->> 'barcode'), '') is not null
             and it.value ->> 'barcode' = prod.value ->> 'barcode'
           )
      ) sold_calc on true
    ),
    updated_at = now()
    where d.key = 'products'
      and (
        d.user_id = target_user_id
        or (caller_store_code <> '' and d.user_id in (
          select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
        ))
      );

    -- 4. CATAT MUTASI PENJUALAN TITIPAN (STOCK MOVEMENTS)
    insert into public.stock_movements (
      product_id,
      product_code,
      product_name,
      owner_code,
      owner_name,
      movement_type,
      quantity,
      gross_amount,
      occurred_at,
      sale_id,
      note,
      actor_user_id
    )
    select
      coalesce(item.value ->> 'id', ''),
      coalesce(item.value ->> 'code', item.value ->> 'productCode', ''),
      coalesce(item.value ->> 'name', ''),
      item.value ->> 'ownerCode',
      coalesce(item.value ->> 'owner', item.value ->> 'owner_name', ''),
      'sale',
      (item.value ->> 'qty')::numeric,
      coalesce((item.value ->> 'total')::numeric, ((item.value ->> 'price')::numeric * (item.value ->> 'qty')::numeric)),
      coalesce((p_sale ->> 'date')::timestamptz, now()),
      p_sale ->> 'id',
      'Penjualan kasir ID: ' || coalesce(p_sale ->> 'id', ''),
      caller_id
    from jsonb_array_elements(p_items) as item(value)
    where coalesce(item.value ->> 'ownerCode', '') ~ '^[0-9]{4}$'
      and (item.value ->> 'qty')::numeric > 0;
  end if;

  -- Kembalikan seluruh produk toko termasuk milik UMKM dengan tag _tenantUserId
  select coalesce(
    jsonb_agg(
      case
        when d.user_id = target_user_id then prod.val
        else prod.val || jsonb_build_object('_tenantUserId', d.user_id)
      end
    ),
    '[]'::jsonb
  ) into updated_products
  from public.user_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
  ) as prod(val)
  where d.key = 'products'
    and (
      d.user_id = target_user_id
      or (caller_store_code <> '' and d.user_id in (
        select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
      ))
    );

  return jsonb_build_object(
    'success', true,
    'sale_id', p_sale ->> 'id',
    'sales', final_sales,
    'cash', final_cash,
    'products', updated_products
  );
end;
$$;

revoke all on function public.record_pos_transaction(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.record_pos_transaction(jsonb, jsonb, jsonb) to authenticated;

-- Fungsi penggabungan array user_data yang aman dari timpa data (sales, cash, expenses)
create or replace function public.sync_user_data_array(
  p_key text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  caller_store_code text;
  target_user_id uuid;
  existing_val jsonb;
  merged_val jsonb;
begin
  if caller_id is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  if p_key not in ('sales', 'cash', 'expenses') then
    raise exception 'Key tidak didukung untuk sinkronisasi array.';
  end if;

  select p.role, coalesce(p.store_code, '')
    into caller_role, caller_store_code
  from public.user_profiles p
  where p.user_id = caller_id;

  target_user_id := caller_id;
  if caller_role = 'cashier' and caller_store_code <> '' then
    select p2.user_id into target_user_id
    from public.user_profiles p2
    where upper(p2.store_code) = upper(caller_store_code)
      and p2.role in ('admin', 'cashier')
    order by (case when p2.role = 'admin' then 0 else 1 end), p2.created_at asc
    limit 1;
    if target_user_id is null then
      target_user_id := caller_id;
    end if;
  end if;

  select value into existing_val
  from public.user_data
  where user_id = target_user_id and key = p_key
  for update;

  if existing_val is null or jsonb_typeof(existing_val) <> 'array' then
    existing_val := '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(item.val),
    '[]'::jsonb
  )
  into merged_val
  from (
    select distinct on (coalesce(val ->> 'id', val ->> 'saleId', val::text)) val
    from (
      select value as val from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
      union all
      select value as val from jsonb_array_elements(existing_val)
    ) combined
    order by coalesce(val ->> 'id', val ->> 'saleId', val::text)
  ) item;

  insert into public.user_data (user_id, key, value, updated_at)
  values (target_user_id, p_key, merged_val, now())
  on conflict (user_id, key) do update
  set value = merged_val,
      updated_at = now();

  return merged_val;
end;
$$;

revoke all on function public.sync_user_data_array(text, jsonb) from public, anon;
grant execute on function public.sync_user_data_array(text, jsonb) to authenticated;

-- Fungsi penggabungan produk yang aman dari race condition / timpa data antar perangkat
create or replace function public.sync_user_data_products(
  p_products jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  caller_store_code text;
  target_admin_id uuid;
  t_user_id uuid;
  incoming_tenant_prods jsonb;
  existing_tenant_prods jsonb;
  merged_tenant_prods jsonb;
  final_all_products jsonb;
begin
  if caller_id is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  select p.role, coalesce(p.store_code, '')
    into caller_role, caller_store_code
  from public.user_profiles p
  where p.user_id = caller_id;

  if caller_role not in ('admin', 'cashier') then
    raise exception 'Hanya Admin atau Kasir yang dapat menyinkronkan produk toko.';
  end if;

  target_admin_id := caller_id;
  if caller_role = 'cashier' and caller_store_code <> '' then
    select p2.user_id into target_admin_id
    from public.user_profiles p2
    where upper(p2.store_code) = upper(caller_store_code)
      and p2.role in ('admin', 'cashier')
    order by (case when p2.role = 'admin' then 0 else 1 end), p2.created_at asc
    limit 1;
    if target_admin_id is null then
      target_admin_id := caller_id;
    end if;
  end if;

  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'Data produk harus berupa array.';
  end if;

  -- Kunci semua baris produk toko terlebih dahulu
  perform 1 from public.user_data d
  where d.key = 'products'
    and (
      d.user_id = target_admin_id
      or (caller_store_code <> '' and d.user_id in (
        select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
      ))
    )
  for update;

  -- Kelompokkan produk berdasarkan tenant pemilik dan simpan secara atomik
  for t_user_id, incoming_tenant_prods in
    select
      case
        when (p.val ->> '_tenantUserId') is not null
             and (caller_store_code <> '' and exists (
               select 1 from public.user_profiles p_sub
               where p_sub.user_id = (p.val ->> '_tenantUserId')::uuid
                 and upper(coalesce(p_sub.store_code, '')) = upper(caller_store_code)
             ))
        then (p.val ->> '_tenantUserId')::uuid
        else target_admin_id
      end as tenant_id,
      jsonb_agg(p.val - '_tenantUserId') as prods
    from jsonb_array_elements(p_products) as p(val)
    group by 1
  loop
    if p_replace then
      merged_tenant_prods := coalesce(incoming_tenant_prods, '[]'::jsonb);
    else
      select value into existing_tenant_prods
      from public.user_data
      where user_id = t_user_id and key = 'products'
      for update;

      if existing_tenant_prods is null or jsonb_typeof(existing_tenant_prods) <> 'array' then
        existing_tenant_prods := '[]'::jsonb;
      end if;

      select coalesce(
        jsonb_agg(item.val),
        '[]'::jsonb
      ) into merged_tenant_prods
      from (
        select distinct on (coalesce(val ->> 'id', val ->> 'code', val ->> 'barcode', val::text)) val
        from (
          select 1 as priority, val from jsonb_array_elements(incoming_tenant_prods) as val
          union all
          select 2 as priority, val from jsonb_array_elements(existing_tenant_prods) as val
        ) comb
        order by coalesce(val ->> 'id', val ->> 'code', val ->> 'barcode', val::text), priority asc
      ) item;
    end if;

    insert into public.user_data (user_id, key, value, updated_at)
    values (t_user_id, 'products', merged_tenant_prods, now())
    on conflict (user_id, key) do update
    set value = merged_tenant_prods,
        updated_at = now();
  end loop;

  -- Ambil kembali seluruh produk toko yang telah diperbarui
  select coalesce(
    jsonb_agg(
      case
        when d.user_id = target_admin_id then prod.val
        else prod.val || jsonb_build_object('_tenantUserId', d.user_id)
      end
    ),
    '[]'::jsonb
  ) into final_all_products
  from public.user_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
  ) as prod(val)
  where d.key = 'products'
    and (
      d.user_id = target_admin_id
      or (caller_store_code <> '' and d.user_id in (
        select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
      ))
    );

  return final_all_products;
end;
$$;

revoke all on function public.sync_user_data_products(jsonb, boolean) from public, anon;
grant execute on function public.sync_user_data_products(jsonb, boolean) to authenticated;

-- Fungsi hapus produk dari database toko secara atomik tanpa merusak produk lain
create or replace function public.delete_store_product(
  p_product_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  caller_store_code text;
  target_admin_id uuid;
  final_all_products jsonb;
begin
  if caller_id is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  select p.role, coalesce(p.store_code, '')
    into caller_role, caller_store_code
  from public.user_profiles p
  where p.user_id = caller_id;

  if caller_role not in ('admin', 'cashier') then
    raise exception 'Hanya Admin atau Kasir yang dapat menghapus produk.';
  end if;

  target_admin_id := caller_id;
  if caller_role = 'cashier' and caller_store_code <> '' then
    select p2.user_id into target_admin_id
    from public.user_profiles p2
    where upper(p2.store_code) = upper(caller_store_code)
      and p2.role in ('admin', 'cashier')
    order by (case when p2.role = 'admin' then 0 else 1 end), p2.created_at asc
    limit 1;
    if target_admin_id is null then
      target_admin_id := caller_id;
    end if;
  end if;

  -- Kunci semua baris produk toko terlebih dahulu
  perform 1 from public.user_data d
  where d.key = 'products'
    and (
      d.user_id = target_admin_id
      or (caller_store_code <> '' and d.user_id in (
        select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
      ))
    )
  for update;

  -- Hapus produk dengan ID atau code yang cocok dari seluruh tenant toko
  update public.user_data d
  set value = coalesce((
    select jsonb_agg(prod.val)
    from jsonb_array_elements(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) as prod(val)
    where coalesce(prod.val ->> 'id', '') <> p_product_id
      and coalesce(prod.val ->> 'code', '') <> p_product_id
  ), '[]'::jsonb),
  updated_at = now()
  where d.key = 'products'
    and (
      d.user_id = target_admin_id
      or (caller_store_code <> '' and d.user_id in (
        select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
      ))
    );

  -- Ambil kembali seluruh produk toko yang tersisa
  select coalesce(
    jsonb_agg(
      case
        when d.user_id = target_admin_id then prod.val
        else prod.val || jsonb_build_object('_tenantUserId', d.user_id)
      end
    ),
    '[]'::jsonb
  ) into final_all_products
  from public.user_data d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end
  ) as prod(val)
  where d.key = 'products'
    and (
      d.user_id = target_admin_id
      or (caller_store_code <> '' and d.user_id in (
        select p_sub.user_id from public.user_profiles p_sub where upper(p_sub.store_code) = upper(caller_store_code)
      ))
    );

  return final_all_products;
end;
$$;

revoke all on function public.delete_store_product(text) from public, anon;
grant execute on function public.delete_store_product(text) to authenticated;

-- Tambahkan user_data ke supabase_realtime agar perubahan data tersiar real-time ke semua perangkat kasir
alter table public.user_data replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_data'
  ) then
    alter publication supabase_realtime add table public.user_data;
  end if;
end;
$$;



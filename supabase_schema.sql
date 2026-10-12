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
  created_at timestamptz not null default now()
);

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
begin
  loop
    new_code := lpad((floor(random() * 10000))::integer::text, 4, '0');
    exit when not exists (
      select 1 from public.user_profiles where owner_code = new_code
    );
  end loop;

  insert into public.user_profiles (user_id, role, owner_name, owner_code)
  values (
    new.id,
    'umkm',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new_code
  )
  on conflict (user_id) do nothing;
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

create policy "user_data_select_own" on public.user_data for select using (auth.uid() = user_id);
create policy "user_data_insert_own" on public.user_data for insert with check (auth.uid() = user_id);
create policy "user_data_update_own" on public.user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_data_delete_own" on public.user_data for delete using (auth.uid() = user_id);
create policy "user_data_admin_select" on public.user_data for select using (public.is_inventory_admin());
create policy "user_data_admin_insert" on public.user_data for insert with check (public.is_inventory_admin());
create policy "user_data_admin_update" on public.user_data for update using (public.is_inventory_admin()) with check (public.is_inventory_admin());
create policy "user_data_admin_delete" on public.user_data for delete using (public.is_inventory_admin());

drop policy if exists "user_profiles_select_self_or_admin" on public.user_profiles;
drop policy if exists "user_profiles_update_admin" on public.user_profiles;
create policy "user_profiles_select_self_or_admin"
on public.user_profiles for select
using (auth.uid() = user_id or public.is_inventory_admin());
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
create policy "stock_movements_insert_owner_or_admin"
on public.stock_movements for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and (
    public.is_inventory_admin()
    or exists (
      select 1 from public.user_profiles p
      where p.user_id = auth.uid()
        and p.role = 'umkm'
        and p.owner_code = stock_movements.owner_code
    )
  )
);
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
-- Admin/Kasir receive all cash entries and sale lines.
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
  cash_entries jsonb := '[]'::jsonb;
  sale_items jsonb := '[]'::jsonb;
begin
  select p.role, p.owner_code
    into caller_role, caller_owner_code
  from public.user_profiles p
  where p.user_id = (select auth.uid());

  if caller_role is null then
    raise exception 'Profil akun tidak ditemukan.';
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
    where d.key = 'cash';
  end if;

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
      caller_role in ('admin', 'cashier')
      or (
        caller_role = 'umkm'
        and caller_owner_code is not null
        and coalesce(item.value ->> 'ownerCode', item.value ->> 'owner_code') = caller_owner_code
      )
    );

  return jsonb_build_object('cash', cash_entries, 'sales', sale_items);
end;
$$;

revoke all on function public.get_bookkeeping_data() from public, anon;
grant execute on function public.get_bookkeeping_data() to authenticated;

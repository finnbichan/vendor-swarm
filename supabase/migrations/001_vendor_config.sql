-- haggle-vendors: vendor config storage for deployed bots.
-- One row per vendor (vendor.json + catalog.json as jsonb) plus an append-only history.
-- RLS is enabled with no policies: only the service-role key (used server-side by the bots)
-- can read or write. Catalogues contain costs, so they must never be readable with the anon key.

create table if not exists public.vendor_config (
  vendor_id  text primary key,
  vendor     jsonb not null,
  catalog    jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'seed'
);

create table if not exists public.vendor_config_history (
  id         bigserial primary key,
  vendor_id  text not null references public.vendor_config (vendor_id) on delete cascade,
  version    integer not null,
  vendor     jsonb not null,
  catalog    jsonb not null,
  updated_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists vendor_config_history_vendor_idx on public.vendor_config_history (vendor_id, version desc);

alter table public.vendor_config enable row level security;
alter table public.vendor_config_history enable row level security;

-- Realtime: bots subscribe to UPDATEs on their own row to hot-reload edits.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vendor_config'
  ) then
    alter publication supabase_realtime add table public.vendor_config;
  end if;
end $$;

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  bucket text not null check (bucket in ('short','long')),
  symbols text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique(user_id, bucket)
);

create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger portfolios_updated_at
  before update on public.portfolios
  for each row execute procedure public.touch_updated_at();

alter table public.portfolios enable row level security;

create policy "Users manage own portfolios" on public.portfolios
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.portfolios to authenticated;
grant all on public.portfolios to service_role;

create table holidays (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  label      text not null,
  created_at timestamptz not null default now()
);

alter publication supabase_realtime add table holidays;

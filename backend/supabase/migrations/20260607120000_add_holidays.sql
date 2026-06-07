create table holidays (
  id         uuid primary key default uuid_generate_v4(),
  date       date not null unique,
  label      text not null,
  created_at timestamptz not null default now()
);

alter publication supabase_realtime add table holidays;

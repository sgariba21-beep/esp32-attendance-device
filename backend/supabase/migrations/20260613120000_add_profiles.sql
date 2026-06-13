create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  role           text not null check (role in ('super_admin', 'admin', 'teacher')),
  assigned_class text
);

alter table profiles enable row level security;

create policy "service role full access" on profiles
  for all using ((select auth.role()) = 'service_role');

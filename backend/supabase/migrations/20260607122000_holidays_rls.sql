alter table holidays enable row level security;

create policy "service role full access" on holidays
  for all using ((select auth.role()) = 'service_role');

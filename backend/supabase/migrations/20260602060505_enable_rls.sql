-- Enable RLS on all tables
alter table academic enable row level security;
alter table students enable row level security;
alter table devices enable row level security;
alter table attendance enable row level security;

-- Allow full access via service role key on all tables
create policy "service role full access" on academic
  for all using ((select auth.role()) = 'service_role');

create policy "service role full access" on students
  for all using ((select auth.role()) = 'service_role');

create policy "service role full access" on devices
  for all using ((select auth.role()) = 'service_role');

create policy "service role full access" on attendance
  for all using ((select auth.role()) = 'service_role');
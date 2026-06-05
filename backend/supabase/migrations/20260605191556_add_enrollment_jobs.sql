create table enrollment_jobs (
  id           uuid primary key default uuid_generate_v4(),
  device_id    uuid not null references devices(id) on delete restrict,
  student_id   uuid references students(id) on delete restrict,
  finger_slot  text check (finger_slot in ('fin1', 'fin2')),
  command      text not null check (command in ('register', 'delete', 'clearall')),
  status       text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'failed')),
  fid          integer,
  note         text,
  created_at   timestamptz not null default now()
);

-- RLS
alter table enrollment_jobs enable row level security;

create policy "service role full access" on enrollment_jobs
  for all using ((select auth.role()) = 'service_role');
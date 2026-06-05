alter table attendance
  add column device_id uuid references devices(id) on delete restrict;
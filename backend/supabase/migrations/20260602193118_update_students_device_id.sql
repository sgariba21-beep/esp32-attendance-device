-- Remove class column from students and replace with device_id FK
alter table students drop column class;

alter table students 
  add column device_id uuid not null references devices(id) on delete restrict;
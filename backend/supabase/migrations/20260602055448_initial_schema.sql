create table academic (
  id      uuid primary key default gen_random_uuid(),
  term    text not null check (term in ('Term 1', 'Term 2', 'Term 3')),
  year    text not null,
  status  text not null default 'active' check (status in ('active', 'inactive')),
  unique (term, year)
);

create table students (
  id         uuid primary key default gen_random_uuid(),
  sid        text not null unique,
  fullname   text not null,
  class      text not null,
  form       text not null,
  fin1       integer not null,
  fin2       integer not null,
  status     text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table devices (
  id    uuid primary key default gen_random_uuid(),
  dname text not null,
  class text not null,
  form  text not null
);

create table attendance (
  id          uuid primary key default gen_random_uuid(),
  sid         uuid not null references students(id),
  academic_id uuid not null references academic(id),
  date        date not null,
  time        time not null,
  status      text not null check (status in ('present', 'absent')),
  scan_id     text unique
);
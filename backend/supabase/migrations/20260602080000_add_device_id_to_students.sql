-- Replace students.class (text) with device_id (uuid FK → devices.id)

-- Step 1: Add device_id as nullable first (required before setting NOT NULL,
-- in case the table ever has existing rows — safe habit even on empty tables)
alter table students
  add column device_id uuid references devices(id) on delete restrict;

-- Step 2: Drop the old class text column
alter table students
  drop column class;

-- Step 3: Make device_id NOT NULL now that class is gone
alter table students
  alter column device_id set not null;

-- Add the plural label column that was missing from the initial institutions schema.
-- Default 'Members' is neutral; the OLAG seed row gets 'Students' to match its existing labels.
alter table public.institutions
  add column label_members text not null default 'Members';

-- Backfill the existing OLAG institution so its plural label is consistent.
update public.institutions
  set label_members = 'Students'
  where id = '00000000-0000-4000-8000-000000000001';

-- =====================================================================
-- enrollment_jobs.allow_overwrite — sensor-slot overwrite approval
-- =====================================================================
-- Purpose:
--   Carry the operator's "yes, overwrite the occupied slot" decision all
--   the way to the device. Until now that confirmation (JobFormData
--   .confirmOverwrite) was consumed server-side only: the job row was
--   inserted either way and the firmware always overwrote whatever
--   template was in the target slot, with only a serial-log warning.
--
--   With this column the firmware can probe the sensor (finger.loadModel)
--   right before enrolling and REFUSE to overwrite an occupied slot
--   unless allow_overwrite is true. This closes the blind spot where the
--   server's occupancy check (members.fin1/fin2 + master-job history)
--   says a slot is free but the physical sensor still holds a template
--   (orphaned model, out-of-band enrollment).
--
-- Safety:
--   Additive, NOT NULL with default false → every existing and future
--   job is "overwrite NOT approved" unless the dashboard explicitly sets
--   it. Only 'register' / 'register-master' jobs ever set it true; the
--   other commands ignore it. Fully reversible (drop column).
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.enrollment_jobs
  add column allow_overwrite boolean not null default false;

comment on column public.enrollment_jobs.allow_overwrite is
  'Operator explicitly confirmed overwriting an already-occupied sensor '
  'slot (register / register-master only). The device refuses to store a '
  'template into an occupied slot unless this is true.';

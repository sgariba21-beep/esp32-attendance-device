-- =====================================================================
-- Migration I — Institution logo Storage bucket + policies
-- =====================================================================
-- Purpose:
--   Create the PUBLIC 'institution-logos' bucket and the storage.objects
--   policies that let each super_admin manage only their own institution's
--   logo, while anyone may read (logos render via <img>, including on the
--   pre-auth login page).
--
-- Path convention: {institution_id}/logo.{ext}  -- first folder = tenant id.
-- Reuses public.auth_institution_id() and public.auth_role() from H.
-- RLS is already enabled on storage.objects (Supabase default); this adds
-- policies only.
-- =====================================================================


-- 1. The bucket. public=true -> served from the public CDN URL without auth
--    (required for the login page). Size + mime limits guard against abuse.
insert into storage.buckets
    (id, name, public, file_size_limit, allowed_mime_types)
values (
    'institution-logos',
    'institution-logos',
    true,
    2097152,                                        -- 2 MiB
    array['image/png','image/jpeg','image/webp','image/svg+xml']
)
on conflict (id) do nothing;    -- idempotent; will NOT change a pre-existing
                                -- bucket's settings (alter storage.buckets
                                -- directly if it already exists differently)


-- 2. Public read. A public bucket already serves its public URL without a
--    policy; this also lets the storage API (list/download) read the bucket,
--    which the dashboard settings page uses.
create policy "institution_logos_public_select" on storage.objects
  for select to public
  using ( bucket_id = 'institution-logos' );


-- 3. Upload: super_admin only, ONLY into their own institution's folder.
--    storage.foldername(name) splits the path; [1] is the first folder =
--    institution_id. Fail-closed: NULL institution -> no folder matches ->
--    cannot upload anywhere.
create policy "institution_logos_super_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'institution-logos'
    and (select public.auth_role()) = 'super_admin'
    and (storage.foldername(name))[1] = (select public.auth_institution_id())::text
  );


-- 4. Replace a logo: same boundary on both USING (which existing object) and
--    WITH CHECK (resulting object), so a super_admin can neither modify
--    another institution's object nor move one into another's folder.
create policy "institution_logos_super_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'institution-logos'
    and (select public.auth_role()) = 'super_admin'
    and (storage.foldername(name))[1] = (select public.auth_institution_id())::text
  )
  with check (
    bucket_id = 'institution-logos'
    and (select public.auth_role()) = 'super_admin'
    and (storage.foldername(name))[1] = (select public.auth_institution_id())::text
  );


-- 5. Delete a logo: super_admin, own folder only.
create policy "institution_logos_super_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'institution-logos'
    and (select public.auth_role()) = 'super_admin'
    and (storage.foldername(name))[1] = (select public.auth_institution_id())::text
  );

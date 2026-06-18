-- =====================================================================
-- H7 — Per-device provisioning token
-- =====================================================================
-- /assignment-poll previously released an institution's device_secret to anyone
-- holding the shared bootstrap secret plus a device_id. This column stores a
-- random token issued by /register; /assignment-poll now requires it before
-- releasing the secret, binding retrieval to the specific device that registered.
--
-- Nullable: legacy pending rows that predate this get a token minted on their
-- next /register call.
-- =====================================================================

alter table public.devices add column if not exists provisioning_token text;

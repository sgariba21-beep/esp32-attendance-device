alter table public.device_resets enable row level security;

-- No policies for the authenticated role: only service-role code ever touches
-- this table (the deleteDevice dashboard action and the get-enrollment-job edge
-- function). Service role bypasses RLS entirely so those paths are unaffected.
-- Authenticated dashboard users have no legitimate reason to read or write here.

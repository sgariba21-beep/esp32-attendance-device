-- =====================================================================
-- rewards_log — enforce "non-repeatable, once ever" at the table level
-- =====================================================================
-- Every write path that inserts into rewards_log (issueReward's standalone
-- grant, and create_sale's 'new' issue-and-redeem) does a check-then-insert:
-- read the client's issuance history, run evaluateReward(), insert if
-- eligible. For a non-repeatable reward, two concurrent calls (two admins,
-- or a retried request) can both read "not yet issued" before either has
-- committed, and both insert — granting a reward that's supposed to be
-- earnable exactly once, twice.
--
-- A partial unique index can't express this directly: "at most one row per
-- (reward_id, client_id) WHEN the reward is non-repeatable" needs a lookup
-- into a DIFFERENT table (rewards.repeatable), and index predicates can't
-- reference other tables. A BEFORE INSERT trigger can look up the reward,
-- but a plain EXISTS check inside a trigger has the SAME race the app-level
-- check has — under READ COMMITTED, one transaction's uncommitted insert is
-- invisible to another's EXISTS check. The fix is the standard idiom for
-- this exact situation: take an advisory lock scoped to the (reward,
-- client) pair BEFORE the exists-check, so a concurrent insert for the same
-- pair blocks until the first transaction commits or rolls back, then
-- re-evaluates against the now-committed (or now-absent) row.
--
-- This protects every insertion path at once, present and future, rather
-- than duplicating the guard in each TS call site.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create or replace function public.enforce_non_repeatable_reward_once()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_repeatable boolean;
begin
  select repeatable into v_repeatable from public.rewards where id = new.reward_id;

  if v_repeatable is false then
    perform pg_advisory_xact_lock(hashtextextended(new.reward_id::text || ':' || new.client_id::text, 0));

    if exists (
      select 1 from public.rewards_log
       where reward_id = new.reward_id
         and client_id = new.client_id
    ) then
      raise exception 'This reward has already been issued to this client and is not repeatable.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rewards_log_enforce_non_repeatable on public.rewards_log;
create trigger rewards_log_enforce_non_repeatable
  before insert on public.rewards_log
  for each row
  execute function public.enforce_non_repeatable_reward_once();

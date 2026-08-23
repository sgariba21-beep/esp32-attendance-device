-- =====================================================================
-- Rewards redemption link — close the issue/apply gap
-- =====================================================================
-- Until now, rewards_log recorded that a reward was GRANTED but nothing
-- recorded that it was ever USED. A cashier had to remember a discount was
-- owed and manually retype a lower price on the sale, with no link between
-- the two events and no way to tell "outstanding" from "already redeemed."
--
-- Three additive columns close that loop:
--   transactions.discount_total      — the reward-driven discount, tracked
--                                       separately from item prices so
--                                       transaction_items keeps honest
--                                       per-item snapshots for reporting.
--   transaction_items.reward_id      — tags a $0 line as a redemption, not
--                                       a markdown or a data-entry mistake.
--   rewards_log.transaction_id       — NULL = granted, not yet redeemed
--                                       (an IOU). Set = redeemed against
--                                       this sale. This is what turns
--                                       "issued" into "issued AND applied."
--
-- discount_total is subtracted from the items subtotal by create_sale() (see
-- the companion migration that rewrites the RPC); it is never negative and
-- never exceeds the items subtotal, so transactions.total stays >= 0 without
-- relying on a cross-column CHECK.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

alter table public.transactions
  add column discount_total numeric(10,2) not null default 0 check (discount_total >= 0);

comment on column public.transactions.discount_total is
  'Reward-driven discount subtracted from the items subtotal. total = items subtotal - discount_total, clamped >= 0 by create_sale().';

alter table public.transaction_items
  add column reward_id uuid references public.rewards(id);

comment on column public.transaction_items.reward_id is
  'Set when this line is a reward redemption (free product/service), not an ordinary paid item. NULL for normal lines.';

alter table public.rewards_log
  add column transaction_id uuid references public.transactions(id) on delete set null;

comment on column public.rewards_log.transaction_id is
  'The sale this reward was redeemed against. NULL = granted but not yet redeemed (an outstanding IOU) — e.g. issued from the client Loyalty dialog ahead of a future visit.';

-- Hot path: "does this client have any unredeemed rewards?" — read every time
-- the Sales dialog loads a client, so it needs to be fast even as the log grows.
create index rewards_log_unredeemed_idx
  on public.rewards_log(institution_id, client_id)
  where transaction_id is null;

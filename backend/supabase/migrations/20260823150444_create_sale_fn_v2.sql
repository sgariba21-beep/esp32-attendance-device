-- =====================================================================
-- create_sale() v2 — atomic redemption alongside the sale
-- =====================================================================
-- Adds two params on top of the original five-write RPC:
--   p_discount_total  — the reward discount to subtract from the items
--                        subtotal (clamped to the subtotal so total never
--                        goes negative).
--   p_redemptions     — [{ kind:'new', reward_id, value_snapshot, issued_by,
--                          note } | { kind:'existing', log_id, note }]
--                        'new'      inserts a rewards_log row already linked
--                                   to this transaction (issue + redeem in
--                                   one step — the common "client just
--                                   qualified, give it to them now" case).
--                        'existing' redeems an ALREADY-issued, unredeemed
--                                   reward (transaction_id IS NULL) by
--                                   attaching this transaction to it. The
--                                   `where transaction_id is null` on that
--                                   UPDATE is the atomicity guard: two
--                                   concurrent attempts to redeem the same
--                                   IOU can't both succeed.
--
-- p_items gains an optional "reward_id" key: a $0 line the caller has
-- already zeroed out client-side to represent a free product/service. This
-- function does not itself decide which lines are free — the caller (which
-- already ran the eligibility check) does, and passes the result down. Both
-- reward_id validation (belongs to this institution) and eligibility
-- validation happen in the calling TS action, mirroring how catalog item
-- ownership is already checked there rather than re-derived in SQL.
--
-- Eligibility for 'new' redemptions is NOT re-checked in this function —
-- that check requires walking the client's full event history, which is
-- exactly what the TS eligibility engine does immediately before this RPC
-- is called, in the same request. This function trusts that check the same
-- way it already trusts the caller's catalog/client ownership checks.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

drop function if exists public.create_sale(uuid, uuid, uuid, text, jsonb, text);

create or replace function public.create_sale(
  p_institution_id  uuid,
  p_client_id       uuid,
  p_staff_id        uuid,               -- nullable (stylist optional, A-2)
  p_note            text,               -- nullable
  p_items           jsonb,              -- [{product_id,service_id,item_name,unit_price,quantity,reward_id?}]
  p_tz              text,               -- institution timezone (e.g. 'Africa/Accra')
  p_discount_total  numeric default 0,
  p_redemptions     jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_attendance_id  uuid;
  v_today          date;
  v_items_total    numeric(10,2);
  v_discount_total numeric(10,2);
  v_total          numeric(10,2);
  v_item           jsonb;
  v_r              jsonb;
  v_i              integer;
begin
  -- 1. Compute today in the institution timezone (§D rule — never UTC date).
  v_today := (now() at time zone p_tz)::date;

  -- 2. Idempotent visit upsert (ON CONFLICT DO NOTHING mirrors logVisit).
  insert into public.client_attendance(institution_id, client_id, date)
    values (p_institution_id, p_client_id, v_today)
    on conflict (institution_id, client_id, date) do nothing;

  select id into v_attendance_id
    from public.client_attendance
   where institution_id = p_institution_id
     and client_id      = p_client_id
     and date           = v_today;

  -- 3. Compute the items subtotal, then apply the reward discount, clamped
  --    so it can never exceed what was actually being bought.
  v_items_total := 0;
  for v_i in 0..jsonb_array_length(p_items) - 1 loop
    v_items_total := v_items_total
      + (p_items->v_i->>'unit_price')::numeric(10,2)
      * (p_items->v_i->>'quantity')::integer;
  end loop;

  v_discount_total := least(greatest(coalesce(p_discount_total, 0), 0), v_items_total);
  v_total := v_items_total - v_discount_total;

  -- 4. Insert transaction header.
  insert into public.transactions(
    institution_id, client_id, client_attendance_id, staff_id, total, discount_total, note
  ) values (
    p_institution_id, p_client_id, v_attendance_id, p_staff_id, v_total, v_discount_total, p_note
  )
  returning id into v_transaction_id;

  -- 5. Insert line items + decrement product stock.
  for v_i in 0..jsonb_array_length(p_items) - 1 loop
    v_item := p_items->v_i;

    insert into public.transaction_items(
      institution_id,
      transaction_id,
      product_id,
      service_id,
      item_name,
      unit_price,
      quantity,
      reward_id
    ) values (
      p_institution_id,
      v_transaction_id,
      nullif(v_item->>'product_id', '')::uuid,
      nullif(v_item->>'service_id', '')::uuid,
      v_item->>'item_name',
      (v_item->>'unit_price')::numeric(10,2),
      (v_item->>'quantity')::integer,
      nullif(v_item->>'reward_id', '')::uuid
    );

    -- Decrement stock only for product items (not services).
    if (v_item->>'product_id') is not null and (v_item->>'product_id') != '' then
      update public.products
         set stock = stock - (v_item->>'quantity')::integer
       where id = (v_item->>'product_id')::uuid;
    end if;
  end loop;

  -- 6. Record reward redemptions against this transaction.
  for v_i in 0..jsonb_array_length(p_redemptions) - 1 loop
    v_r := p_redemptions->v_i;

    if v_r->>'kind' = 'existing' then
      -- Redeem an already-issued IOU. The `transaction_id is null` guard is
      -- the atomicity boundary: this only succeeds if nobody else redeemed
      -- it first.
      update public.rewards_log
         set transaction_id = v_transaction_id,
             note = coalesce(nullif(v_r->>'note', ''), note)
       where id = (v_r->>'log_id')::uuid
         and institution_id = p_institution_id
         and client_id = p_client_id
         and transaction_id is null;
    else
      -- Issue and redeem in one step.
      insert into public.rewards_log(
        institution_id, client_id, reward_id, trigger_source, value_snapshot,
        issued_by, transaction_id, note
      ) values (
        p_institution_id,
        p_client_id,
        (v_r->>'reward_id')::uuid,
        'manual',
        nullif(v_r->>'value_snapshot', '')::numeric,
        nullif(v_r->>'issued_by', '')::uuid,
        v_transaction_id,
        nullif(v_r->>'note', '')
      );
    end if;
  end loop;

  return v_transaction_id;
end;
$$;

-- Only the service role (backend admin client) may call this function.
revoke execute on function public.create_sale(uuid,uuid,uuid,text,jsonb,text,numeric,jsonb)
  from anon, authenticated;
grant execute on function public.create_sale(uuid,uuid,uuid,text,jsonb,text,numeric,jsonb)
  to service_role;

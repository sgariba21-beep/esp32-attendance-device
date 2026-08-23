-- =====================================================================
-- create_sale() — make IOU redemption actually atomic with the sale
-- =====================================================================
-- The 'existing' redemption branch does:
--
--   update rewards_log set transaction_id = v_transaction_id
--    where id = ... and transaction_id is null;
--
-- The `transaction_id is null` guard correctly stops two concurrent sales
-- from BOTH redeeming the same IOU — only one UPDATE actually matches. But
-- the function never checked whether ITS update matched. The LOSING side
-- of that race still fell through, and its transaction — already inserted
-- with the discount baked into v_total a few statements earlier — still
-- committed. Net effect: the client is charged the discounted price, but
-- the specific reward never gets marked redeemed, leaving the same IOU
-- still open to be redeemed again elsewhere. The atomicity this function's
-- own comments promised ("either the whole thing succeeds together or
-- none of it does") was not actually enforced for this path.
--
-- Fix: if the UPDATE affects zero rows, raise — which rolls back
-- everything this call has done so far (the transaction insert, the line
-- items, the stock decrements), since a plpgsql function body is one
-- implicit transaction. The TS caller already pre-checks this immediately
-- before calling the RPC, so in the ordinary case this exception is never
-- hit — it exists purely to close the race window between that check and
-- this statement.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create or replace function public.create_sale(
  p_institution_id  uuid,
  p_client_id       uuid,
  p_staff_id        uuid,
  p_note            text,
  p_items           jsonb,
  p_tz              text,
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
  v_today := (now() at time zone p_tz)::date;

  insert into public.client_attendance(institution_id, client_id, date)
    values (p_institution_id, p_client_id, v_today)
    on conflict (institution_id, client_id, date) do nothing;

  select id into v_attendance_id
    from public.client_attendance
   where institution_id = p_institution_id
     and client_id      = p_client_id
     and date           = v_today;

  v_items_total := 0;
  for v_i in 0..jsonb_array_length(p_items) - 1 loop
    v_items_total := v_items_total
      + (p_items->v_i->>'unit_price')::numeric(10,2)
      * (p_items->v_i->>'quantity')::integer;
  end loop;

  v_discount_total := least(greatest(coalesce(p_discount_total, 0), 0), v_items_total);
  v_total := v_items_total - v_discount_total;

  insert into public.transactions(
    institution_id, client_id, client_attendance_id, staff_id, total, discount_total, note
  ) values (
    p_institution_id, p_client_id, v_attendance_id, p_staff_id, v_total, v_discount_total, p_note
  )
  returning id into v_transaction_id;

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

    if (v_item->>'product_id') is not null and (v_item->>'product_id') != '' then
      update public.products
         set stock = stock - (v_item->>'quantity')::integer
       where id = (v_item->>'product_id')::uuid;
    end if;
  end loop;

  for v_i in 0..jsonb_array_length(p_redemptions) - 1 loop
    v_r := p_redemptions->v_i;

    if v_r->>'kind' = 'existing' then
      update public.rewards_log
         set transaction_id = v_transaction_id,
             note = coalesce(nullif(v_r->>'note', ''), note)
       where id = (v_r->>'log_id')::uuid
         and institution_id = p_institution_id
         and client_id = p_client_id
         and transaction_id is null;

      -- The race guard: if nothing matched, this IOU was already redeemed
      -- (or never existed for this client) between the caller's pre-check
      -- and now. Abort the whole sale rather than silently charging the
      -- discounted price for a reward that was never actually consumed.
      if not found then
        raise exception 'Reward redemption % is no longer available — it may have already been redeemed.', (v_r->>'log_id')
          using errcode = 'P0001';
      end if;
    else
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

revoke execute on function public.create_sale(uuid,uuid,uuid,text,jsonb,text,numeric,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_sale(uuid,uuid,uuid,text,jsonb,text,numeric,jsonb)
  to service_role;

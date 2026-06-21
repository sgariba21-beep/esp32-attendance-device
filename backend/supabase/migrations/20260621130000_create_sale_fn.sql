-- =====================================================================
-- Phase 5 — create_sale() RPC
-- Atomically records a sale: transaction header + line items + stock
-- decrements + client_attendance upsert for today.
--
-- Called from the server action (service role) after ownership checks.
-- NOT accessible to anon / authenticated roles.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create or replace function public.create_sale(
  p_institution_id uuid,
  p_client_id      uuid,
  p_staff_id       uuid,      -- nullable (stylist optional, A-2)
  p_note           text,      -- nullable
  p_items          jsonb,     -- [{product_id,service_id,item_name,unit_price,quantity}]
  p_tz             text       -- institution timezone (e.g. 'Africa/Accra')
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
  v_total          numeric(10,2);
  v_item           jsonb;
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

  -- 3. Compute total from items (must equal sum(line_total)).
  v_total := 0;
  for v_i in 0..jsonb_array_length(p_items) - 1 loop
    v_total := v_total
      + (p_items->v_i->>'unit_price')::numeric(10,2)
      * (p_items->v_i->>'quantity')::integer;
  end loop;

  -- 4. Insert transaction header.
  insert into public.transactions(
    institution_id, client_id, client_attendance_id, staff_id, total, note
  ) values (
    p_institution_id, p_client_id, v_attendance_id, p_staff_id, v_total, p_note
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
      quantity
    ) values (
      p_institution_id,
      v_transaction_id,
      nullif(v_item->>'product_id', '')::uuid,
      nullif(v_item->>'service_id', '')::uuid,
      v_item->>'item_name',
      (v_item->>'unit_price')::numeric(10,2),
      (v_item->>'quantity')::integer
    );

    -- Decrement stock only for product items (not services).
    if (v_item->>'product_id') is not null and (v_item->>'product_id') != '' then
      update public.products
         set stock = stock - (v_item->>'quantity')::integer
       where id = (v_item->>'product_id')::uuid;
    end if;
  end loop;

  return v_transaction_id;
end;
$$;

-- Only the service role (backend admin client) may call this function.
revoke execute on function public.create_sale(uuid,uuid,uuid,text,jsonb,text)
  from anon, authenticated;
grant execute on function public.create_sale(uuid,uuid,uuid,text,jsonb,text)
  to service_role;

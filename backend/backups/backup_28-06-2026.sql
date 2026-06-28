


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."auth_assigned_unit"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select assigned_unit from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_assigned_unit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_institution_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select institution_id from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_institution_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_member_unit"("p_member_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select unit_name from public.members where id = p_member_id
$$;


ALTER FUNCTION "public"."auth_member_unit"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select role from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sale"("p_institution_id" "uuid", "p_client_id" "uuid", "p_staff_id" "uuid", "p_note" "text", "p_items" "jsonb", "p_tz" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."create_sale"("p_institution_id" "uuid", "p_client_id" "uuid", "p_staff_id" "uuid", "p_note" "text", "p_items" "jsonb", "p_tz" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "period_id" "uuid",
    "date" "date" NOT NULL,
    "time" time without time zone NOT NULL,
    "status" "text" NOT NULL,
    "scan_id" "text",
    "device_id" "uuid",
    "institution_id" "uuid" NOT NULL,
    "scan_type" "text" DEFAULT 'present'::"text" NOT NULL,
    CONSTRAINT "attendance_scan_type_check" CHECK (("scan_type" = ANY (ARRAY['present'::"text", 'time_in'::"text", 'time_out'::"text"]))),
    CONSTRAINT "attendance_status_check" CHECK (("status" = ANY (ARRAY['present'::"text", 'absent'::"text"])))
);

ALTER TABLE ONLY "public"."attendance" REPLICA IDENTITY FULL;


ALTER TABLE "public"."attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "area_of_residence" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_resets" (
    "device_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."device_resets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_name" "text",
    "group_name" "text",
    "institution_id" "uuid",
    "display_name" "text" GENERATED ALWAYS AS (
CASE
    WHEN ("group_name" IS NOT NULL) THEN (("group_name" || ' — '::"text") || "unit_name")
    ELSE "unit_name"
END) STORED,
    "mac" "text",
    "provisioning_token" "text"
);

ALTER TABLE ONLY "public"."devices" REPLICA IDENTITY FULL;


ALTER TABLE "public"."devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."enrollment_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "uuid",
    "student_id" "uuid",
    "finger_slot" "text",
    "command" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "fid" integer,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    CONSTRAINT "enrollment_jobs_command_check" CHECK (("command" = ANY (ARRAY['register'::"text", 'delete'::"text", 'clearall'::"text", 'register-master'::"text", 'delete-master'::"text"]))),
    CONSTRAINT "enrollment_jobs_finger_slot_check" CHECK (("finger_slot" = ANY (ARRAY['fin1'::"text", 'fin2'::"text"]))),
    CONSTRAINT "enrollment_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."enrollment_jobs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."enrollment_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "recurring" boolean DEFAULT false NOT NULL,
    CONSTRAINT "holidays_date_range_check" CHECK (("end_date" >= "start_date"))
);

ALTER TABLE ONLY "public"."holidays" REPLICA IDENTITY FULL;


ALTER TABLE "public"."holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."institutions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'school'::"text" NOT NULL,
    "logo_url" "text",
    "label_member" "text" DEFAULT 'Member'::"text" NOT NULL,
    "label_group" "text" DEFAULT 'Group'::"text" NOT NULL,
    "label_unit" "text" DEFAULT 'Unit'::"text" NOT NULL,
    "label_period" "text" DEFAULT 'Period'::"text" NOT NULL,
    "skip_weekends" boolean DEFAULT true NOT NULL,
    "device_secret" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "label_members" "text" DEFAULT 'Members'::"text" NOT NULL,
    "track_students" boolean DEFAULT true NOT NULL,
    "track_staff" boolean DEFAULT false NOT NULL,
    "student_scan_mode" "text" DEFAULT 'present_absent'::"text" NOT NULL,
    "staff_scan_mode" "text" DEFAULT 'present_absent'::"text" NOT NULL,
    "label_staff" "text" DEFAULT 'Staff'::"text" NOT NULL,
    "label_staff_plural" "text" DEFAULT 'Staff'::"text" NOT NULL,
    "theme_primary" "text",
    "theme_preset" "text",
    "currency" "text" DEFAULT 'GHS'::"text" NOT NULL,
    "sell_products" boolean DEFAULT true NOT NULL,
    "sell_services" boolean DEFAULT true NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "loyalty_enabled" boolean DEFAULT true NOT NULL,
    CONSTRAINT "institutions_currency_check" CHECK (("char_length"("currency") = 3)),
    CONSTRAINT "institutions_staff_scan_mode_check" CHECK (("staff_scan_mode" = ANY (ARRAY['present_absent'::"text", 'time_in_out'::"text"]))),
    CONSTRAINT "institutions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'deactivated'::"text"]))),
    CONSTRAINT "institutions_student_scan_mode_check" CHECK (("student_scan_mode" = ANY (ARRAY['present_absent'::"text", 'time_in_out'::"text"]))),
    CONSTRAINT "institutions_theme_primary_hex" CHECK ((("theme_primary" IS NULL) OR ("theme_primary" ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$'::"text"))),
    CONSTRAINT "institutions_type_check" CHECK (("type" = ANY (ARRAY['school'::"text", 'office'::"text", 'shop'::"text"])))
);


ALTER TABLE "public"."institutions" OWNER TO "postgres";


COMMENT ON TABLE "public"."institutions" IS 'Root tenant table. Every tenant-scoped table references institutions(id).';



COMMENT ON COLUMN "public"."institutions"."theme_primary" IS 'Brand accent colour as a #rrggbb hex string. NULL → platform default. Applied as the dashboard --primary CSS variable.';



COMMENT ON COLUMN "public"."institutions"."theme_preset" IS 'Key of the curated palette preset (e.g. ''indigo'', ''emerald''), or ''custom'' for a hand-entered hex. NULL → default.';



COMMENT ON COLUMN "public"."institutions"."currency" IS 'ISO-4217 display currency for this tenant. Formatting only; no FX.';



CREATE TABLE IF NOT EXISTS "public"."members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sid" "text" NOT NULL,
    "fullname" "text" NOT NULL,
    "group_name" "text" NOT NULL,
    "fin1" integer NOT NULL,
    "fin2" integer NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "device_id" "uuid",
    "unit_name" "text",
    "institution_id" "uuid" NOT NULL,
    "member_type" "text" DEFAULT 'student'::"text" NOT NULL,
    CONSTRAINT "members_member_type_check" CHECK (("member_type" = ANY (ARRAY['student'::"text", 'staff'::"text"]))),
    CONSTRAINT "students_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);

ALTER TABLE ONLY "public"."members" REPLICA IDENTITY FULL;


ALTER TABLE "public"."members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "term" "text" NOT NULL,
    "year" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "institution_id" "uuid" NOT NULL,
    CONSTRAINT "academic_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);

ALTER TABLE ONLY "public"."periods" REPLICA IDENTITY FULL;


ALTER TABLE "public"."periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "stock" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "products_price_check" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "assigned_unit" "text",
    "institution_id" "uuid",
    "member_id" "uuid",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'teacher'::"text", 'staff'::"text", 'platform_admin'::"text", 'cashier'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "condition_type" "text" NOT NULL,
    "condition_product_id" "uuid",
    "condition_service_id" "uuid",
    "condition_value" numeric(10,2) NOT NULL,
    "window_type" "text" NOT NULL,
    "rolling_days" integer,
    "repeatable" boolean DEFAULT true NOT NULL,
    "reward_kind" "text" NOT NULL,
    "reward_product_id" "uuid",
    "reward_service_id" "uuid",
    "reward_value" numeric(10,2),
    "auto" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rewards_condition_product_scope_chk" CHECK ((("condition_product_id" IS NULL) OR ("condition_type" = 'product_count'::"text"))),
    CONSTRAINT "rewards_condition_service_scope_chk" CHECK ((("condition_service_id" IS NULL) OR ("condition_type" = 'service_count'::"text"))),
    CONSTRAINT "rewards_condition_type_check" CHECK (("condition_type" = ANY (ARRAY['service_count'::"text", 'product_count'::"text", 'visit_count'::"text", 'total_amount_spent'::"text"]))),
    CONSTRAINT "rewards_condition_value_check" CHECK (("condition_value" > (0)::numeric)),
    CONSTRAINT "rewards_reward_kind_check" CHECK (("reward_kind" = ANY (ARRAY['free_product'::"text", 'free_service'::"text", 'discount'::"text", 'custom'::"text"]))),
    CONSTRAINT "rewards_reward_payload_chk" CHECK (((("reward_kind" = 'free_product'::"text") AND ("reward_product_id" IS NOT NULL)) OR (("reward_kind" = 'free_service'::"text") AND ("reward_service_id" IS NOT NULL)) OR (("reward_kind" = 'discount'::"text") AND ("reward_value" IS NOT NULL)) OR ("reward_kind" = 'custom'::"text"))),
    CONSTRAINT "rewards_reward_value_check" CHECK ((("reward_value" IS NULL) OR ("reward_value" >= (0)::numeric))),
    CONSTRAINT "rewards_rolling_days_chk" CHECK ((("window_type" = 'rolling_days'::"text") = ("rolling_days" IS NOT NULL))),
    CONSTRAINT "rewards_window_type_check" CHECK (("window_type" = ANY (ARRAY['lifetime'::"text", 'rolling_days'::"text", 'since_last_issuance'::"text"])))
);


ALTER TABLE "public"."rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rewards_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "reward_id" "uuid" NOT NULL,
    "trigger_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "value_snapshot" numeric(10,2),
    "issued_by" "uuid",
    "note" "text",
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rewards_log_trigger_source_check" CHECK (("trigger_source" = ANY (ARRAY['manual'::"text", 'auto'::"text"]))),
    CONSTRAINT "rewards_log_value_snapshot_check" CHECK ((("value_snapshot" IS NULL) OR ("value_snapshot" >= (0)::numeric)))
);


ALTER TABLE "public"."rewards_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "services_price_check" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transaction_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "service_id" "uuid",
    "item_name" "text" NOT NULL,
    "unit_price" numeric(10,2) NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "line_total" numeric(10,2) GENERATED ALWAYS AS (("unit_price" * ("quantity")::numeric)) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transaction_items_one_target_chk" CHECK (("num_nonnulls"("product_id", "service_id") = 1)),
    CONSTRAINT "transaction_items_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "transaction_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."transaction_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "client_attendance_id" "uuid",
    "staff_id" "uuid",
    "total" numeric(10,2) NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transactions_total_check" CHECK (("total" >= (0)::numeric))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."periods"
    ADD CONSTRAINT "academic_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."periods"
    ADD CONSTRAINT "academic_term_year_key" UNIQUE ("term", "year");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_institution_scan_id_key" UNIQUE ("institution_id", "scan_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_member_date_scan_type_unique" UNIQUE ("member_id", "date", "scan_type");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_attendance"
    ADD CONSTRAINT "client_attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_resets"
    ADD CONSTRAINT "device_resets_pkey" PRIMARY KEY ("device_id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_class_form_unique" UNIQUE ("unit_name", "group_name");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_mac_key" UNIQUE ("mac");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrollment_jobs"
    ADD CONSTRAINT "enrollment_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_institution_range_key" UNIQUE ("institution_id", "start_date", "end_date", "recurring");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_institution_sid_key" UNIQUE ("institution_id", "sid");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rewards_log"
    ADD CONSTRAINT "rewards_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rewards"
    ADD CONSTRAINT "rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transaction_items"
    ADD CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



CREATE INDEX "attendance_institution_date_idx" ON "public"."attendance" USING "btree" ("institution_id", "date" DESC);



CREATE INDEX "attendance_institution_date_status_idx" ON "public"."attendance" USING "btree" ("institution_id", "date", "status");



CREATE INDEX "attendance_institution_id_idx" ON "public"."attendance" USING "btree" ("institution_id");



CREATE UNIQUE INDEX "client_attendance_institution_client_date_key" ON "public"."client_attendance" USING "btree" ("institution_id", "client_id", "date");



CREATE INDEX "client_attendance_institution_date_idx" ON "public"."client_attendance" USING "btree" ("institution_id", "date");



CREATE INDEX "clients_institution_id_idx" ON "public"."clients" USING "btree" ("institution_id");



CREATE INDEX "clients_institution_name_idx" ON "public"."clients" USING "btree" ("institution_id", "lower"("name"));



CREATE UNIQUE INDEX "clients_institution_phone_key" ON "public"."clients" USING "btree" ("institution_id", "phone");



CREATE INDEX "devices_institution_id_idx" ON "public"."devices" USING "btree" ("institution_id");



CREATE INDEX "enrollment_jobs_institution_id_idx" ON "public"."enrollment_jobs" USING "btree" ("institution_id");



CREATE INDEX "holidays_institution_id_idx" ON "public"."holidays" USING "btree" ("institution_id");



CREATE INDEX "institutions_status_idx" ON "public"."institutions" USING "btree" ("status");



CREATE INDEX "members_institution_id_idx" ON "public"."members" USING "btree" ("institution_id");



CREATE INDEX "periods_institution_id_idx" ON "public"."periods" USING "btree" ("institution_id");



CREATE INDEX "products_institution_id_idx" ON "public"."products" USING "btree" ("institution_id");



CREATE UNIQUE INDEX "products_institution_name_key" ON "public"."products" USING "btree" ("institution_id", "lower"("name")) WHERE "active";



CREATE INDEX "profiles_institution_id_idx" ON "public"."profiles" USING "btree" ("institution_id");



CREATE UNIQUE INDEX "profiles_member_id_unique" ON "public"."profiles" USING "btree" ("member_id") WHERE ("member_id" IS NOT NULL);



CREATE INDEX "rewards_institution_active_idx" ON "public"."rewards" USING "btree" ("institution_id", "active");



CREATE INDEX "rewards_institution_id_idx" ON "public"."rewards" USING "btree" ("institution_id");



CREATE INDEX "rewards_log_client_reward_issued_idx" ON "public"."rewards_log" USING "btree" ("institution_id", "client_id", "reward_id", "issued_at" DESC);



CREATE INDEX "rewards_log_institution_reward_idx" ON "public"."rewards_log" USING "btree" ("institution_id", "reward_id", "issued_at");



CREATE INDEX "services_institution_id_idx" ON "public"."services" USING "btree" ("institution_id");



CREATE UNIQUE INDEX "services_institution_name_key" ON "public"."services" USING "btree" ("institution_id", "lower"("name")) WHERE "active";



CREATE INDEX "transaction_items_institution_id_idx" ON "public"."transaction_items" USING "btree" ("institution_id");



CREATE INDEX "transaction_items_product_id_idx" ON "public"."transaction_items" USING "btree" ("product_id");



CREATE INDEX "transaction_items_service_id_idx" ON "public"."transaction_items" USING "btree" ("service_id");



CREATE INDEX "transaction_items_transaction_id_idx" ON "public"."transaction_items" USING "btree" ("transaction_id");



CREATE INDEX "transactions_institution_client_idx" ON "public"."transactions" USING "btree" ("institution_id", "client_id");



CREATE INDEX "transactions_institution_created_idx" ON "public"."transactions" USING "btree" ("institution_id", "created_at" DESC);



CREATE INDEX "transactions_institution_id_idx" ON "public"."transactions" USING "btree" ("institution_id");



CREATE INDEX "transactions_staff_idx" ON "public"."transactions" USING "btree" ("staff_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_academic_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_sid_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."client_attendance"
    ADD CONSTRAINT "client_attendance_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."client_attendance"
    ADD CONSTRAINT "client_attendance_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollment_jobs"
    ADD CONSTRAINT "enrollment_jobs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."enrollment_jobs"
    ADD CONSTRAINT "enrollment_jobs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollment_jobs"
    ADD CONSTRAINT "enrollment_jobs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."members"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."periods"
    ADD CONSTRAINT "periods_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rewards"
    ADD CONSTRAINT "rewards_condition_product_id_fkey" FOREIGN KEY ("condition_product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."rewards"
    ADD CONSTRAINT "rewards_condition_service_id_fkey" FOREIGN KEY ("condition_service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."rewards"
    ADD CONSTRAINT "rewards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rewards_log"
    ADD CONSTRAINT "rewards_log_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."rewards_log"
    ADD CONSTRAINT "rewards_log_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rewards_log"
    ADD CONSTRAINT "rewards_log_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rewards_log"
    ADD CONSTRAINT "rewards_log_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id");



ALTER TABLE ONLY "public"."rewards"
    ADD CONSTRAINT "rewards_reward_product_id_fkey" FOREIGN KEY ("reward_product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."rewards"
    ADD CONSTRAINT "rewards_reward_service_id_fkey" FOREIGN KEY ("reward_service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaction_items"
    ADD CONSTRAINT "transaction_items_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaction_items"
    ADD CONSTRAINT "transaction_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."transaction_items"
    ADD CONSTRAINT "transaction_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."transaction_items"
    ADD CONSTRAINT "transaction_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_client_attendance_id_fkey" FOREIGN KEY ("client_attendance_id") REFERENCES "public"."client_attendance"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_admin_all" ON "public"."attendance" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



CREATE POLICY "attendance_teacher_staff_select" ON "public"."attendance" FOR SELECT TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['teacher'::"text", 'staff'::"text"])) AND ("public"."auth_member_unit"("member_id") = ( SELECT "public"."auth_assigned_unit"() AS "auth_assigned_unit"))));



ALTER TABLE "public"."client_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."device_resets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_super_admin_all" ON "public"."devices" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text"))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text")));



ALTER TABLE "public"."enrollment_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "enrollment_jobs_admin_all" ON "public"."enrollment_jobs" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



ALTER TABLE "public"."holidays" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "holidays_admin_all" ON "public"."holidays" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



ALTER TABLE "public"."institutions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "institutions_member_select" ON "public"."institutions" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'cashier'::"text"]))));



CREATE POLICY "institutions_super_admin_update" ON "public"."institutions" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text"))) WITH CHECK ((("id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text")));



ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_admin_all" ON "public"."members" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



CREATE POLICY "members_teacher_staff_select" ON "public"."members" FOR SELECT TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['teacher'::"text", 'staff'::"text"])) AND ("unit_name" = ( SELECT "public"."auth_assigned_unit"() AS "auth_assigned_unit"))));



ALTER TABLE "public"."periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "periods_admin_all" ON "public"."periods" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_self_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_super_admin_all" ON "public"."profiles" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text"))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text") AND ("role" <> 'platform_admin'::"text")));



ALTER TABLE "public"."rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rewards_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service role full access" ON "public"."attendance" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."client_attendance" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."clients" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."devices" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."enrollment_jobs" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."holidays" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."members" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."periods" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."products" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."profiles" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."rewards" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."rewards_log" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."services" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."transaction_items" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."transactions" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transaction_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."attendance";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."devices";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."enrollment_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."holidays";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."members";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."periods";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."auth_assigned_unit"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_assigned_unit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_assigned_unit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_institution_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_institution_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_institution_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_member_unit"("p_member_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."auth_member_unit"("p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_member_unit"("p_member_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_sale"("p_institution_id" "uuid", "p_client_id" "uuid", "p_staff_id" "uuid", "p_note" "text", "p_items" "jsonb", "p_tz" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT ALL ON TABLE "public"."client_attendance" TO "anon";
GRANT ALL ON TABLE "public"."client_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."client_attendance" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."device_resets" TO "anon";
GRANT ALL ON TABLE "public"."device_resets" TO "authenticated";
GRANT ALL ON TABLE "public"."device_resets" TO "service_role";



GRANT ALL ON TABLE "public"."devices" TO "anon";
GRANT ALL ON TABLE "public"."devices" TO "authenticated";
GRANT ALL ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON TABLE "public"."enrollment_jobs" TO "anon";
GRANT ALL ON TABLE "public"."enrollment_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."enrollment_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."holidays" TO "anon";
GRANT ALL ON TABLE "public"."holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."holidays" TO "service_role";



GRANT ALL ON TABLE "public"."institutions" TO "anon";
GRANT ALL ON TABLE "public"."institutions" TO "authenticated";
GRANT ALL ON TABLE "public"."institutions" TO "service_role";



GRANT ALL ON TABLE "public"."members" TO "anon";
GRANT ALL ON TABLE "public"."members" TO "authenticated";
GRANT ALL ON TABLE "public"."members" TO "service_role";



GRANT ALL ON TABLE "public"."periods" TO "anon";
GRANT ALL ON TABLE "public"."periods" TO "authenticated";
GRANT ALL ON TABLE "public"."periods" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."rewards" TO "anon";
GRANT ALL ON TABLE "public"."rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."rewards" TO "service_role";



GRANT ALL ON TABLE "public"."rewards_log" TO "anon";
GRANT ALL ON TABLE "public"."rewards_log" TO "authenticated";
GRANT ALL ON TABLE "public"."rewards_log" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."transaction_items" TO "anon";
GRANT ALL ON TABLE "public"."transaction_items" TO "authenticated";
GRANT ALL ON TABLE "public"."transaction_items" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































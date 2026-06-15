


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


ALTER TABLE "public"."attendance" OWNER TO "postgres";


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
    "mode" "text" DEFAULT 'present_absent'::"text" NOT NULL,
    "display_name" "text" GENERATED ALWAYS AS (
CASE
    WHEN ("group_name" IS NOT NULL) THEN (("group_name" || ' — '::"text") || "unit_name")
    ELSE "unit_name"
END) STORED,
    "mac" "text",
    CONSTRAINT "devices_mode_check" CHECK (("mode" = ANY (ARRAY['present_absent'::"text", 'time_in_out'::"text"])))
);


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
    CONSTRAINT "institutions_staff_scan_mode_check" CHECK (("staff_scan_mode" = ANY (ARRAY['present_absent'::"text", 'time_in_out'::"text"]))),
    CONSTRAINT "institutions_student_scan_mode_check" CHECK (("student_scan_mode" = ANY (ARRAY['present_absent'::"text", 'time_in_out'::"text"]))),
    CONSTRAINT "institutions_type_check" CHECK (("type" = ANY (ARRAY['school'::"text", 'office'::"text"])))
);


ALTER TABLE "public"."institutions" OWNER TO "postgres";


COMMENT ON TABLE "public"."institutions" IS 'Root tenant table. Every tenant-scoped table references institutions(id).';



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
    "member_type" "text" DEFAULT 'member'::"text" NOT NULL,
    CONSTRAINT "members_member_type_check" CHECK (("member_type" = ANY (ARRAY['student'::"text", 'staff'::"text", 'member'::"text"]))),
    CONSTRAINT "students_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


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


ALTER TABLE "public"."periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "assigned_unit" "text",
    "institution_id" "uuid",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'teacher'::"text", 'staff'::"text", 'platform_admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."periods"
    ADD CONSTRAINT "academic_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."periods"
    ADD CONSTRAINT "academic_term_year_key" UNIQUE ("term", "year");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_member_date_scan_type_unique" UNIQUE ("member_id", "date", "scan_type");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_scan_id_key" UNIQUE ("scan_id");



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
    ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "students_sid_key" UNIQUE ("sid");



CREATE INDEX "attendance_institution_id_idx" ON "public"."attendance" USING "btree" ("institution_id");



CREATE INDEX "devices_institution_id_idx" ON "public"."devices" USING "btree" ("institution_id");



CREATE INDEX "enrollment_jobs_institution_id_idx" ON "public"."enrollment_jobs" USING "btree" ("institution_id");



CREATE INDEX "holidays_institution_id_idx" ON "public"."holidays" USING "btree" ("institution_id");



CREATE INDEX "members_institution_id_idx" ON "public"."members" USING "btree" ("institution_id");



CREATE INDEX "periods_institution_id_idx" ON "public"."periods" USING "btree" ("institution_id");



CREATE INDEX "profiles_institution_id_idx" ON "public"."profiles" USING "btree" ("institution_id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_academic_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_sid_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id");



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



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE CASCADE;



ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_admin_all" ON "public"."attendance" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



CREATE POLICY "attendance_teacher_staff_select" ON "public"."attendance" FOR SELECT TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['teacher'::"text", 'staff'::"text"])) AND ("public"."auth_member_unit"("member_id") = ( SELECT "public"."auth_assigned_unit"() AS "auth_assigned_unit"))));



ALTER TABLE "public"."device_resets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_super_admin_all" ON "public"."devices" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text"))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text")));



ALTER TABLE "public"."enrollment_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "enrollment_jobs_admin_all" ON "public"."enrollment_jobs" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



ALTER TABLE "public"."holidays" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "holidays_admin_all" ON "public"."holidays" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



ALTER TABLE "public"."institutions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "institutions_member_select" ON "public"."institutions" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



CREATE POLICY "institutions_super_admin_update" ON "public"."institutions" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text"))) WITH CHECK ((("id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text")));



ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_admin_all" ON "public"."members" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



CREATE POLICY "members_teacher_staff_select" ON "public"."members" FOR SELECT TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['teacher'::"text", 'staff'::"text"])) AND ("unit_name" = ( SELECT "public"."auth_assigned_unit"() AS "auth_assigned_unit"))));



ALTER TABLE "public"."periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "periods_admin_all" ON "public"."periods" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"])))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = ANY (ARRAY['super_admin'::"text", 'admin'::"text"]))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_self_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_super_admin_all" ON "public"."profiles" TO "authenticated" USING ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text"))) WITH CHECK ((("institution_id" = ( SELECT "public"."auth_institution_id"() AS "auth_institution_id")) AND (( SELECT "public"."auth_role"() AS "auth_role") = 'super_admin'::"text") AND ("role" <> 'platform_admin'::"text")));



CREATE POLICY "service role full access" ON "public"."attendance" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."devices" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."enrollment_jobs" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."holidays" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."members" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."periods" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."profiles" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));





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
























GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



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



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";









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
































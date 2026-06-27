import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function localTime(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(instant);
  } catch {
    return instant.toISOString().split("T")[1].slice(0, 8);
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: institutions, error: instError } = await supabase
      .from("institutions")
      .select(
        "id, status, skip_weekends, timezone, track_students, track_staff, student_scan_mode, staff_scan_mode"
      );

    if (instError || !institutions || institutions.length === 0) {
      return json({ error: "No institutions found" }, 500);
    }

    const results: string[] = [];

    for (const inst of institutions) {
      // #4: skip suspended/deactivated tenants — no absent records generated
      // while an institution is switched off.
      if (inst.status !== "active") {
        results.push(`${inst.id}: inactive — skipped`);
        continue;
      }

      const now = new Date();

      const todayInTz = now.toLocaleDateString("en-CA", {
        timeZone: inst.timezone,
      });

      // H3 consistency: store the absent record's time in the institution's tz.
      const currentTime = localTime(now, inst.timezone || "UTC");

      if (inst.skip_weekends) {
        const weekday = new Intl.DateTimeFormat("en-US", {
          timeZone: inst.timezone,
          weekday: "short",
        }).format(now);
        if (weekday === "Sun" || weekday === "Sat") {
          results.push(`${inst.id}: weekend — skipped`);
          continue;
        }
      }

      // Fetch all holidays for this institution and match in code: non-recurring
      // holidays match by full date range; recurring holidays match by month/day
      // (year ignored), so "25 Dec" entered once applies every year.
      const { data: holidays } = await supabase
        .from("holidays")
        .select("label, start_date, end_date, recurring")
        .eq("institution_id", inst.id);

      const todayMMDD = todayInTz.slice(5); // "MM-DD"
      const holiday = (holidays || []).find((h) => {
        if (!h.recurring) {
          return h.start_date <= todayInTz && todayInTz <= h.end_date;
        }
        const startMMDD = h.start_date.slice(5);
        const endMMDD = h.end_date.slice(5);
        if (startMMDD <= endMMDD) {
          return startMMDD <= todayMMDD && todayMMDD <= endMMDD;
        }
        return todayMMDD >= startMMDD || todayMMDD <= endMMDD;
      });

      if (holiday) {
        results.push(`${inst.id}: holiday (${holiday.label}) — skipped`);
        continue;
      }

      const { data: period } = await supabase
        .from("periods")
        .select("id, start_date, end_date")
        .eq("institution_id", inst.id)
        .eq("status", "active")
        .maybeSingle();

      if (period) {
        if (period.start_date && todayInTz < period.start_date) {
          results.push(`${inst.id}: before period start — skipped`);
          continue;
        }
        if (period.end_date && todayInTz > period.end_date) {
          results.push(`${inst.id}: after period end — skipped`);
          continue;
        }
      }

      const trackedTypes: string[] = [];
      if (inst.track_students) trackedTypes.push("student");
      if (inst.track_staff) trackedTypes.push("staff");

      if (trackedTypes.length === 0) {
        results.push(`${inst.id}: no member types tracked — skipped`);
        continue;
      }

      const { data: members, error: membersError } = await supabase
        .from("members")
        .select("id, device_id, member_type")
        .eq("institution_id", inst.id)
        .eq("status", "active")
        .in("member_type", trackedTypes);

      if (membersError || !members || members.length === 0) {
        results.push(`${inst.id}: no active tracked members`);
        continue;
      }

      const studentScanType =
        inst.student_scan_mode === "time_in_out" ? "time_in" : "present";
      const staffScanType =
        inst.staff_scan_mode === "time_in_out" ? "time_in" : "present";

      function scanTypeFor(memberType: string): "present" | "time_in" {
        return memberType === "staff" ? staffScanType : studentScanType;
      }

      const { data: presentRecords, error: presentError } = await supabase
        .from("attendance")
        .select("member_id, scan_type")
        .eq("institution_id", inst.id)
        .eq("date", todayInTz)
        .eq("status", "present");

      if (presentError) {
        results.push(
          `${inst.id}: error reading present records — ${presentError.message}`
        );
        continue;
      }

      const presentSet = new Set(
        (presentRecords || []).map((r) => `${r.member_id}:${r.scan_type}`)
      );

      const absentRecords = members
        .filter((m) => {
          const expected = scanTypeFor(m.member_type);
          return !presentSet.has(`${m.id}:${expected}`);
        })
        .map((m) => ({
          member_id: m.id,
          period_id: period?.id ?? null,
          device_id: m.device_id,
          institution_id: inst.id,
          date: todayInTz,
          time: currentTime,
          status: "absent",
          scan_type: scanTypeFor(m.member_type),
          scan_id: null,
        }));

      if (absentRecords.length === 0) {
        results.push(`${inst.id}: all tracked members present`);
        continue;
      }

      // M4: upsert with ignoreDuplicates so the job is idempotent. A re-run, or a
      // member who already has a row for (member_id, date, scan_type), no longer
      // aborts the entire institution's batch — conflicting rows are skipped.
      const { error: insertError } = await supabase
        .from("attendance")
        .upsert(absentRecords, {
          onConflict: "member_id,date,scan_type",
          ignoreDuplicates: true,
        });

      if (insertError) {
        results.push(`${inst.id}: insert error — ${insertError.message}`);
      } else {
        results.push(`${inst.id}: marked ${absentRecords.length} absent`);
      }
    }

    return json({ results });
  } catch (e) {
    return json({ error: `Internal error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});

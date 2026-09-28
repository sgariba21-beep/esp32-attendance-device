// Club-mode scan handling (CLUB-MODE-PLAN.md, Phase 2).
//
// A club takes attendance per MEETING, not per day. A scan is resolved into
// the meeting whose window contains the scan's own timestamp, via the
// public.resolve_meeting() RPC — so an offline scan flushed days later still
// lands in the meeting it was taken in, not whichever one is open now.
//
// Response contract with the device (firmware >= 1.10.0, unchanged):
//   200 + scan_type  -> OLED shows PRESENT / TIME IN / TIME OUT
//   200, no scan_type -> OLED shows NOT LOGGED (an intentional "ignored")
//   4xx              -> OLED shows ERROR and counts the scan as LOST
//   5xx              -> device keeps the scan queued and retries
// So "no meeting open" is a 200 with code "no_meeting_open", never a 4xx, and
// a failed meeting lookup is a 500 so the scan is retried rather than lost.
// Firmware >= 1.11.0 shows code "no_meeting_open" as NO MEETING.
//
// Ad-hoc meetings (Phase 4, plan §8 B): the session-master finger opens and
// closes a meeting at the device, online or offline. The device names the
// meeting itself (meeting_ref) and every message about it carries that ref
// and the open time — the open / close events and each scan taken during it —
// so whichever reaches the server first creates it (public.device_meeting_event),
// in any order, any number of times.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** A device meeting ref: 4-64 of [A-Za-z0-9-], as meetings.device_ref's CHECK. */
export function isMeetingRef(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9-]{4,64}$/.test(v);
}

export type MeetingRef = { ref: string; openedAt: Date };

export type ClubInstitution = {
  track_students: boolean;
  track_staff: boolean;
  student_scan_mode: string;
  staff_scan_mode: string;
  track_lateness: boolean;
  late_grace_minutes: number | null;
  track_early_leaving: boolean;
  early_leave_grace_minutes: number | null;
};

export type ClubMeeting = {
  id: string;
  origin: "scheduled" | "device";
  starts_at: string;
  ends_at: string | null;
};

type ScanType = "present" | "time_in" | "time_out";
type Punctuality = "on_time" | "late" | "early_leave" | null;

export type ClubScanResult = { status: number; body: Record<string, unknown> };

const minuteOf = (ms: number) => Math.floor(ms / 60_000);

/**
 * Punctuality for a club scan, measured against the MEETING's own start / end
 * (not the institution-wide expected times) with the institution's grace
 * settings. Whole-minute granularity, matching the daily path: a scan inside
 * the cutoff minute is still on time. Ad-hoc (device) meetings have no
 * scheduled start or end to be late against, so they are never judged.
 */
export function clubPunctuality(
  scanType: ScanType,
  instant: Date,
  meeting: ClubMeeting,
  inst: ClubInstitution,
): Punctuality {
  if (meeting.origin !== "scheduled") return null;

  if (scanType === "time_out") {
    if (!inst.track_early_leaving || !meeting.ends_at) return null;
    const cutoff = Date.parse(meeting.ends_at) - (inst.early_leave_grace_minutes ?? 0) * 60_000;
    return minuteOf(instant.getTime()) < minuteOf(cutoff) ? "early_leave" : "on_time";
  }

  if (!inst.track_lateness) return null;
  const cutoff = Date.parse(meeting.starts_at) + (inst.late_grace_minutes ?? 0) * 60_000;
  return minuteOf(instant.getTime()) > minuteOf(cutoff) ? "late" : "on_time";
}

export async function handleClubScan(
  supabase: SupabaseClient,
  args: {
    institution_id: string;
    institution: ClubInstitution;
    authenticatedDeviceId: string | null;
    sid: string;
    scan_id: string;
    instant: Date;
    date: string; // local, institution timezone
    time: string; // local "HH:MM:SS"
    meetingRef?: MeetingRef | null; // the device's ad-hoc meeting, if the scan was taken in one
  },
): Promise<ClubScanResult> {
  const { institution_id, institution, authenticatedDeviceId, sid, scan_id, instant, date, time } = args;
  const meetingRef = args.meetingRef ?? null;

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, device_id, member_type")
    .eq("sid", sid)
    .eq("institution_id", institution_id)
    .eq("status", "active")
    .single();

  if (memberError || !member) {
    return { status: 404, body: { error: "Member not found" } };
  }

  const isStaff = member.member_type === "staff";
  if (isStaff ? !institution.track_staff : !institution.track_students) {
    return { status: 200, body: { message: "Member type not tracked — scan ignored" } };
  }

  // The authenticated device (per-device-secret path), else the member's own
  // device (legacy shared-secret path).
  const effectiveDeviceId: string | null = authenticatedDeviceId ?? member.device_id;

  // A scan carrying its ad-hoc meeting's ref goes through resolve_device_scan,
  // which creates that meeting if this scan beat its open event here, and
  // prefers it; anything else resolves by timestamp alone. Refs only count on
  // the per-device-secret path, where the device is authenticated.
  const { data: meetings, error: resolveError } = meetingRef && authenticatedDeviceId
    ? await supabase.rpc("resolve_device_scan", {
      p_institution_id: institution_id,
      p_device_id: authenticatedDeviceId,
      p_at: instant.toISOString(),
      p_ref: meetingRef.ref,
      p_opened_at: meetingRef.openedAt.toISOString(),
    })
    : await supabase.rpc("resolve_meeting", {
      p_institution_id: institution_id,
      p_device_id: effectiveDeviceId,
      p_at: instant.toISOString(),
    });

  if (resolveError) {
    // Transient: 500 keeps the scan queued on the device for a retry.
    return { status: 500, body: { error: `Meeting lookup failed: ${resolveError.message}` } };
  }

  const meeting = (meetings as ClubMeeting[] | null)?.[0];
  if (!meeting) {
    return { status: 200, body: { message: "No meeting open — scan ignored", code: "no_meeting_open" } };
  }

  const scanMode = isStaff ? institution.staff_scan_mode : institution.student_scan_mode;
  let scan_type: ScanType;

  if (scanMode === "time_in_out") {
    const { data: existing } = await supabase
      .from("attendance")
      .select("scan_type, status")
      .eq("member_id", member.id)
      .eq("meeting_id", meeting.id)
      .in("scan_type", ["time_in", "time_out"]);

    // Only "present" rows are real scans; an "absent" row is a close-sweep
    // placeholder and must not count as a completed time_in / time_out.
    const hasTimeIn = existing?.some((r) => r.scan_type === "time_in" && r.status === "present") ?? false;
    const hasTimeOut = existing?.some((r) => r.scan_type === "time_out" && r.status === "present") ?? false;

    if (hasTimeIn && hasTimeOut) {
      return { status: 200, body: { message: "Already fully logged for this meeting — scan ignored" } };
    }
    scan_type = hasTimeIn ? "time_out" : "time_in";
  } else {
    scan_type = "present";
  }

  const punctuality = clubPunctuality(scan_type, instant, meeting, institution);

  const { error: insertError } = await supabase.from("attendance").insert({
    member_id: member.id,
    period_id: null,
    device_id: effectiveDeviceId,
    institution_id,
    meeting_id: meeting.id,
    date,
    time,
    status: "present",
    scan_type,
    scan_id,
    punctuality,
  });

  if (!insertError) {
    return { status: 200, body: { message: "Attendance logged", scan_type, meeting_id: meeting.id } };
  }
  if (insertError.code !== "23505") {
    return { status: 500, body: { error: insertError.message } };
  }

  // Conflict on (meeting_id, member_id, scan_type) or on scan_id. Either a
  // genuine repeat (incl. a device retry after a lost ack), or a late offline
  // scan landing after the close sweep already wrote an absent placeholder.
  // Only the latter is overwritten.
  const { data: conflicting } = await supabase
    .from("attendance")
    .select("id, status")
    .eq("meeting_id", meeting.id)
    .eq("member_id", member.id)
    .eq("scan_type", scan_type)
    .maybeSingle();

  if (conflicting && conflicting.status === "absent") {
    const { error: updateError } = await supabase
      .from("attendance")
      .update({
        device_id: effectiveDeviceId,
        date, // the placeholder carries the meeting's start date; the scan's is truer
        time,
        status: "present",
        scan_id,
        punctuality,
      })
      .eq("id", conflicting.id);

    if (updateError) {
      if (updateError.code === "23505") {
        return { status: 200, body: { message: "Duplicate scan ignored" } };
      }
      return { status: 500, body: { error: updateError.message } };
    }
    return {
      status: 200,
      body: { message: "Attendance logged (overwrote absent placeholder)", scan_type, meeting_id: meeting.id },
    };
  }

  return { status: 200, body: { message: "Duplicate scan ignored" } };
}

/**
 * A session-master open / close of the device's ad-hoc meeting. Idempotent:
 * the device may deliver it late, twice, or after scans that already created
 * the meeting. A close carries the device's own close time (press, or its
 * idle / midnight rule), which only ever moves the meeting's end earlier.
 */
export async function handleMeetingEvent(
  supabase: SupabaseClient,
  args: { deviceId: string; action: string; ref: string; openedAt: Date; at: Date },
): Promise<ClubScanResult> {
  const { deviceId, action, ref, openedAt, at } = args;
  if (action !== "open" && action !== "close") {
    return { status: 400, body: { error: "Unknown meeting_action" } };
  }

  const { data, error } = await supabase.rpc("device_meeting_event", {
    p_device_id: deviceId,
    p_ref: ref,
    p_opened_at: openedAt.toISOString(),
    p_closed_at: action === "close" ? at.toISOString() : null,
  });
  if (error) {
    // Transient: 500 keeps the event queued on the device for a retry.
    return { status: 500, body: { error: `Meeting event failed: ${error.message}` } };
  }

  // NULL (all-null row) when the device is not in an active club.
  const meeting = data as { id: string | null; status: string | null } | null;
  if (!meeting?.id) {
    return { status: 200, body: { message: "Meeting event ignored", code: "meeting_ignored" } };
  }
  // The message names the meeting's resulting state, not the action: a late
  // replayed open of an already-closed meeting leaves it closed.
  return {
    status: 200,
    body: {
      message: `Meeting ${action} applied — meeting is ${meeting.status}`,
      meeting_id: meeting.id,
      meeting_status: meeting.status,
    },
  };
}

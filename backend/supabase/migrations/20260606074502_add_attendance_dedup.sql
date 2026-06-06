alter table attendance
  add constraint attendance_sid_date_unique unique (sid, date);
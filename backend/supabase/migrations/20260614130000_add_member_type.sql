-- Task 11: add member_type to members
-- Allows institutions to classify members as student, staff, or generic member.
-- Default 'member' is safe for all existing rows.
alter table public.members
  add column member_type text not null
    default 'member'
    check (member_type in ('student', 'staff', 'member'));

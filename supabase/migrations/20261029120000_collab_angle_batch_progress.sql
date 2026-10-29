-- Live progress of the batch that is running, as the audit machine reports it:
-- {step, steps, label, videos_judged, videos_total, seconds_since_activity}.
-- Written by collab-angles-sync on every poll, read by collab-angles so the
-- screen can say "step 4 of 6, 3 of 5 videos judged" instead of a bare estimate.
-- Additive and nullable. Both functions treat a missing column as "no detail",
-- so deploying them before this is applied changes nothing.
alter table public.collab_angle_batches
  add column if not exists last_progress jsonb;

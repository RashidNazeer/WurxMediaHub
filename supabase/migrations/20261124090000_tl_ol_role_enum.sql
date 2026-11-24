-- ============================================================================
-- TWO NEW ROLES: TL (team lead) and OL (operations lead).
--
-- THIS MIGRATION ONLY ADDS THE ENUM LABELS, for the same reason as
-- 20260902090000 and 20261105090000: a value added by `alter type ... add value`
-- cannot be used in the transaction that added it, so everything that names
-- them is in the next file.
--
-- NAMED `team_lead` AND `ops_lead`, NOT `affiliate_team_lead` / `operations_lead`.
-- Those two already exist (2026-09-02) as READ-ONLY Paid Collabs roles with
-- real logins on them. Re-meaning a role that people already sign in with would
-- change their access without anyone deciding it, so the new roles are new
-- labels and the old two are left exactly as they were.
--
--   team_lead   TL: full Paid Collabs access (read AND write) for the brands
--               assigned to them, and nothing else. Brand-scoped in the
--               database, not in the screen.
--   ops_lead    OL: complete admin access to every brand. Staff, the same reach
--               as Ads Manager.
--
-- SAFE BY CONSTRUCTION: every role test in this database is an allow-list, so a
-- role named nowhere reads and writes nothing.
-- ============================================================================

alter type public.app_role add value if not exists 'team_lead';
alter type public.app_role add value if not exists 'ops_lead';

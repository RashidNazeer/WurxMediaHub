-- ============================================================================
-- APC VIEWER: a read-only account that sees only the brands it is assigned.
--
-- THIS MIGRATION ONLY ADDS THE ENUM LABEL, for the same reason as
-- 20260902090000: a value added by `alter type ... add value` cannot be used in
-- the transaction that added it, so everything that names it is in the next
-- file.
--
-- NAMED `apc_viewer`, NOT `apc`. Paid Collabs already has its own role called
-- `apc` (inside WurxBase's capability model, with edit rights). Two meanings of
-- one word on a permissions boundary is how somebody grants the wrong one.
--
-- SAFE BY CONSTRUCTION: every role test in this database is an allow-list
-- (see 20260902090000), so a role named nowhere reads and writes nothing.
-- ============================================================================

alter type public.app_role add value if not exists 'apc_viewer';

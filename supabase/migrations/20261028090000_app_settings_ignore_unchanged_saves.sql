-- wurxbase.app_settings: a save that changes nothing must change nothing.
--
-- WHY. The settings row is ONE row for the whole team, and every open WurxBase session subscribes to it. The app saved the values it had
-- just loaded (a fetch put them in state as new arrays, an effect saw "a change" and upserted the same values), the update was broadcast
-- to every session, every session fetched and saved again, and so on for ever. Found 2026-10-27 in the usage numbers: 6.5 million reads
-- and 2.7 million writes of this one row in the last 90 days, 26 writes a second at the moment of looking, and the organisation's
-- Realtime messages (6M of 2M), egress (21.8 GB of 5 GB) and log ingestion (12 GB of 1 GB) all several times over their limits.
--
-- WHAT. Postgres ships a trigger function for exactly this, suppress_redundant_updates_trigger(): when an UPDATE would write a row
-- identical to the one it replaces, the update is skipped, so there is no new row version, no WAL record and nothing for Realtime to
-- broadcast. An upsert whose values are the ones already stored is therefore silent, and the loop cannot sustain itself even if some
-- other client (or an older cached copy of the app) still saves what it just loaded. A real change is untouched: it differs, so it is
-- written and broadcast as before.
--
-- The trigger is named with a leading "a_" so it runs before any other BEFORE UPDATE trigger that might one day touch a column (there is
-- none today: the table has id, brand_order, hidden_brands, custom_brands and hired_by_team only). The app-side fix is in
-- src/vendor/wurxbase/App.jsx and settingsSync.js (the app stops saving what it loaded); this is the second, independent layer.
--
-- TO UNDO: drop trigger a_ignore_unchanged_saves on wurxbase.app_settings;   (no data is created, changed or removed by this file)

create trigger a_ignore_unchanged_saves
  before update on wurxbase.app_settings
  for each row execute function suppress_redundant_updates_trigger();

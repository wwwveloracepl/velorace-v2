-- Wiele PDF list startowych ogólnych na jeden wyścig.
CREATE TABLE IF NOT EXISTS race_startlist_combined_files (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  label           TEXT NOT NULL DEFAULT '',
  storage_path    TEXT,
  file_url        TEXT,
  file_name       TEXT,
  uploaded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_race_startlist_combined_files_race
  ON race_startlist_combined_files(race_id);

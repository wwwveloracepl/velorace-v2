-- Własne grupy kategorii z jedną listą startową (PDF).
CREATE TABLE IF NOT EXISTS race_startlist_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  storage_path    TEXT,
  file_url        TEXT,
  file_name       TEXT,
  uploaded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_race_startlist_groups_race
  ON race_startlist_groups(race_id);

CREATE TABLE IF NOT EXISTS race_startlist_group_categories (
  group_id        UUID NOT NULL REFERENCES race_startlist_groups(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES race_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_race_startlist_group_categories_category
  ON race_startlist_group_categories(category_id);

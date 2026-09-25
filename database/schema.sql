-- ============================================================
--  VeloRace — schemat bazy danych (Neon / PostgreSQL)
--  Wklej do: Neon Console → SQL Editor → Run
-- ============================================================

-- ── Rozszerzenia ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";,
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUM types ───────────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
  'rider',          -- zawodnik
  'coach',          -- trener
  'judge_line',     -- sędzia liniowy / trasy
  'judge_chief',    -- sędzia główny
  'commissaire',    -- komisarz techniczny
  'race_office',    -- biuro zawodów
  'organizer',      -- organizator
  'speaker',        -- speaker / komentator
  'admin'           -- administrator platformy
);

CREATE TYPE race_status AS ENUM (
  'draft',          -- szkic (niewidoczny)
  'published',      -- opublikowany
  'registration_open',
  'registration_closed',
  'live',
  'finished',
  'cancelled'
);

CREATE TYPE race_type AS ENUM (
  'road', 'criterium', 'gravel', 'mountain', 'track', 'cyclocross'
);

CREATE TYPE registration_status AS ENUM (
  'pending',        -- oczekuje na płatność
  'confirmed',      -- opłacony, potwierdzony
  'withdrawn',      -- wycofany przed startem
  'dns',            -- did not start
  'dnf',            -- did not finish
  'dq'              -- zdyskwalifikowany
);

CREATE TYPE incident_type AS ENUM (
  'crash', 'withdrawal', 'mechanical', 'penalty', 'dq', 'info'
);

CREATE TYPE doc_type AS ENUM (
  'regulation', 'startlist', 'map', 'results_pdf', 'other'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'paid', 'refunded', 'failed'
);

-- ============================================================
--  TABELE
-- ============================================================

-- ── users ─────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,                        -- null jeśli tylko OAuth
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  phone           TEXT,
  birth_date      DATE,
  license_number  TEXT UNIQUE,                 -- nr licencji PZKol
  club            TEXT,
  nationality     CHAR(2) DEFAULT 'PL',
  role            user_role NOT NULL DEFAULT 'rider',
  avatar_url      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email       ON users(email);
CREATE INDEX idx_users_license     ON users(license_number);
CREATE INDEX idx_users_role        ON users(role);
CREATE INDEX idx_users_name        ON users(last_name, first_name);

-- ── organizers ────────────────────────────────────────────────
CREATE TABLE organizers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  short_name      TEXT,
  logo_url        TEXT,
  website         TEXT,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- kto zarządza którą organizacją
CREATE TABLE organizer_members (
  organizer_id    UUID REFERENCES organizers(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  is_owner        BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (organizer_id, user_id)
);

-- ── races ─────────────────────────────────────────────────────
CREATE TABLE races (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organizer_id        UUID REFERENCES organizers(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,    -- url-friendly, np. "tour-de-silesia-2025-e1"
  edition_year        SMALLINT,
  race_type           race_type NOT NULL DEFAULT 'road',
  status              race_status NOT NULL DEFAULT 'draft',
  race_date           DATE NOT NULL,
  race_time_start     TIME,
  city                TEXT NOT NULL,
  region              TEXT,
  country             CHAR(2),
  distance_km         NUMERIC(6,2),
  elevation_gain_m    INT,
  max_elevation_m     INT,
  lap_count           SMALLINT,
  laps_distance_km    NUMERIC(5,2),
  spots_total         INT,
  entry_fee_pln       NUMERIC(8,2),
  description         TEXT,
  registration_opens  TIMESTAMPTZ,
  registration_closes TIMESTAMPTZ,
  gpx_url             TEXT,
  cover_image_url     TEXT,
  results_pdf_slot_mode TEXT CHECK (results_pdf_slot_mode IS NULL OR results_pdf_slot_mode IN ('category', 'wave')),
  regulation_storage_path TEXT,
  regulation_file_url   TEXT,
  regulation_file_name TEXT,
  regulation_uploaded_at TIMESTAMPTZ,
  startlist_storage_path TEXT,
  startlist_file_url   TEXT,
  startlist_file_name TEXT,
  startlist_uploaded_at TIMESTAMPTZ,
  results_combined_storage_path TEXT,
  results_combined_file_url   TEXT,
  results_combined_file_name TEXT,
  results_combined_uploaded_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_races_date     ON races(race_date);
CREATE INDEX idx_races_status   ON races(status);
CREATE INDEX idx_races_slug     ON races(slug);

-- globalny słownik kategorii (PZKol) — bez FK do race_categories
CREATE TABLE category_templates (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  gender          CHAR(1) NULL,
  birth_year_min  SMALLINT NULL,
  birth_year_max  SMALLINT NULL,
  display_order   SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_category_templates_order ON category_templates(display_order);

-- kategorie startowe w wyścigu
CREATE TABLE race_categories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,               -- np. "Elita", "Masters 30+", "U23"
  min_age         SMALLINT,
  max_age         SMALLINT,
  gender          CHAR(1),                     -- 'M', 'F', NULL = open
  entry_fee_pln   NUMERIC(8,2),
  spots_total     INT,
  bib_start       INT,                         -- pierwsza numeracja startowa
  display_order   SMALLINT DEFAULT 0,
  distance_km       NUMERIC(6,2),              -- nadpisuje races.distance_km (NULL = z wyścigu)
  lap_count         SMALLINT,                  -- nadpisuje races.lap_count
  laps_distance_km  NUMERIC(5,2)               -- nadpisuje races.laps_distance_km
);

-- Fale startu: wspólna godzina + wiele kategorii; liczba okrążeń nadal w race_categories.lap_count
CREATE TABLE race_start_waves (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  start_time      TIME NOT NULL,
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_race_start_waves_race ON race_start_waves(race_id);

CREATE TABLE race_start_wave_categories (
  wave_id         UUID NOT NULL REFERENCES race_start_waves(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES race_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (wave_id, category_id)
);

CREATE UNIQUE INDEX idx_race_start_wave_categories_one_wave_per_category
  ON race_start_wave_categories(category_id);

-- Własne grupy kategorii z jedną listą startową (PDF)
CREATE TABLE race_startlist_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  storage_path    TEXT,
  file_url        TEXT,
  file_name       TEXT,
  uploaded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_race_startlist_groups_race ON race_startlist_groups(race_id);

CREATE TABLE race_startlist_group_categories (
  group_id        UUID NOT NULL REFERENCES race_startlist_groups(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES race_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, category_id)
);

CREATE INDEX idx_race_startlist_group_categories_category
  ON race_startlist_group_categories(category_id);

-- Wiele PDF list startowych ogólnych na jeden wyścig
CREATE TABLE race_startlist_combined_files (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  label           TEXT NOT NULL DEFAULT '',
  storage_path    TEXT,
  file_url        TEXT,
  file_name       TEXT,
  uploaded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_race_startlist_combined_files_race ON race_startlist_combined_files(race_id);

-- Wiele PDF wyników łącznych (ogólnych) na jeden wyścig
CREATE TABLE race_results_combined_files (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  label           TEXT NOT NULL DEFAULT '',
  storage_path    TEXT,
  file_url        TEXT,
  file_name       TEXT,
  uploaded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_race_results_combined_files_race ON race_results_combined_files(race_id);

-- Własne grupy kategorii z jednym PDF wyników
CREATE TABLE race_results_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  storage_path    TEXT,
  file_url        TEXT,
  file_name       TEXT,
  uploaded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_race_results_groups_race ON race_results_groups(race_id);

CREATE TABLE race_results_group_categories (
  group_id        UUID NOT NULL REFERENCES race_results_groups(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES race_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, category_id)
);

CREATE INDEX idx_race_results_group_categories_category
  ON race_results_group_categories(category_id);

-- ── registrations ─────────────────────────────────────────────
CREATE TABLE registrations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id             UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id         UUID REFERENCES race_categories(id) ON DELETE SET NULL,
  status              registration_status NOT NULL DEFAULT 'pending',
  bib_number          INT,
  registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at        TIMESTAMPTZ,
  withdrawn_at        TIMESTAMPTZ,
  withdrawal_reason   TEXT,
  notes               TEXT,                    -- notatki biura zawodów
  UNIQUE (race_id, user_id)
);

CREATE INDEX idx_reg_race   ON registrations(race_id);
CREATE INDEX idx_reg_user   ON registrations(user_id);
CREATE INDEX idx_reg_status ON registrations(status);
CREATE INDEX idx_reg_bib    ON registrations(race_id, bib_number);

-- ── payments ──────────────────────────────────────────────────
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id     UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount_pln          NUMERIC(8,2) NOT NULL,
  status              payment_status NOT NULL DEFAULT 'pending',
  provider            TEXT DEFAULT 'przelewy24',  -- 'przelewy24' | 'stripe'
  provider_order_id   TEXT,
  provider_session_id TEXT,
  paid_at             TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_registration ON payments(registration_id);
CREATE INDEX idx_payments_provider     ON payments(provider_order_id);

-- ── results ───────────────────────────────────────────────────
CREATE TABLE results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  category_id     UUID REFERENCES race_categories(id) ON DELETE SET NULL,
  bib_number      INT,
  position_overall INT,
  position_cat    INT,
  finish_time     INTERVAL,                    -- np. '03:21:44'
  gap_to_leader   INTERVAL,
  avg_speed_kmh   NUMERIC(5,2),
  status          registration_status NOT NULL DEFAULT 'confirmed',
  chip_time       INTERVAL,
  gun_time        INTERVAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_results_race     ON results(race_id);
CREATE INDEX idx_results_user     ON results(user_id);
CREATE INDEX idx_results_position ON results(race_id, position_overall);

-- ── live_timing ───────────────────────────────────────────────
-- Aktualizowane w czasie rzeczywistym podczas wyścigu
CREATE TABLE live_timing (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  bib_number      INT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  position        INT,
  elapsed_time    INTERVAL,
  gap_to_leader   INTERVAL,
  current_km      NUMERIC(6,2),
  current_lap     SMALLINT,
  avg_speed_kmh   NUMERIC(5,2),
  status          registration_status DEFAULT 'confirmed',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (race_id, bib_number)
);
CREATE INDEX idx_live_race     ON live_timing(race_id);
CREATE INDEX idx_live_position ON live_timing(race_id, position);

-- ── incidents ────────────────────────────────────────────────
CREATE TABLE incidents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  reported_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  incident_type   incident_type NOT NULL,
  km_position     NUMERIC(6,2),
  description     TEXT NOT NULL,
  affected_bibs   INT[],                       -- tablica numerów startowych
  is_public       BOOLEAN NOT NULL DEFAULT TRUE,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incidents_race ON incidents(race_id);
CREATE INDEX idx_incidents_time ON incidents(occurred_at);

-- ── documents ─────────────────────────────────────────────────
CREATE TABLE documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id         UUID REFERENCES races(id) ON DELETE CASCADE,
  organizer_id    UUID REFERENCES organizers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  doc_type        doc_type NOT NULL,
  file_url        TEXT NOT NULL,
  file_size_mb    NUMERIC(6,2),
  is_public       BOOLEAN NOT NULL DEFAULT TRUE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_race ON documents(race_id);

-- ── rankings ──────────────────────────────────────────────────
CREATE TABLE ranking_seasons (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year            SMALLINT NOT NULL UNIQUE,
  name            TEXT NOT NULL,              -- np. "Sezon 2025"
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  started_at      DATE,
  ended_at        DATE
);

CREATE TABLE ranking_points (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id       UUID NOT NULL REFERENCES ranking_seasons(id) ON DELETE CASCADE,
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES race_categories(id),
  points          INT NOT NULL DEFAULT 0,
  position        INT,
  awarded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, race_id, user_id)
);

CREATE INDEX idx_rp_season ON ranking_points(season_id, user_id);
CREATE INDEX idx_rp_user   ON ranking_points(user_id);

-- ranking view — suma punktów na sezon
CREATE VIEW ranking_individual AS
SELECT
  rp.season_id,
  rs.year,
  u.id AS user_id,
  u.first_name || ' ' || u.last_name AS rider_name,
  u.club,
  SUM(rp.points) AS total_points,
  COUNT(*) AS races_counted,
  COUNT(*) FILTER (WHERE rp.position = 1) AS wins,
  COUNT(*) FILTER (WHERE rp.position <= 3) AS podiums,
  RANK() OVER (PARTITION BY rp.season_id ORDER BY SUM(rp.points) DESC) AS position
FROM ranking_points rp
JOIN users u ON u.id = rp.user_id
JOIN ranking_seasons rs ON rs.id = rp.season_id
GROUP BY rp.season_id, rs.year, u.id, u.first_name, u.last_name, u.club;

-- ── race_staff ────────────────────────────────────────────────
-- przypisanie ról do wyścigu (sędzia, komisarz itp.)
CREATE TABLE race_staff (
  race_id         UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            user_role NOT NULL,
  notes           TEXT,
  PRIMARY KEY (race_id, user_id, role)
);

-- ── notifications ─────────────────────────────────────────────
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  race_id         UUID REFERENCES races(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  type            TEXT,                        -- 'incident', 'result', 'registration', 'info'
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user ON notifications(user_id, is_read);

-- ============================================================
--  TRIGGERS — auto updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_races_updated_at
  BEFORE UPDATE ON races
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
--  SEED DATA — przykładowe dane testowe
-- ============================================================

-- Organizator
INSERT INTO organizers (id, name, short_name, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Silesia Cycling Club', 'SCC', 'kontakt@scc.pl');

-- Szablony kategorii PZKol (słownik)
INSERT INTO category_templates (name, gender, birth_year_min, birth_year_max, display_order) VALUES
  ('Żak', 'M', NULL, NULL, 0),
  ('Żakini', 'K', NULL, NULL, 1),
  ('Młodzik', 'M', NULL, NULL, 2),
  ('Młodziczka', 'K', NULL, NULL, 3),
  ('Junior Młodszy', 'M', NULL, NULL, 4),
  ('Juniorka Młodsza', 'K', NULL, NULL, 5),
  ('Junior', 'M', NULL, NULL, 6),
  ('Juniorka', 'K', NULL, NULL, 7),
  ('Orlik', 'M', NULL, NULL, 8),
  ('Orliczka', 'K', NULL, NULL, 9),
  ('Elita Mężczyzn', 'M', NULL, NULL, 10),
  ('Elita Kobiet', 'K', NULL, NULL, 11),
  ('Masters M20', 'M', NULL, NULL, 12),
  ('Masters M30', 'M', NULL, NULL, 13),
  ('Masters M40', 'M', NULL, NULL, 14),
  ('Masters M50', 'M', NULL, NULL, 15),
  ('Masters M60', 'M', NULL, NULL, 16),
  ('Masters M70', 'M', NULL, NULL, 17),
  ('Masters K30', 'K', NULL, NULL, 18),
  ('Masters K40', 'K', NULL, NULL, 19),
  ('Masters K50', 'K', NULL, NULL, 20),
  ('Masters K55', 'K', NULL, NULL, 21),
  ('Masters K60', 'K', NULL, NULL, 22);

-- Sezon
INSERT INTO ranking_seasons (id, year, name, is_active, started_at) VALUES
  ('00000000-0000-0000-0000-000000000010', 2025, 'Sezon 2025', TRUE, '2025-03-01');

-- Użytkownicy testowi
INSERT INTO users (id, email, first_name, last_name, license_number, club, role) VALUES
  ('00000000-0000-0000-0000-000000000101', 'admin@velorace.pl',   'Admin',   'VeloRace',  NULL,           NULL,           'admin'),
  ('00000000-0000-0000-0000-000000000102', 'kowalski@test.pl',    'Marek',   'Kowalski',  'PL-2024-0042', 'Team Silesia', 'rider'),
  ('00000000-0000-0000-0000-000000000103', 'nowak@test.pl',       'Piotr',   'Nowak',     'PL-2024-0017', 'Kraków Velo',  'rider'),
  ('00000000-0000-0000-0000-000000000104', 'wisniewski@test.pl',  'Tomasz',  'Wiśniewski','PL-2024-0008', 'WKK Wrocław',  'rider'),
  ('00000000-0000-0000-0000-000000000105', 'sedzia@test.pl',      'Jan',     'Sędzia',    NULL,           NULL,           'judge_chief'),
  ('00000000-0000-0000-0000-000000000106', 'biuro@test.pl',       'Anna',    'Biuro',     NULL,           NULL,           'race_office');

-- Organizator techniczny panelu (stały UUID — PLATFORM_ORGANIZER_DEFAULT_ID w aplikacji)
INSERT INTO organizers (id, name, short_name, email, is_active) VALUES
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Platforma VeloRace', 'VeloRace', 'kontakt@velorace.pl', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  email = EXCLUDED.email,
  is_active = EXCLUDED.is_active;

INSERT INTO organizer_members (organizer_id, user_id, is_owner)
SELECT
  'a0000000-0000-4000-8000-000000000001'::uuid,
  u.id,
  true
FROM users u
WHERE u.role = 'admin'::user_role
  AND u.is_active = true
ON CONFLICT (organizer_id, user_id) DO UPDATE SET
  is_owner = EXCLUDED.is_owner;

-- Wyścigi
INSERT INTO races (id, organizer_id, name, slug, race_type, status, race_date, city, distance_km, elevation_gain_m, max_elevation_m, spots_total, entry_fee_pln, registration_closes) VALUES
  (
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000001',
    'Tour de Silesia — Etap 1', 'tour-de-silesia-2025-e1',
    'road', 'registration_open', '2025-05-12', 'Katowice',
    148, 2800, 512, 250, 80.00, '2025-05-09 23:59:00'
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000001',
    'Kraków Grand Prix', 'krakow-grand-prix-2025',
    'road', 'registration_open', '2025-05-18', 'Kraków',
    92, 1100, 380, 200, 80.00, '2025-05-15 23:59:00'
  ),
  (
    '00000000-0000-0000-0000-000000000203',
    '00000000-0000-0000-0000-000000000001',
    'Dolnośląski Criterium', 'dolnoslaski-criterium-2025',
    'criterium', 'published', '2025-05-25', 'Wrocław',
    60, 300, 148, 180, 60.00, '2025-05-22 23:59:00'
  );

-- Kategorie
INSERT INTO race_categories (race_id, name, min_age, max_age, gender, bib_start, display_order) VALUES
  ('00000000-0000-0000-0000-000000000201', 'Elita',     19, NULL, 'M', 1,   0),
  ('00000000-0000-0000-0000-000000000201', 'U23',       17, 22,   'M', 101, 1),
  ('00000000-0000-0000-0000-000000000202', 'Masters 30+', 30, NULL, NULL, 1, 0),
  ('00000000-0000-0000-0000-000000000202', 'Masters 40+', 40, NULL, NULL, 101,1),
  ('00000000-0000-0000-0000-000000000203', 'Open',      18, NULL, NULL, 1,  0);

-- Zapisy testowe
INSERT INTO registrations (race_id, user_id, status, bib_number, confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000102', 'confirmed', 42,  NOW()),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000103', 'confirmed', 17,  NOW()),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000104', 'confirmed', 8,   NOW());

-- Wyniki — Kraków Classic (historyczny)
-- (w prawdziwej aplikacji po zakończeniu wyścigu generowane automatycznie)

-- Dokumenty
INSERT INTO documents (race_id, name, doc_type, file_url, file_size_mb) VALUES
  ('00000000-0000-0000-0000-000000000201', 'Regulamin — Tour de Silesia 2025',   'regulation', '/docs/regulamin-tour-silesia-2025.pdf', 1.2),
  ('00000000-0000-0000-0000-000000000201', 'Mapa trasy — Etap 1',                'map',        '/docs/mapa-tour-silesia-e1.pdf',        3.8),
  ('00000000-0000-0000-0000-000000000202', 'Regulamin — Kraków Grand Prix 2025', 'regulation', '/docs/regulamin-krakow-gp-2025.pdf',    0.9);

-- Personel wyścigu
INSERT INTO race_staff (race_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000105', 'judge_chief'),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000106', 'race_office');

-- ============================================================
--  PRZYDATNE ZAPYTANIA (przykłady)
-- ============================================================

-- Nadchodzące wyścigi z liczbą zapisanych:
-- SELECT r.name, r.race_date, r.city, r.spots_total,
--        COUNT(reg.id) FILTER (WHERE reg.status = 'confirmed') AS taken
-- FROM races r
-- LEFT JOIN registrations reg ON reg.race_id = r.id
-- WHERE r.race_date >= CURRENT_DATE
-- GROUP BY r.id ORDER BY r.race_date;

-- Ranking indywidualny 2025:
-- SELECT * FROM ranking_individual WHERE year = 2025 ORDER BY position;

-- Lista startowa wyścigu:
-- SELECT reg.bib_number, u.first_name, u.last_name, u.club, cat.name AS category
-- FROM registrations reg
-- JOIN users u ON u.id = reg.user_id
-- LEFT JOIN race_categories cat ON cat.id = reg.category_id
-- WHERE reg.race_id = '<race_id>' AND reg.status = 'confirmed'
-- ORDER BY reg.bib_number;

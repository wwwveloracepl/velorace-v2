-- Lista startowa łączna (PDF), przypisana bezpośrednio do wyścigu.
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS startlist_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS startlist_file_url TEXT,
  ADD COLUMN IF NOT EXISTS startlist_file_name TEXT,
  ADD COLUMN IF NOT EXISTS startlist_uploaded_at TIMESTAMPTZ;

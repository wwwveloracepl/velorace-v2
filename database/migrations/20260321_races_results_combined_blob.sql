-- Wyniki zbiorcze (PDF), jeden plik na cały wyścig — bez podziału na kategorie/fale.
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS results_combined_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS results_combined_file_url TEXT,
  ADD COLUMN IF NOT EXISTS results_combined_file_name TEXT,
  ADD COLUMN IF NOT EXISTS results_combined_uploaded_at TIMESTAMPTZ;

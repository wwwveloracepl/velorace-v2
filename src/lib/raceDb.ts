import { RACES } from '@/lib/data'
import type { Race, RaceStatus } from '@/lib/types'
import { getDb } from '@/lib/db'
import type { ResultsPdfSlotMode } from '@/lib/results'
import { resultsBlobSlugSegment } from '@/lib/results'

export type { ResultsPdfSlotMode } from '@/lib/results'

/** Zgodnie z seedem `database/seed-platform-organizer.sql` */
export const PLATFORM_ORGANIZER_DEFAULT_ID = 'a0000000-0000-4000-8000-000000000001'

export const DB_RACE_TYPES = [
  'road',
  'criterium',
  'gravel',
  'mountain',
  'track',
  'cyclocross',
] as const

export const DB_RACE_STATUSES = [
  'draft',
  'published',
  'registration_open',
  'registration_closed',
  'live',
  'finished',
  'cancelled',
] as const

export type DbRaceType = (typeof DB_RACE_TYPES)[number]
export type DbRaceStatus = (typeof DB_RACE_STATUSES)[number]

let mergeCache: { races: Race[]; at: number } | null = null
const MERGE_TTL_MS = 4000

export function invalidateRacesMergeCache() {
  mergeCache = null
}

async function autoMarkPastRacesFinished(sql: ReturnType<typeof getDb>): Promise<void> {
  if (!sql) return
  await sql`
    UPDATE races
    SET status = 'finished'::race_status, updated_at = NOW()
    WHERE race_date < CURRENT_DATE
      AND status <> 'finished'::race_status
      AND status <> 'cancelled'::race_status
  `
}

function mapDbStatusToApp(db: string): RaceStatus {
  switch (db) {
    case 'registration_open':
      return 'open'
    case 'registration_closed':
      return 'closed'
    case 'live':
      return 'live'
    case 'finished':
      return 'finished'
    case 'draft':
    case 'published':
      return 'soon'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'soon'
  }
}

function rowToRace(row: Record<string, unknown>): Race {
  const desc = row.description != null ? String(row.description) : ''
  const categoryLine = desc.split('\n')[0]?.trim() ?? ''
  const lapCount = row.lap_count != null && row.lap_count !== '' ? Number(row.lap_count) : undefined
  const lapsDistanceKm =
    row.laps_distance_km != null && row.laps_distance_km !== '' ? Number(row.laps_distance_km) : undefined
  const entryFeePln = row.entry_fee_pln != null && row.entry_fee_pln !== '' ? Number(row.entry_fee_pln) : undefined
  return {
    id: String(row.id),
    name: String(row.name),
    date: String(row.race_date).slice(0, 10),
    city: String(row.city),
    distance: Number(row.distance_km ?? 0),
    category: categoryLine.slice(0, 200) || String(row.race_type ?? ''),
    status: mapDbStatusToApp(String(row.status)),
    spotsTotal: Number(row.spots_total ?? 200),
    spotsTaken: Number(row.spots_taken ?? 0),
    elevationGain: row.elevation_gain_m != null ? Number(row.elevation_gain_m) : undefined,
    maxElevation: row.max_elevation_m != null ? Number(row.max_elevation_m) : undefined,
    type: (row.race_type as Race['type']) ?? 'road',
    lapCount: lapCount != null && Number.isFinite(lapCount) ? lapCount : undefined,
    lapsDistanceKm: lapsDistanceKm != null && Number.isFinite(lapsDistanceKm) ? lapsDistanceKm : undefined,
    entryFeePln: entryFeePln != null && Number.isFinite(entryFeePln) ? entryFeePln : undefined,
    regulationUrl: row.regulation_file_url != null ? String(row.regulation_file_url) : undefined,
    startlistUrl: row.startlist_file_url != null ? String(row.startlist_file_url) : undefined,
    combinedResultsUrl:
      row.results_combined_file_url != null ? String(row.results_combined_file_url) : undefined,
  }
}

export async function listRacesFromDatabase(): Promise<Race[]> {
  const sql = getDb()
  if (!sql) return []

  await autoMarkPastRacesFinished(sql)
  invalidateRacesMergeCache()

  const rows = await sql`
    SELECT
      r.id::text AS id,
      r.name,
      r.race_date::text AS race_date,
      r.city,
      r.region,
      r.country,
      COALESCE(fc.cdist, r.distance_km) AS distance_km,
      r.elevation_gain_m,
      r.max_elevation_m,
      r.race_type::text AS race_type,
      r.status::text AS status,
      r.spots_total,
      r.description,
      COALESCE(fc.claps, r.lap_count) AS lap_count,
      COALESCE(fc.clapsdist, r.laps_distance_km) AS laps_distance_km,
      COALESCE(fc.cfee, r.entry_fee_pln) AS entry_fee_pln,
      r.regulation_file_url,
      r.startlist_file_url,
      r.results_combined_file_url,
      0::int AS spots_taken
    FROM races r
    LEFT JOIN LATERAL (
      SELECT
        rc.distance_km AS cdist,
        rc.lap_count AS claps,
        rc.laps_distance_km AS clapsdist,
        rc.entry_fee_pln AS cfee
      FROM race_categories rc
      WHERE rc.race_id = r.id
      ORDER BY rc.display_order NULLS LAST, rc.name NULLS LAST
      LIMIT 1
    ) fc ON true
    ORDER BY r.race_date ASC, r.name ASC
  `
  return (rows as Record<string, unknown>[]).map(rowToRace)
}

/**
 * Wyścigi na stronę główną:
 * - wszystkie lata
 * - tylko daty od dzisiaj (nadchodzące)
 * - bez statusu `draft`
 * - status mapowany do `RaceStatus` (open/soon/live/finished)
 */
export async function listHomePageRacesCurrentYear(): Promise<Race[]> {
  const sql = getDb()
  if (!sql) return []

  try {
    await autoMarkPastRacesFinished(sql)
    invalidateRacesMergeCache()

    const rows = await sql`
      SELECT
        r.id::text AS id,
        r.name,
        r.race_date::text AS race_date,
        r.city,
        r.region,
        r.country,
        COALESCE(fc.cdist, r.distance_km) AS distance_km,
        r.elevation_gain_m,
        r.max_elevation_m,
        r.race_type::text AS race_type,
        r.status::text AS status,
        r.spots_total,
        r.description,
        COALESCE(fc.claps, r.lap_count) AS lap_count,
        COALESCE(fc.clapsdist, r.laps_distance_km) AS laps_distance_km,
        COALESCE(fc.cfee, r.entry_fee_pln) AS entry_fee_pln,
        r.regulation_file_url,
        r.startlist_file_url,
        r.results_combined_file_url,
        0::int AS spots_taken
      FROM races r
      LEFT JOIN LATERAL (
        SELECT
          rc.distance_km AS cdist,
          rc.lap_count AS claps,
          rc.laps_distance_km AS clapsdist,
          rc.entry_fee_pln AS cfee
        FROM race_categories rc
        WHERE rc.race_id = r.id
        ORDER BY rc.display_order NULLS LAST, rc.name NULLS LAST
        LIMIT 1
      ) fc ON true
      WHERE r.race_date >= CURRENT_DATE
        AND r.status <> 'draft'::race_status
        AND r.status <> 'finished'::race_status
        AND r.status <> 'cancelled'::race_status
      ORDER BY r.race_date ASC, r.name ASC
    `
    return (rows as Record<string, unknown>[]).map(rowToRace)
  } catch (e) {
    console.error('[raceDb:listHomePageRacesCurrentYear]', e)
    return []
  }
}

/** Zakończone wyścigi (wszystkie lata), od najnowszego. */
export async function listHomePageFinishedRacesCurrentYear(): Promise<Race[]> {
  const sql = getDb()
  if (!sql) return []

  try {
    await autoMarkPastRacesFinished(sql)
    invalidateRacesMergeCache()

    const rows = await sql`
      SELECT
        r.id::text AS id,
        r.name,
        r.race_date::text AS race_date,
        r.city,
        r.region,
        r.country,
        COALESCE(fc.cdist, r.distance_km) AS distance_km,
        r.elevation_gain_m,
        r.max_elevation_m,
        r.race_type::text AS race_type,
        r.status::text AS status,
        r.spots_total,
        r.description,
        COALESCE(fc.claps, r.lap_count) AS lap_count,
        COALESCE(fc.clapsdist, r.laps_distance_km) AS laps_distance_km,
        COALESCE(fc.cfee, r.entry_fee_pln) AS entry_fee_pln,
        r.regulation_file_url,
        r.startlist_file_url,
        r.results_combined_file_url,
        0::int AS spots_taken
      FROM races r
      LEFT JOIN LATERAL (
        SELECT
          rc.distance_km AS cdist,
          rc.lap_count AS claps,
          rc.laps_distance_km AS clapsdist,
          rc.entry_fee_pln AS cfee
        FROM race_categories rc
        WHERE rc.race_id = r.id
        ORDER BY rc.display_order NULLS LAST, rc.name NULLS LAST
        LIMIT 1
      ) fc ON true
      WHERE (
          r.status = 'finished'::race_status
          OR r.status = 'cancelled'::race_status
          OR r.race_date < CURRENT_DATE
        )
        AND r.status <> 'draft'::race_status
      ORDER BY r.race_date DESC, r.name ASC
    `
    return (rows as Record<string, unknown>[]).map(rowToRace)
  } catch (e) {
    console.error('[raceDb:listHomePageFinishedRacesCurrentYear]', e)
    return []
  }
}

/** Pojedynczy wyścig z bazy `races` (z fallbackiem metryk z 1. kategorii). */
export async function getRaceByIdFromDatabase(raceId: string): Promise<Race | null> {
  const sql = getDb()
  if (!sql) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raceId)) {
    return null
  }

  await autoMarkPastRacesFinished(sql)
  invalidateRacesMergeCache()

  const rows = await sql`
    SELECT
      r.id::text AS id,
      r.name,
      r.race_date::text AS race_date,
      r.city,
      r.region,
      r.country,
      COALESCE(fc.cdist, r.distance_km) AS distance_km,
      r.elevation_gain_m,
      r.max_elevation_m,
      r.race_type::text AS race_type,
      r.status::text AS status,
      r.spots_total,
      r.description,
      COALESCE(fc.claps, r.lap_count) AS lap_count,
      COALESCE(fc.clapsdist, r.laps_distance_km) AS laps_distance_km,
      COALESCE(fc.cfee, r.entry_fee_pln) AS entry_fee_pln,
      r.regulation_file_url,
      r.startlist_file_url,
      r.results_combined_file_url,
      0::int AS spots_taken
    FROM races r
    LEFT JOIN LATERAL (
      SELECT
        rc.distance_km AS cdist,
        rc.lap_count AS claps,
        rc.laps_distance_km AS clapsdist,
        rc.entry_fee_pln AS cfee
      FROM race_categories rc
      WHERE rc.race_id = r.id
      ORDER BY rc.display_order NULLS LAST, rc.name NULLS LAST
      LIMIT 1
    ) fc ON true
    WHERE r.id = ${raceId}::uuid
    LIMIT 1
  `

  const row = rows[0] as Record<string, unknown> | undefined
  return row ? rowToRace(row) : null
}

export type PublicRaceCategoryDetail = {
  id: string
  name: string
  distanceKm: number | null
  lapCount: number | null
  lapDistanceKm: number | null
  entryFeePln: number | null
  waveStartTime: string | null
}

export async function getRaceCategoryDetails(raceId: string): Promise<PublicRaceCategoryDetail[]> {
  const sql = getDb()
  if (!sql) return []
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raceId)) {
    return []
  }

  const rows = await sql`
    SELECT
      rc.id::text AS id,
      rc.name,
      rc.distance_km,
      rc.lap_count,
      rc.laps_distance_km,
      rc.entry_fee_pln,
      w.start_time::text AS wave_start_time
    FROM race_categories rc
    LEFT JOIN race_start_wave_categories wsc ON wsc.category_id = rc.id
    LEFT JOIN race_start_waves w ON w.id = wsc.wave_id
    WHERE rc.race_id = ${raceId}::uuid
    ORDER BY rc.display_order NULLS LAST, rc.name NULLS LAST
  `

  return (rows as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    distanceKm: r.distance_km != null && r.distance_km !== '' ? Number(r.distance_km) : null,
    lapCount: r.lap_count != null && r.lap_count !== '' ? Number(r.lap_count) : null,
    lapDistanceKm: r.laps_distance_km != null && r.laps_distance_km !== '' ? Number(r.laps_distance_km) : null,
    entryFeePln: r.entry_fee_pln != null && r.entry_fee_pln !== '' ? Number(r.entry_fee_pln) : null,
    waveStartTime: r.wave_start_time != null && String(r.wave_start_time).trim() ? String(r.wave_start_time) : null,
  }))
}

export async function listRacesMerged(): Promise<Race[]> {
  if (mergeCache && Date.now() - mergeCache.at < MERGE_TTL_MS) {
    return mergeCache.races
  }
  const fromDb = await listRacesFromDatabase()
  const merged = [...RACES, ...fromDb]
  mergeCache = { races: merged, at: Date.now() }
  return merged
}

export async function isAllowedResultsRaceId(raceId: string): Promise<boolean> {
  const id = raceId.trim()
  if (!id) return false

  const sql = getDb()
  if (sql) {
    try {
      const rows = await sql`
        SELECT 1
        FROM races
        WHERE id = ${id}::uuid
        LIMIT 1
      `
      if (rows.length > 0) return true
    } catch {
      // Fallback do listy scalonej (np. gdy ID nie jest UUID albo DB chwilowo niedostępna).
    }
  }

  const merged = await listRacesMerged()
  return merged.some(r => r.id === id)
}

export async function getDefaultResultsRaceId(): Promise<string> {
  const merged = await listRacesMerged()
  return merged[0]?.id ?? ''
}

export function slugifyBase(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

/** Domyślny slug (URL / segment folderu R2): `YYYYMMDD-nazwa` — data na początku ułatwia przeglądanie bucketu. */
export function defaultAutoRaceSlug(name: string, raceDateYyyyMmDd: string): string {
  const d = raceDateYyyyMmDd.trim().replace(/-/g, '')
  const core = slugifyBase(name)
  const raw = core ? `${d}-${core}` : d
  return raw.replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export async function getPlatformOrganizerId(): Promise<string | null> {
  const env = process.env.PLATFORM_ORGANIZER_ID?.trim()
  if (env) return env

  const sql = getDb()
  if (!sql) return null

  const rows = await sql`
    SELECT id::text AS id FROM organizers
    WHERE id = ${PLATFORM_ORGANIZER_DEFAULT_ID}::uuid
       OR name = 'Platforma VeloRace'
    LIMIT 1
  `
  const r = rows[0] as { id: string } | undefined
  return r?.id ?? null
}

export type AdminRaceInsertPayload = {
  name: string
  slug?: string
  race_date: string
  race_time_start?: string | null
  city: string
  region?: string | null
  country?: string | null
  race_type: DbRaceType
  status: DbRaceStatus
  /** Wymagane tylko gdy brak kategorii — fallback w `races`. Przy kategoriach ignorowane (NULL w DB). */
  distance_km?: number | null
  elevation_gain_m?: number | null
  max_elevation_m?: number | null
  lap_count?: number | null
  laps_distance_km?: number | null
  spots_total?: number | null
  edition_year?: number | null
  entry_fee_pln?: number | null
  description?: string | null
  registration_opens?: string | null
  registration_closes?: string | null
  gpx_url?: string | null
  cover_image_url?: string | null
}

export type AdminRaceCategoryInput = {
  /** Przy aktualizacji: istniejący wiersz `race_categories`. Przy tworzeniu: pomijane. */
  id?: string | null
  name: string
  min_age?: number | null
  max_age?: number | null
  gender?: 'M' | 'F' | null
  entry_fee_pln?: number | null
  spots_total?: number | null
  bib_start?: number | null
  display_order: number
  distance_km?: number | null
  lap_count?: number | null
  laps_distance_km?: number | null
}

/** Indeksy 0-based w tablicy kategorii wysłanej w tym samym żądaniu co wyścig. */
export type AdminStartWaveInput = {
  start_time: string
  category_indexes: number[]
}

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = s.trim()
  return t === '' ? null : t
}

function parseTs(isoLocal: string | null | undefined): string | null {
  const v = emptyToNull(isoLocal ?? null)
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function waveStartTimeSortValue(startTime: string | null | undefined): number {
  const v = emptyToNull(startTime ?? null)
  if (!v) return Number.POSITIVE_INFINITY
  const m = v.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return Number.POSITIVE_INFINITY
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return Number.POSITIVE_INFINITY
  }
  return hh * 60 + mm
}

function sortStartWavesChronologically(startWaves: AdminStartWaveInput[]): AdminStartWaveInput[] {
  return [...startWaves]
    .map((w, index) => ({ w, index }))
    .sort((a, b) => {
      const da = waveStartTimeSortValue(a.w.start_time)
      const db = waveStartTimeSortValue(b.w.start_time)
      if (da !== db) return da - db
      return a.index - b.index
    })
    .map(x => x.w)
}

function normalizeGender(g: AdminRaceCategoryInput['gender']): string | null {
  if (g === 'M' || g === 'F') return g
  return null
}

export async function insertAdminRace(
  payload: AdminRaceInsertPayload,
  categories: AdminRaceCategoryInput[] = [],
  startWaves: AdminStartWaveInput[] = [],
): Promise<{ id: string; slug: string; categoryIds: string[] }> {
  const sql = getDb()
  if (!sql) {
    throw new Error('Brak DATABASE_URL — skonfiguruj Neon i zmienne środowiskowe.')
  }

  const organizerId = await getPlatformOrganizerId()
  if (!organizerId) {
    throw new Error(
      'Brak organizatora Platforma VeloRace. Uruchom npm run db:seed-platform-organizer (lub database/seed-platform-organizer.sql) albo ustaw PLATFORM_ORGANIZER_ID.',
    )
  }

  const sortedStartWaves = sortStartWavesChronologically(startWaves)

  if (!DB_RACE_TYPES.includes(payload.race_type)) {
    throw new Error('Nieprawidłowy typ trasy.')
  }
  if (!DB_RACE_STATUSES.includes(payload.status)) {
    throw new Error('Nieprawidłowy status wyścigu.')
  }

  for (const c of categories) {
    if (!c.name?.trim()) {
      throw new Error('Każda kategoria musi mieć nazwę.')
    }
  }

  const useCategoryMetrics = categories.length > 0
  if (!useCategoryMetrics) {
    if (payload.distance_km == null || !Number.isFinite(payload.distance_km)) {
      throw new Error('Bez kategorii startowych podaj dystans wyścigu (km).')
    }
  }
  if (sortedStartWaves.length > 0 && !useCategoryMetrics) {
    throw new Error('Fale startu wymagają co najmniej jednej kategorii startowej.')
  }
  if (sortedStartWaves.length > 0) {
    const usedIdx = new Set<number>()
    for (const wav of sortedStartWaves) {
      if (wav.category_indexes.length === 0) {
        throw new Error('Każda fala startu musi zawierać co najmniej jedną kategorię.')
      }
      for (const idx of wav.category_indexes) {
        if (idx < 0 || idx >= categories.length) {
          throw new Error('Nieprawidłowy indeks kategorii w fali startu.')
        }
        if (usedIdx.has(idx)) {
          throw new Error('Kategoria może należeć tylko do jednej fali startu.')
        }
        usedIdx.add(idx)
      }
    }
  }

  let slug = emptyToNull(payload.slug) || defaultAutoRaceSlug(payload.name, payload.race_date)

  const name = payload.name.trim()
  const city = payload.city.trim()
  const countryRaw = emptyToNull(payload.country)
  const country = countryRaw ? countryRaw.toUpperCase().slice(0, 2) : null
  const region = emptyToNull(payload.region)
  const raceDate = payload.race_date.trim()
  const timeRaw = emptyToNull(payload.race_time_start)
  const raceTimeStart = timeRaw && /^\d{1,2}:\d{2}/.test(timeRaw) ? `${timeRaw.slice(0, 5)}:00` : null

  const spotsTotal =
    payload.spots_total != null && Number.isFinite(payload.spots_total)
      ? Math.max(1, Math.floor(payload.spots_total))
      : null
  const editionYear =
    payload.edition_year != null && Number.isFinite(payload.edition_year)
      ? Math.min(32767, Math.max(0, Math.floor(payload.edition_year)))
      : null

  let distanceKm: number | null
  let lapCount: number | null
  let lapsDist: number | null
  let entryFee: number | null

  if (useCategoryMetrics) {
    distanceKm = null
    lapCount = null
    lapsDist = null
    entryFee = null
  } else {
    distanceKm = payload.distance_km != null && Number.isFinite(payload.distance_km) ? payload.distance_km : null
    lapCount = payload.lap_count != null ? Math.floor(payload.lap_count) : null
    lapsDist = payload.laps_distance_km != null ? payload.laps_distance_km : null
    entryFee = payload.entry_fee_pln != null ? payload.entry_fee_pln : null
  }

  const elev = payload.elevation_gain_m != null ? Math.floor(payload.elevation_gain_m) : null
  const maxEl = payload.max_elevation_m != null ? Math.floor(payload.max_elevation_m) : null
  const description = emptyToNull(payload.description)
  const regOpen = parseTs(payload.registration_opens ?? null)
  const regClose = parseTs(payload.registration_closes ?? null)
  const gpxUrl = emptyToNull(payload.gpx_url)
  const coverUrl = emptyToNull(payload.cover_image_url)

  for (let attempt = 0; attempt < 8; attempt++) {
    let newRaceId: string | null = null
    try {
      const rows = await sql`
        INSERT INTO races (
          organizer_id,
          name,
          slug,
          edition_year,
          race_type,
          status,
          race_date,
          race_time_start,
          city,
          region,
          country,
          distance_km,
          elevation_gain_m,
          max_elevation_m,
          lap_count,
          laps_distance_km,
          spots_total,
          entry_fee_pln,
          description,
          registration_opens,
          registration_closes,
          gpx_url,
          cover_image_url
        )
        VALUES (
          ${organizerId}::uuid,
          ${name},
          ${slug},
          ${editionYear},
          ${payload.race_type}::race_type,
          ${payload.status}::race_status,
          ${raceDate}::date,
          ${raceTimeStart}::time,
          ${city},
          ${region},
          ${country},
          ${distanceKm},
          ${elev},
          ${maxEl},
          ${lapCount},
          ${lapsDist},
          ${spotsTotal},
          ${entryFee},
          ${description},
          ${regOpen}::timestamptz,
          ${regClose}::timestamptz,
          ${gpxUrl},
          ${coverUrl}
        )
        RETURNING id::text AS id, slug
      `
      const row = rows[0] as { id: string; slug: string }
      newRaceId = row.id

      let categoryIds: string[] = []
      try {
        for (let ci = 0; ci < categories.length; ci++) {
          const c = categories[ci]
          const cname = c.name.trim()
          const minAge = c.min_age != null && Number.isFinite(c.min_age) ? Math.floor(c.min_age) : null
          const maxAge = c.max_age != null && Number.isFinite(c.max_age) ? Math.floor(c.max_age) : null
          const gender = normalizeGender(c.gender)
          const cEntry = c.entry_fee_pln != null && Number.isFinite(c.entry_fee_pln) ? c.entry_fee_pln : null
          const cSpots = c.spots_total != null && Number.isFinite(c.spots_total) ? Math.floor(c.spots_total) : null
          const bibStart = c.bib_start != null && Number.isFinite(c.bib_start) ? Math.floor(c.bib_start) : null
          const dispBase = Number.isFinite(c.display_order) ? Math.floor(c.display_order) : ci
          const disp = Math.min(32767, Math.max(-32768, dispBase))
          const cDist = c.distance_km != null && Number.isFinite(c.distance_km) ? c.distance_km : null
          const cLaps = c.lap_count != null && Number.isFinite(c.lap_count) ? Math.floor(c.lap_count) : null
          const cLapsKm = c.laps_distance_km != null && Number.isFinite(c.laps_distance_km) ? c.laps_distance_km : null

          const cr = await sql`
            INSERT INTO race_categories (
              race_id,
              name,
              min_age,
              max_age,
              gender,
              entry_fee_pln,
              spots_total,
              bib_start,
              display_order,
              distance_km,
              lap_count,
              laps_distance_km
            )
            VALUES (
              ${newRaceId}::uuid,
              ${cname},
              ${minAge},
              ${maxAge},
              ${gender},
              ${cEntry},
              ${cSpots},
              ${bibStart},
              ${disp},
              ${cDist},
              ${cLaps},
              ${cLapsKm}
            )
            RETURNING id::text AS id
          `
          categoryIds.push(String((cr[0] as { id: string }).id))
        }

        for (let wi = 0; wi < sortedStartWaves.length; wi++) {
          const wav = sortedStartWaves[wi]
          const wtimeRaw = emptyToNull(wav.start_time)
          const waveTimeStart =
            wtimeRaw && /^\d{1,2}:\d{2}/.test(wtimeRaw) ? `${wtimeRaw.slice(0, 5)}:00` : null
          if (!waveTimeStart) {
            throw new Error('Nieprawidłowa godzina w fali startu.')
          }
          const waveRows = await sql`
            INSERT INTO race_start_waves (race_id, start_time, sort_order)
            VALUES (${newRaceId}::uuid, ${waveTimeStart}::time, ${wi})
            RETURNING id::text AS id
          `
          const waveId = String((waveRows[0] as { id: string }).id)
          for (const idx of wav.category_indexes) {
            const cid = categoryIds[idx]
            if (!cid) {
              throw new Error('Wewnętrzny błąd: brak ID kategorii dla fali startu.')
            }
            await sql`
              INSERT INTO race_start_wave_categories (wave_id, category_id)
              VALUES (${waveId}::uuid, ${cid}::uuid)
            `
          }
        }
      } catch (catErr) {
        if (newRaceId) {
          await sql`DELETE FROM races WHERE id = ${newRaceId}::uuid`
        }
        throw catErr
      }

      invalidateRacesMergeCache()
      return { id: row.id, slug: row.slug, categoryIds }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('unique') || msg.includes('slug') || msg.includes('23505')) {
        slug = `${slug}-${Date.now().toString(36)}`
        continue
      }
      throw e
    }
  }

  throw new Error('Nie udało się nadać unikalnego slug.')
}

export type AdminDbRaceListItem = {
  id: string
  name: string
  race_date: string
  city: string
  status: string
  slug: string
}

/**
 * Lista wyścigów z bazy do panelu „Edytuj wyścig”.
 * Jeśli `calendarYear` jest podany, filtruje po roku `race_date`; bez parametru zwraca wszystkie.
 */
export async function listAdminDatabaseRaces(calendarYear?: number | null): Promise<AdminDbRaceListItem[]> {
  const sql = getDb()
  if (!sql) return []
  if (calendarYear != null && (!Number.isFinite(calendarYear) || calendarYear < 1900 || calendarYear > 2100)) {
    throw new Error('Nieprawidłowy rok kalendarzowy.')
  }
  await autoMarkPastRacesFinished(sql)
  invalidateRacesMergeCache()

  const rows =
    calendarYear == null
      ? await sql`
          SELECT
            r.id::text AS id,
            r.name,
            to_char(r.race_date, 'YYYY-MM-DD') AS race_date,
            r.city,
            r.status::text AS status,
            r.slug
          FROM races r
          ORDER BY r.race_date DESC, r.name ASC
        `
      : await sql`
          SELECT
            r.id::text AS id,
            r.name,
            to_char(r.race_date, 'YYYY-MM-DD') AS race_date,
            r.city,
            r.status::text AS status,
            r.slug
          FROM races r
          WHERE EXTRACT(YEAR FROM r.race_date)::int = ${calendarYear}
          ORDER BY r.race_date DESC, r.name ASC
        `
  return (rows as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    name: String(r.name),
    race_date: String(r.race_date ?? '').slice(0, 10),
    city: String(r.city),
    status: String(r.status),
    slug: String(r.slug),
  }))
}

export type RaceResultsPdfSlot = { slot: number; label: string }

function waveTimeLabel(startTimeRaw: unknown): string {
  const s = startTimeRaw != null ? String(startTimeRaw) : ''
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s.slice(0, 8) || '—'
}

/**
 * Kontekst slotów PDF wyników: slug wyścigu, tryb zapisu w DB oraz lista etykiet (kategorie / fale).
 */
export async function getRaceResultsPdfContext(raceId: string): Promise<{
  slug: string
  raceYear: number
  resultsPdfSlotMode: ResultsPdfSlotMode | null
  effectiveMode: ResultsPdfSlotMode
  categorySlots: RaceResultsPdfSlot[]
  waveSlots: RaceResultsPdfSlot[]
} | null> {
  const sql = getDb()
  if (!sql) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raceId)) {
    return null
  }

  let metaRows: Awaited<ReturnType<typeof sql>>
  try {
    metaRows = await sql`
      SELECT slug, race_date::text AS race_date, results_pdf_slot_mode::text AS mode
      FROM races
      WHERE id = ${raceId}::uuid
      LIMIT 1
    `
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
    if (!msg.includes('results_pdf_slot_mode') || !msg.includes('column')) {
      throw err
    }
    // Fallback kompatybilny ze starszą bazą bez kolumny `results_pdf_slot_mode`.
    metaRows = await sql`
      SELECT slug, race_date::text AS race_date, NULL::text AS mode
      FROM races
      WHERE id = ${raceId}::uuid
      LIMIT 1
    `
  }
  if (!metaRows.length) return null
  const slug = String((metaRows[0] as { slug: string }).slug)
  const raceDate = String((metaRows[0] as { race_date?: string }).race_date ?? '')
  const raceYearRaw = Number.parseInt(raceDate.slice(0, 4), 10)
  const raceYear = Number.isInteger(raceYearRaw) && raceYearRaw >= 2000 ? raceYearRaw : new Date().getFullYear()
  const modeRaw = (metaRows[0] as { mode: string | null }).mode
  const resultsPdfSlotMode: ResultsPdfSlotMode | null =
    modeRaw === 'category' || modeRaw === 'wave' ? modeRaw : null

  const catRows = await sql`
    SELECT name
    FROM race_categories
    WHERE race_id = ${raceId}::uuid
    ORDER BY display_order NULLS LAST, name NULLS LAST
  `
  const categorySlots: RaceResultsPdfSlot[] = (catRows as { name: string }[]).map((r, i) => ({
    slot: i + 1,
    label: String(r.name ?? `Kategoria ${i + 1}`),
  }))

  const waveRows = await sql`
    SELECT w.id::text AS id, w.start_time::text AS start_time, w.sort_order
    FROM race_start_waves w
    WHERE w.race_id = ${raceId}::uuid
    ORDER BY w.start_time, w.sort_order
  `

  const waveSlots: RaceResultsPdfSlot[] = []
  for (let i = 0; i < (waveRows as { id: string; start_time: string }[]).length; i++) {
    const w = waveRows[i] as { id: string; start_time: string }
    const timeL = waveTimeLabel(w.start_time)
    const nameRows = await sql`
      SELECT rc.name
      FROM race_start_wave_categories wc
      JOIN race_categories rc ON rc.id = wc.category_id
      WHERE wc.wave_id = ${w.id}::uuid
      ORDER BY rc.display_order NULLS LAST, rc.name NULLS LAST
    `
    const names = (nameRows as { name: string }[]).map(r => String(r.name ?? '')).filter(Boolean)
    const label = names.length > 0 ? `${timeL} — ${names.join(', ')}` : `Fala ${i + 1} (${timeL})`
    waveSlots.push({ slot: i + 1, label })
  }

  let effectiveMode: ResultsPdfSlotMode = resultsPdfSlotMode ?? 'category'
  if (resultsPdfSlotMode === 'category' && categorySlots.length === 0 && waveSlots.length > 0) {
    effectiveMode = 'wave'
  } else if (resultsPdfSlotMode === 'wave' && waveSlots.length === 0 && categorySlots.length > 0) {
    effectiveMode = 'category'
  } else if (resultsPdfSlotMode == null) {
    if (categorySlots.length > 0) effectiveMode = 'category'
    else if (waveSlots.length > 0) effectiveMode = 'wave'
    else effectiveMode = 'category'
  }

  return { slug, raceYear, resultsPdfSlotMode, effectiveMode, categorySlots, waveSlots }
}

export async function updateRaceResultsPdfSlotMode(
  raceId: string,
  mode: ResultsPdfSlotMode,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sql = getDb()
  if (!sql) {
    return { ok: false, message: 'Brak DATABASE_URL.' }
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raceId)) {
    return { ok: false, message: 'Nieprawidłowy identyfikator wyścigu.' }
  }

  const ctx = await getRaceResultsPdfContext(raceId)
  if (!ctx) {
    return { ok: false, message: 'Wyścig nie istnieje.' }
  }
  if (mode === 'category' && ctx.categorySlots.length === 0) {
    return { ok: false, message: 'Brak zdefiniowanych kategorii — wybierz najpierw kategorie w edycji wyścigu.' }
  }
  if (mode === 'wave' && ctx.waveSlots.length === 0) {
    return { ok: false, message: 'Brak zdefiniowanych fal startu — ustaw fale w edycji wyścigu.' }
  }

  try {
    await sql`
      UPDATE races
      SET results_pdf_slot_mode = ${mode}, updated_at = NOW()
      WHERE id = ${raceId}::uuid
    `
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
    if (msg.includes('results_pdf_slot_mode') && msg.includes('column')) {
      return {
        ok: false,
        message:
          'Brakuje kolumny results_pdf_slot_mode w tabeli races. Uruchom migrację 20260209_races_results_pdf_slot_mode.sql.',
      }
    }
    throw err
  }
  invalidateRacesMergeCache()
  return { ok: true }
}

function formatTimeForInput(t: unknown): string {
  if (t == null || t === '') return ''
  const s = String(t)
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s.slice(0, 5)
}

function formatTsForDatetimeLocal(v: unknown): string {
  if (v == null || v === '') return ''
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function numOrEmpty(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ''
}

export type AdminRaceEditDetail = {
  id: string
  slug: string
  name: string
  race_date: string
  race_time_start: string
  city: string
  region: string
  country: string
  race_type: DbRaceType
  status: DbRaceStatus
  edition_year: string
  spots_total: string
  elevation_gain_m: string
  max_elevation_m: string
  distance_km: string
  lap_count: string
  laps_distance_km: string
  entry_fee_pln: string
  description: string
  registration_opens: string
  registration_closes: string
  gpx_url: string
  cover_image_url: string
  regulation_file_url: string
  regulation_file_name: string
  regulation_uploaded_at: string
  startlist_file_url: string
  startlist_file_name: string
  startlist_uploaded_at: string
  results_combined_file_url: string
  results_combined_file_name: string
  results_combined_uploaded_at: string
  categories: (AdminRaceCategoryInput & { id: string })[]
  startWaves: AdminStartWaveInput[]
}

export async function getAdminRaceForEdit(raceId: string): Promise<AdminRaceEditDetail | null> {
  const sql = getDb()
  if (!sql) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raceId)) {
    return null
  }

  await autoMarkPastRacesFinished(sql)
  invalidateRacesMergeCache()

  const raceRows = await sql`
    SELECT
      r.id::text AS id,
      r.slug,
      r.name,
      r.race_date::text AS race_date,
      r.race_time_start::text AS race_time_start,
      r.city,
      COALESCE(r.region, '') AS region,
      COALESCE(r.country::text, '') AS country,
      r.race_type::text AS race_type,
      r.status::text AS status,
      r.edition_year,
      r.spots_total,
      r.elevation_gain_m,
      r.max_elevation_m,
      r.distance_km,
      r.lap_count,
      r.laps_distance_km,
      r.entry_fee_pln,
      COALESCE(r.description, '') AS description,
      r.registration_opens,
      r.registration_closes,
      COALESCE(r.gpx_url, '') AS gpx_url,
      COALESCE(r.cover_image_url, '') AS cover_image_url,
      COALESCE(r.regulation_file_url, '') AS regulation_file_url,
      COALESCE(r.regulation_file_name, '') AS regulation_file_name,
      COALESCE(r.regulation_uploaded_at::text, '') AS regulation_uploaded_at,
      COALESCE(r.startlist_file_url, '') AS startlist_file_url,
      COALESCE(r.startlist_file_name, '') AS startlist_file_name,
      COALESCE(r.startlist_uploaded_at::text, '') AS startlist_uploaded_at,
      COALESCE(r.results_combined_file_url, '') AS results_combined_file_url,
      COALESCE(r.results_combined_file_name, '') AS results_combined_file_name,
      COALESCE(r.results_combined_uploaded_at::text, '') AS results_combined_uploaded_at
    FROM races r
    WHERE r.id = ${raceId}::uuid
    LIMIT 1
  `
  const rr = raceRows[0] as Record<string, unknown> | undefined
  if (!rr) return null

  const catRows = await sql`
    SELECT
      c.id::text AS id,
      c.name,
      c.min_age,
      c.max_age,
      c.gender::text AS gender,
      c.entry_fee_pln,
      c.spots_total,
      c.bib_start,
      c.display_order,
      c.distance_km,
      c.lap_count,
      c.laps_distance_km
    FROM race_categories c
    WHERE c.race_id = ${raceId}::uuid
    ORDER BY c.display_order NULLS LAST, c.name NULLS LAST
  `

  const categories: (AdminRaceCategoryInput & { id: string })[] = (catRows as Record<string, unknown>[]).map(
    (c, i) => ({
      id: String(c.id),
      name: String(c.name),
      min_age: c.min_age != null && c.min_age !== '' ? Number(c.min_age) : null,
      max_age: c.max_age != null && c.max_age !== '' ? Number(c.max_age) : null,
      gender: (() => {
        const gen = c.gender != null ? String(c.gender).trim() : ''
        return gen === 'M' || gen === 'F' ? gen : null
      })(),
      entry_fee_pln: c.entry_fee_pln != null && c.entry_fee_pln !== '' ? Number(c.entry_fee_pln) : null,
      spots_total: c.spots_total != null && c.spots_total !== '' ? Math.floor(Number(c.spots_total)) : null,
      bib_start: c.bib_start != null && c.bib_start !== '' ? Math.floor(Number(c.bib_start)) : null,
      display_order:
        c.display_order != null && c.display_order !== '' ? Math.floor(Number(c.display_order)) : i,
      distance_km: c.distance_km != null && c.distance_km !== '' ? Number(c.distance_km) : null,
      lap_count: c.lap_count != null && c.lap_count !== '' ? Math.floor(Number(c.lap_count)) : null,
      laps_distance_km:
        c.laps_distance_km != null && c.laps_distance_km !== '' ? Number(c.laps_distance_km) : null,
    }),
  )

  const idToIndex = new Map(categories.map((c, idx) => [c.id, idx]))

  let startWaves: AdminStartWaveInput[] = []
  try {
    const waveRows = await sql`
      SELECT w.id::text AS id, w.start_time::text AS start_time, w.sort_order
      FROM race_start_waves w
      WHERE w.race_id = ${raceId}::uuid
      ORDER BY w.start_time, w.sort_order
    `

    for (const w of waveRows as Record<string, unknown>[]) {
      const wid = String(w.id)
      const st = String(w.start_time ?? '')
      const wc = await sql`
        SELECT c.category_id::text AS id
        FROM race_start_wave_categories c
        WHERE c.wave_id = ${wid}::uuid
      `
      const category_indexes: number[] = []
      for (const row of wc as { id: string }[]) {
        const ix = idToIndex.get(row.id)
        if (ix !== undefined) category_indexes.push(ix)
      }
      category_indexes.sort((a, b) => a - b)
      if (category_indexes.length > 0) {
        startWaves.push({ start_time: st, category_indexes })
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/does not exist/i.test(msg) && /race_start_wave/i.test(msg)) {
      startWaves = []
    } else {
      throw e
    }
  }

  const race_type = String(rr.race_type) as DbRaceType
  const status = String(rr.status) as DbRaceStatus

  return {
    id: String(rr.id),
    slug: String(rr.slug),
    name: String(rr.name),
    race_date: String(rr.race_date).slice(0, 10),
    race_time_start: formatTimeForInput(rr.race_time_start),
    city: String(rr.city),
    region: String(rr.region ?? ''),
    country: String(rr.country ?? ''),
    race_type: DB_RACE_TYPES.includes(race_type) ? race_type : 'road',
    status: DB_RACE_STATUSES.includes(status) ? status : 'draft',
    edition_year: numOrEmpty(rr.edition_year),
    spots_total: numOrEmpty(rr.spots_total),
    elevation_gain_m: numOrEmpty(rr.elevation_gain_m),
    max_elevation_m: numOrEmpty(rr.max_elevation_m),
    distance_km: numOrEmpty(rr.distance_km),
    lap_count: numOrEmpty(rr.lap_count),
    laps_distance_km: numOrEmpty(rr.laps_distance_km),
    entry_fee_pln: numOrEmpty(rr.entry_fee_pln),
    description: String(rr.description ?? ''),
    registration_opens: formatTsForDatetimeLocal(rr.registration_opens),
    registration_closes: formatTsForDatetimeLocal(rr.registration_closes),
    gpx_url: String(rr.gpx_url ?? ''),
    cover_image_url: String(rr.cover_image_url ?? ''),
    regulation_file_url: String(rr.regulation_file_url ?? ''),
    regulation_file_name: String(rr.regulation_file_name ?? ''),
    regulation_uploaded_at: String(rr.regulation_uploaded_at ?? ''),
    startlist_file_url: String(rr.startlist_file_url ?? ''),
    startlist_file_name: String(rr.startlist_file_name ?? ''),
    startlist_uploaded_at: String(rr.startlist_uploaded_at ?? ''),
    results_combined_file_url: String(rr.results_combined_file_url ?? ''),
    results_combined_file_name: String(rr.results_combined_file_name ?? ''),
    results_combined_uploaded_at: String(rr.results_combined_uploaded_at ?? ''),
    categories,
    startWaves,
  }
}

export async function updateAdminRace(
  raceId: string,
  payload: AdminRaceInsertPayload,
  categories: AdminRaceCategoryInput[] = [],
  startWaves: AdminStartWaveInput[] = [],
): Promise<{ id: string; slug: string }> {
  const sql = getDb()
  if (!sql) {
    throw new Error('Brak DATABASE_URL — skonfiguruj Neon i zmienne środowiskowe.')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raceId)) {
    throw new Error('Nieprawidłowy identyfikator wyścigu.')
  }

  const exists = await sql`SELECT id::text FROM races WHERE id = ${raceId}::uuid LIMIT 1`
  if (!exists.length) {
    throw new Error('Wyścig nie istnieje.')
  }

  const sortedStartWaves = sortStartWavesChronologically(startWaves)

  if (!DB_RACE_TYPES.includes(payload.race_type)) {
    throw new Error('Nieprawidłowy typ trasy.')
  }
  if (!DB_RACE_STATUSES.includes(payload.status)) {
    throw new Error('Nieprawidłowy status wyścigu.')
  }

  for (const c of categories) {
    if (!c.name?.trim()) {
      throw new Error('Każda kategoria musi mieć nazwę.')
    }
  }

  const useCategoryMetrics = categories.length > 0
  if (!useCategoryMetrics) {
    if (payload.distance_km == null || !Number.isFinite(payload.distance_km)) {
      throw new Error('Bez kategorii startowych podaj dystans wyścigu (km).')
    }
  }
  if (sortedStartWaves.length > 0 && !useCategoryMetrics) {
    throw new Error('Fale startu wymagają co najmniej jednej kategorii startowej.')
  }
  if (sortedStartWaves.length > 0) {
    const usedIdx = new Set<number>()
    for (const wav of sortedStartWaves) {
      if (wav.category_indexes.length === 0) {
        throw new Error('Każda fala startu musi zawierać co najmniej jedną kategorię.')
      }
      for (const idx of wav.category_indexes) {
        if (idx < 0 || idx >= categories.length) {
          throw new Error('Nieprawidłowy indeks kategorii w fali startu.')
        }
        if (usedIdx.has(idx)) {
          throw new Error('Kategoria może należeć tylko do jednej fali startu.')
        }
        usedIdx.add(idx)
      }
    }
  }

  const name = payload.name.trim()
  const city = payload.city.trim()
  const countryRaw = emptyToNull(payload.country)
  const country = countryRaw ? countryRaw.toUpperCase().slice(0, 2) : null
  const region = emptyToNull(payload.region)
  const raceDate = payload.race_date.trim()
  const timeRaw = emptyToNull(payload.race_time_start)
  const raceTimeStart = timeRaw && /^\d{1,2}:\d{2}/.test(timeRaw) ? `${timeRaw.slice(0, 5)}:00` : null

  const spotsTotal =
    payload.spots_total != null && Number.isFinite(payload.spots_total)
      ? Math.max(1, Math.floor(payload.spots_total))
      : null
  const editionYear =
    payload.edition_year != null && Number.isFinite(payload.edition_year)
      ? Math.min(32767, Math.max(0, Math.floor(payload.edition_year)))
      : null

  let distanceKm: number | null
  let lapCount: number | null
  let lapsDist: number | null
  let entryFee: number | null

  if (useCategoryMetrics) {
    distanceKm = null
    lapCount = null
    lapsDist = null
    entryFee = null
  } else {
    distanceKm = payload.distance_km != null && Number.isFinite(payload.distance_km) ? payload.distance_km : null
    lapCount = payload.lap_count != null ? Math.floor(payload.lap_count) : null
    lapsDist = payload.laps_distance_km != null ? payload.laps_distance_km : null
    entryFee = payload.entry_fee_pln != null ? payload.entry_fee_pln : null
  }

  const elev = payload.elevation_gain_m != null ? Math.floor(payload.elevation_gain_m) : null
  const maxEl = payload.max_elevation_m != null ? Math.floor(payload.max_elevation_m) : null
  const description = emptyToNull(payload.description)
  const regOpen = parseTs(payload.registration_opens ?? null)
  const regClose = parseTs(payload.registration_closes ?? null)
  const gpxUrl = emptyToNull(payload.gpx_url)
  const coverUrl = emptyToNull(payload.cover_image_url)

  const curSlugRows = await sql`SELECT slug FROM races WHERE id = ${raceId}::uuid LIMIT 1`
  const currentSlug = String((curSlugRows[0] as { slug: string }).slug)

  let slug = emptyToNull(payload.slug) || defaultAutoRaceSlug(name, raceDate)
  if (!slug) slug = currentSlug

  let raceRowUpdated = false
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await sql`
        UPDATE races SET
          name = ${name},
          slug = ${slug},
          edition_year = ${editionYear},
          race_type = ${payload.race_type}::race_type,
          status = ${payload.status}::race_status,
          race_date = ${raceDate}::date,
          race_time_start = ${raceTimeStart}::time,
          city = ${city},
          region = ${region},
          country = ${country},
          distance_km = ${distanceKm},
          elevation_gain_m = ${elev},
          max_elevation_m = ${maxEl},
          lap_count = ${lapCount},
          laps_distance_km = ${lapsDist},
          spots_total = ${spotsTotal},
          entry_fee_pln = ${entryFee},
          description = ${description},
          registration_opens = ${regOpen}::timestamptz,
          registration_closes = ${regClose}::timestamptz,
          gpx_url = ${gpxUrl},
          cover_image_url = ${coverUrl},
          updated_at = NOW()
        WHERE id = ${raceId}::uuid
      `
      raceRowUpdated = true
      break
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('unique') || msg.includes('slug') || msg.includes('23505')) {
        slug = `${slug}-${Date.now().toString(36)}`
        continue
      }
      throw e
    }
  }
  if (!raceRowUpdated) {
    throw new Error('Nie udało się nadać unikalnego slug.')
  }

  await sql`DELETE FROM race_start_waves WHERE race_id = ${raceId}::uuid`

  const categoryIds: string[] = []
  const keptIds = new Set<string>()

  for (let ci = 0; ci < categories.length; ci++) {
    const c = categories[ci]
    const cname = c.name.trim()
    const minAge = c.min_age != null && Number.isFinite(c.min_age) ? Math.floor(c.min_age) : null
    const maxAge = c.max_age != null && Number.isFinite(c.max_age) ? Math.floor(c.max_age) : null
    const gender = normalizeGender(c.gender)
    const cEntry = c.entry_fee_pln != null && Number.isFinite(c.entry_fee_pln) ? c.entry_fee_pln : null
    const cSpots = c.spots_total != null && Number.isFinite(c.spots_total) ? Math.floor(c.spots_total) : null
    const bibStart = c.bib_start != null && Number.isFinite(c.bib_start) ? Math.floor(c.bib_start) : null
    const dispBase = Number.isFinite(c.display_order) ? Math.floor(c.display_order) : ci
    const disp = Math.min(32767, Math.max(-32768, dispBase))
    const cDist = c.distance_km != null && Number.isFinite(c.distance_km) ? c.distance_km : null
    const cLaps = c.lap_count != null && Number.isFinite(c.lap_count) ? Math.floor(c.lap_count) : null
    const cLapsKm = c.laps_distance_km != null && Number.isFinite(c.laps_distance_km) ? c.laps_distance_km : null

    const rawId = typeof c.id === 'string' ? c.id.trim() : ''
    const existingId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId) ? rawId : null

    if (existingId) {
      const chk = await sql`
        SELECT 1 FROM race_categories WHERE id = ${existingId}::uuid AND race_id = ${raceId}::uuid LIMIT 1
      `
      if (chk.length > 0) {
        await sql`
          UPDATE race_categories SET
            name = ${cname},
            min_age = ${minAge},
            max_age = ${maxAge},
            gender = ${gender},
            entry_fee_pln = ${cEntry},
            spots_total = ${cSpots},
            bib_start = ${bibStart},
            display_order = ${disp},
            distance_km = ${cDist},
            lap_count = ${cLaps},
            laps_distance_km = ${cLapsKm}
          WHERE id = ${existingId}::uuid AND race_id = ${raceId}::uuid
        `
        categoryIds.push(existingId)
        keptIds.add(existingId)
        continue
      }
    }

    const cr = await sql`
      INSERT INTO race_categories (
        race_id,
        name,
        min_age,
        max_age,
        gender,
        entry_fee_pln,
        spots_total,
        bib_start,
        display_order,
        distance_km,
        lap_count,
        laps_distance_km
      )
      VALUES (
        ${raceId}::uuid,
        ${cname},
        ${minAge},
        ${maxAge},
        ${gender},
        ${cEntry},
        ${cSpots},
        ${bibStart},
        ${disp},
        ${cDist},
        ${cLaps},
        ${cLapsKm}
      )
      RETURNING id::text AS id
    `
    const newId = String((cr[0] as { id: string }).id)
    categoryIds.push(newId)
    keptIds.add(newId)
  }

  const allCats = await sql`SELECT id::text AS id FROM race_categories WHERE race_id = ${raceId}::uuid`
  for (const row of allCats as { id: string }[]) {
    if (!keptIds.has(row.id)) {
      await sql`DELETE FROM race_categories WHERE id = ${row.id}::uuid`
    }
  }

  for (let wi = 0; wi < sortedStartWaves.length; wi++) {
    const wav = sortedStartWaves[wi]
    const wtimeRaw = emptyToNull(wav.start_time)
    const waveTimeStart =
      wtimeRaw && /^\d{1,2}:\d{2}/.test(wtimeRaw) ? `${wtimeRaw.slice(0, 5)}:00` : null
    if (!waveTimeStart) {
      throw new Error('Nieprawidłowa godzina w fali startu.')
    }
    const insWave = await sql`
      INSERT INTO race_start_waves (race_id, start_time, sort_order)
      VALUES (${raceId}::uuid, ${waveTimeStart}::time, ${wi})
      RETURNING id::text AS id
    `
    const waveId = String((insWave[0] as { id: string }).id)
    for (const idx of wav.category_indexes) {
      const cid = categoryIds[idx]
      if (!cid) {
        throw new Error('Wewnętrzny błąd: brak ID kategorii dla fali startu.')
      }
      await sql`
        INSERT INTO race_start_wave_categories (wave_id, category_id)
        VALUES (${waveId}::uuid, ${cid}::uuid)
      `
    }
  }

  const slugOutRows = await sql`SELECT slug FROM races WHERE id = ${raceId}::uuid LIMIT 1`
  const slugOut = String((slugOutRows[0] as { slug: string }).slug)

  invalidateRacesMergeCache()
  return { id: raceId, slug: slugOut }
}

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest } from '@/lib/serverAuth'
import { parseCategories, parseStartWaves } from '@/lib/adminRaceRequest'
import { jsonSafeClone } from '@/lib/jsonSafe'
import { deleteObjectsByPrefixes, hasObjectStoreConfig } from '@/lib/objectStore'
import { resultsRaceRootBlobPrefixCandidates } from '@/lib/results'
import { startlistsRaceRootBlobPrefix } from '@/lib/startlists'
import {
  DB_RACE_STATUSES,
  DB_RACE_TYPES,
  deleteAdminRace,
  getAdminRaceForEdit,
  updateAdminRace,
  type AdminRaceInsertPayload,
} from '@/lib/raceDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const id = typeof resolved?.id === 'string' ? resolved.id : ''

  if (!id?.trim()) {
    return NextResponse.json({ ok: false, message: 'Brak identyfikatora wyścigu.' }, { status: 400 })
  }

  try {
    const race = await getAdminRaceForEdit(id)
    if (!race) {
      return NextResponse.json({ ok: false, message: 'Nie znaleziono wyścigu.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, race: jsonSafeClone(race) })
  } catch (e) {
    console.error('[admin/races/[id] GET]', e)
    const isDev = process.env.NODE_ENV === 'development'
    const cause = e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown'
    return NextResponse.json(
      {
        ok: false,
        message: isDev ? `Nie udało się wczytać wyścigu: ${cause}` : 'Nie udało się wczytać wyścigu.',
      },
      { status: 500 },
    )
  }
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const id = typeof resolved?.id === 'string' ? resolved.id : ''
  if (!id.trim()) {
    return NextResponse.json({ ok: false, message: 'Brak identyfikatora wyścigu.' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Niepoprawny JSON.' }, { status: 400 })
  }

  const p = body as Partial<AdminRaceInsertPayload> & { categories?: unknown; startWaves?: unknown }
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  const city = typeof p.city === 'string' ? p.city.trim() : ''
  const race_date = typeof p.race_date === 'string' ? p.race_date.trim() : ''

  if (!name || !city || !race_date) {
    return NextResponse.json(
      { ok: false, message: 'Wymagane pola: nazwa, data wyścigu, miejsce (adres).' },
      { status: 400 },
    )
  }

  const race_type = (typeof p.race_type === 'string' ? p.race_type : 'road') as AdminRaceInsertPayload['race_type']
  const status = (typeof p.status === 'string' ? p.status : 'draft') as AdminRaceInsertPayload['status']

  if (!DB_RACE_TYPES.includes(race_type as (typeof DB_RACE_TYPES)[number])) {
    return NextResponse.json({ ok: false, message: 'Nieprawidłowy race_type.' }, { status: 400 })
  }
  if (!DB_RACE_STATUSES.includes(status as (typeof DB_RACE_STATUSES)[number])) {
    return NextResponse.json({ ok: false, message: 'Nieprawidłowy status.' }, { status: 400 })
  }

  const categories = parseCategories(p.categories)
  const hasCategories = categories.length > 0
  const startWaves = parseStartWaves(p.startWaves, categories.length)

  if (startWaves.length > 0 && !hasCategories) {
    return NextResponse.json(
      { ok: false, message: 'Kolejność startów wymaga co najmniej jednej kategorii startowej.' },
      { status: 400 },
    )
  }
  if (startWaves.length > 0) {
    const used = new Set<number>()
    for (const w of startWaves) {
      for (const idx of w.category_indexes) {
        if (used.has(idx)) {
          return NextResponse.json(
            { ok: false, message: 'Każda kategoria może być przypisana tylko do jednej fali startu.' },
            { status: 400 },
          )
        }
        used.add(idx)
      }
    }
  }

  if (hasCategories) {
    for (const c of categories) {
      if (!c.name.trim()) {
        return NextResponse.json({ ok: false, message: 'Każda kategoria musi mieć nazwę.' }, { status: 400 })
      }
    }
  } else {
    if (typeof p.distance_km !== 'number' || !Number.isFinite(p.distance_km)) {
      return NextResponse.json(
        { ok: false, message: 'Bez kategorii startowych podaj dystans wyścigu (km).' },
        { status: 400 },
      )
    }
  }

  const editionRaw = p.edition_year
  const edition_year =
    typeof editionRaw === 'number' && Number.isFinite(editionRaw) ? Math.floor(editionRaw) : null
  const spotsRaw = p.spots_total
  const spots_total = typeof spotsRaw === 'number' && Number.isFinite(spotsRaw) ? Math.floor(spotsRaw) : null
  const elevRaw = p.elevation_gain_m
  const elevation_gain_m = typeof elevRaw === 'number' && Number.isFinite(elevRaw) ? elevRaw : null
  const maxElRaw = p.max_elevation_m
  const max_elevation_m = typeof maxElRaw === 'number' && Number.isFinite(maxElRaw) ? maxElRaw : null

  const payload: AdminRaceInsertPayload = {
    name,
    slug: typeof p.slug === 'string' ? p.slug.trim() || undefined : undefined,
    race_date,
    race_time_start: typeof p.race_time_start === 'string' ? p.race_time_start : null,
    city,
    region: typeof p.region === 'string' ? p.region : null,
    country: typeof p.country === 'string' ? p.country : null,
    race_type,
    status,
    distance_km: hasCategories ? null : typeof p.distance_km === 'number' ? p.distance_km : null,
    elevation_gain_m,
    max_elevation_m,
    lap_count: hasCategories ? null : typeof p.lap_count === 'number' ? p.lap_count : null,
    laps_distance_km: hasCategories ? null : typeof p.laps_distance_km === 'number' ? p.laps_distance_km : null,
    spots_total,
    edition_year,
    entry_fee_pln: hasCategories ? null : typeof p.entry_fee_pln === 'number' ? p.entry_fee_pln : null,
    description: typeof p.description === 'string' ? p.description : null,
    registration_opens: typeof p.registration_opens === 'string' ? p.registration_opens : null,
    registration_closes: typeof p.registration_closes === 'string' ? p.registration_closes : null,
    gpx_url: typeof p.gpx_url === 'string' ? p.gpx_url : null,
    cover_image_url: typeof p.cover_image_url === 'string' ? p.cover_image_url : null,
  }

  try {
    const updated = await updateAdminRace(id, payload, categories, startWaves)
    return NextResponse.json({
      ok: true,
      id: updated.id,
      slug: updated.slug,
      message: 'Zapisano zmiany wyścigu.',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Błąd zapisu.'
    console.error('[admin/races/[id] PATCH]', e)
    const status = msg.includes('DATABASE_URL') || msg.includes('organizatora') ? 503 : 400
    return NextResponse.json({ ok: false, message: msg }, { status })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const id = typeof resolved?.id === 'string' ? resolved.id.trim() : ''
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Brak identyfikatora wyścigu.' }, { status: 400 })
  }

  try {
    const preview = await getAdminRaceForEdit(id)
    if (!preview) {
      return NextResponse.json({ ok: false, message: 'Nie znaleziono wyścigu.' }, { status: 404 })
    }

    const raceYearRaw = Number.parseInt(preview.race_date.slice(0, 4), 10)
    const raceYear =
      Number.isInteger(raceYearRaw) && raceYearRaw >= 2000 ? raceYearRaw : new Date().getFullYear()

    let deletedFiles = 0
    if (hasObjectStoreConfig()) {
      const prefixes = [
        ...resultsRaceRootBlobPrefixCandidates(preview.slug, id, raceYear),
        startlistsRaceRootBlobPrefix(preview.slug, raceYear),
      ]
      deletedFiles = await deleteObjectsByPrefixes(prefixes)
    }

    const deleted = await deleteAdminRace(id)
    return NextResponse.json({
      ok: true,
      id: deleted.id,
      slug: deleted.slug,
      deletedFiles,
      message: 'Usunięto wyścig oraz powiązane pliki.',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Błąd usuwania.'
    console.error('[admin/races/[id] DELETE]', e)
    const status =
      msg.includes('DATABASE_URL') || msg.includes('organizatora')
        ? 503
        : msg.includes('nie istnieje') || msg.includes('Nieprawidłowy')
          ? 404
          : 500
    return NextResponse.json({ ok: false, message: msg }, { status })
  }
}

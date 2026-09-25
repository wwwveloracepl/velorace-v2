import { NextRequest, NextResponse } from 'next/server'
import { listObjects } from '@/lib/objectStore'
import { getAuthUserFromRequest } from '@/lib/serverAuth'
import { getDb } from '@/lib/db'
import { getRaceResultsPdfContext, isAllowedResultsRaceId } from '@/lib/raceDb'
import {
  safeStartlistUploadFileName,
  startlistsForRaceBlobPrefix,
  startlistsWavesForRaceBlobPrefix,
} from '@/lib/startlists'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function listAllBlobsWithPrefix(prefix: string) {
  const out: Awaited<ReturnType<typeof listObjects>>['blobs'] = []
  let cursor: string | undefined
  for (;;) {
    const batch = await listObjects({ prefix, cursor })
    out.push(...batch.blobs)
    if (!batch.hasMore || !batch.cursor) break
    cursor = batch.cursor
  }
  return out
}

function waveTimeLabel(startTimeRaw: unknown): string {
  const s = startTimeRaw != null ? String(startTimeRaw) : ''
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s.slice(0, 8) || '—'
}

function parseFolderFile(
  pathname: string,
  folderName: 'kategorie' | 'fale',
): { id: string; fileName: string } | null {
  const parts = pathname.split('/').filter(Boolean)
  // listy_startowe/{year}/{slug}/{kategorie|fale}/{id}/{file}
  if (parts.length < 6) return null
  if (parts[3] !== folderName) return null
  const id = parts[4]
  const fileName = parts.slice(5).join('/')
  if (!id || !fileName) return null
  return { id, fileName }
}

export async function GET(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const raceId = typeof resolved?.id === 'string' ? resolved.id.trim() : ''
  if (!raceId || !(await isAllowedResultsRaceId(raceId))) {
    return NextResponse.json({ ok: false, message: 'Nieznany wyscig.' }, { status: 400 })
  }

  const sql = getDb()
  if (!sql) {
    return NextResponse.json({ ok: false, message: 'Brak DATABASE_URL.' }, { status: 503 })
  }

  const raceCtx = await getRaceResultsPdfContext(raceId)
  if (!raceCtx) {
    return NextResponse.json({ ok: false, message: 'Nie znaleziono wyścigu.' }, { status: 404 })
  }

  try {
    const raceMeta = await sql`
      SELECT
        COALESCE(startlist_file_url, '') AS url,
        COALESCE(startlist_file_name, '') AS file_name,
        COALESCE(startlist_uploaded_at::text, '') AS uploaded_at
      FROM races
      WHERE id = ${raceId}::uuid
      LIMIT 1
    `
    const rm = (raceMeta[0] ?? {}) as { url?: string; file_name?: string; uploaded_at?: string }

    let combined: {
      id: string
      label: string
      url: string
      fileName: string
      uploadedAt: string
    }[] = []
    try {
      const combinedRows = await sql`
        SELECT
          g.id::text AS id,
          COALESCE(g.label, '') AS label,
          COALESCE(g.file_url, '') AS file_url,
          COALESCE(g.file_name, '') AS file_name,
          COALESCE(g.uploaded_at::text, '') AS uploaded_at
        FROM race_startlist_combined_files g
        WHERE g.race_id = ${raceId}::uuid
        ORDER BY g.uploaded_at NULLS LAST, g.created_at
      `
      combined = (combinedRows as {
        id: string
        label: string
        file_url: string
        file_name: string
        uploaded_at: string
      }[])
        .filter(r => r.file_url)
        .map(r => ({
          id: String(r.id),
          label: String(r.label ?? ''),
          url: String(r.file_url),
          fileName: String(r.file_name ?? ''),
          uploadedAt: String(r.uploaded_at ?? ''),
        }))
    } catch {
      // tabela może jeszcze nie istnieć
    }

    if (combined.length === 0 && rm.url) {
      combined.unshift({
        id: 'legacy',
        label: '',
        url: String(rm.url),
        fileName: String(rm.file_name ?? ''),
        uploadedAt: String(rm.uploaded_at ?? ''),
      })
    }

    const catRows = await sql`
      SELECT id::text AS id, name
      FROM race_categories
      WHERE race_id = ${raceId}::uuid
      ORDER BY display_order NULLS LAST, name NULLS LAST
    `

    const waveRows = await sql`
      SELECT w.id::text AS id, w.start_time::text AS start_time, w.sort_order
      FROM race_start_waves w
      WHERE w.race_id = ${raceId}::uuid
      ORDER BY w.start_time, w.sort_order
    `

    const waves: {
      id: string
      label: string
      url: string | null
      fileName: string | null
    }[] = []

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
      waves.push({ id: w.id, label, url: null, fileName: null })
    }

    const categoryUrls: Record<string, string | null> = {}
    const categoryFileNames: Record<string, string | null> = {}
    try {
      const catBlobs = await listAllBlobsWithPrefix(startlistsForRaceBlobPrefix(raceCtx.slug, raceCtx.raceYear))
      for (const blob of catBlobs) {
        const parsed = parseFolderFile(blob.pathname, 'kategorie')
        if (!parsed) continue
        categoryUrls[parsed.id] = blob.downloadUrl || blob.url
        categoryFileNames[parsed.id] = safeStartlistUploadFileName(parsed.fileName)
      }
    } catch {
      // brak konfiguracji R2 — sekcja i tak pokaże puste sloty
    }

    try {
      const waveBlobs = await listAllBlobsWithPrefix(
        startlistsWavesForRaceBlobPrefix(raceCtx.slug, raceCtx.raceYear),
      )
      const byWave = new Map<string, { url: string; fileName: string }>()
      for (const blob of waveBlobs) {
        const parsed = parseFolderFile(blob.pathname, 'fale')
        if (!parsed) continue
        byWave.set(parsed.id, {
          url: blob.downloadUrl || blob.url,
          fileName: safeStartlistUploadFileName(parsed.fileName),
        })
      }
      for (const w of waves) {
        const hit = byWave.get(w.id)
        if (hit) {
          w.url = hit.url
          w.fileName = hit.fileName
        }
      }
    } catch {
      // ignore
    }

    const groupRows = await sql`
      SELECT
        g.id::text AS id,
        g.label,
        COALESCE(g.file_url, '') AS file_url,
        COALESCE(g.file_name, '') AS file_name,
        COALESCE(g.uploaded_at::text, '') AS uploaded_at
      FROM race_startlist_groups g
      WHERE g.race_id = ${raceId}::uuid
      ORDER BY g.created_at
    `

    const groups = []
    for (const g of groupRows as {
      id: string
      label: string
      file_url: string
      file_name: string
      uploaded_at: string
    }[]) {
      const gc = await sql`
        SELECT c.id::text AS id, c.name
        FROM race_startlist_group_categories gc
        JOIN race_categories c ON c.id = gc.category_id
        WHERE gc.group_id = ${g.id}::uuid
        ORDER BY c.display_order NULLS LAST, c.name NULLS LAST
      `
      const cats = (gc as { id: string; name: string }[]).map(c => ({
        id: String(c.id),
        name: String(c.name ?? ''),
      }))
      groups.push({
        id: String(g.id),
        label: String(g.label ?? ''),
        url: g.file_url ? String(g.file_url) : null,
        fileName: g.file_name ? String(g.file_name) : null,
        uploadedAt: g.uploaded_at ? String(g.uploaded_at) : null,
        categories: cats,
      })
    }

    return NextResponse.json({
      ok: true,
      raceId,
      combined,
      categories: (catRows as { id: string; name: string }[]).map(c => ({
        id: String(c.id),
        name: String(c.name ?? ''),
        url: categoryUrls[c.id] ?? null,
        fileName: categoryFileNames[c.id] ?? null,
      })),
      waves,
      groups,
    })
  } catch (e) {
    console.error('[admin/races/[id]/startlists GET]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się pobrać list startowych.' }, { status: 500 })
  }
}

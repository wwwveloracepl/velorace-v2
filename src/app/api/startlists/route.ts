import { NextRequest, NextResponse } from 'next/server'
import { listObjects } from '@/lib/objectStore'
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
  if (parts.length < 6) return null
  if (parts[3] !== folderName) return null
  const id = parts[4]
  const fileName = parts.slice(5).join('/')
  if (!id || !fileName) return null
  return { id, fileName }
}

export async function GET(req: NextRequest) {
  const raceIdParam = req.nextUrl.searchParams.get('raceId')?.trim() || ''
  const raceId = raceIdParam
  if (!raceId || !(await isAllowedResultsRaceId(raceId))) {
    return NextResponse.json({ ok: false, message: 'Brak lub nieznany parametr raceId.' }, { status: 400 })
  }

  const ctx = await getRaceResultsPdfContext(raceId)
  if (!ctx) {
    return NextResponse.json({ ok: false, message: 'Nie znaleziono wyścigu.' }, { status: 404 })
  }

  const sql = getDb()

  try {
    let combined: { id: string; label: string; url: string; fileName: string }[] = []
    if (sql) {
      try {
        const combinedRows = await sql`
          SELECT
            g.id::text AS id,
            COALESCE(g.label, '') AS label,
            COALESCE(g.file_url, '') AS file_url,
            COALESCE(g.file_name, '') AS file_name
          FROM race_startlist_combined_files g
          WHERE g.race_id = ${raceId}::uuid
            AND g.file_url IS NOT NULL
            AND g.file_url <> ''
          ORDER BY g.uploaded_at NULLS LAST, g.created_at
        `
        combined = (combinedRows as { id: string; label: string; file_url: string; file_name: string }[]).map(
          r => ({
            id: String(r.id),
            label: String(r.label ?? ''),
            url: String(r.file_url),
            fileName: String(r.file_name ?? ''),
          }),
        )
      } catch {
        // tabela może jeszcze nie istnieć
      }

      const raceMeta = await sql`
        SELECT
          COALESCE(startlist_file_url, '') AS url,
          COALESCE(startlist_file_name, '') AS file_name
        FROM races
        WHERE id = ${raceId}::uuid
        LIMIT 1
      `
      const rm = (raceMeta[0] ?? {}) as { url?: string; file_name?: string }
      if (rm.url && !combined.some(c => c.url === String(rm.url))) {
        combined = [
          {
            id: 'legacy',
            label: '',
            url: String(rm.url),
            fileName: String(rm.file_name ?? ''),
          },
          ...combined,
        ]
      }
    }

    const urls: Record<string, string | null> = {}
    const fileNames: Record<string, string | null> = {}
    const catBlobs = await listAllBlobsWithPrefix(startlistsForRaceBlobPrefix(ctx.slug, ctx.raceYear))
    for (const blob of catBlobs) {
      const parsed = parseFolderFile(blob.pathname, 'kategorie')
      if (!parsed) continue
      urls[parsed.id] = blob.downloadUrl || blob.url
      fileNames[parsed.id] = safeStartlistUploadFileName(parsed.fileName)
    }

    const waves: { id: string; label: string; url: string; fileName: string }[] = []
    if (sql) {
      const waveRows = await sql`
        SELECT w.id::text AS id, w.start_time::text AS start_time, w.sort_order
        FROM race_start_waves w
        WHERE w.race_id = ${raceId}::uuid
        ORDER BY w.start_time, w.sort_order
      `
      const waveBlobs = await listAllBlobsWithPrefix(startlistsWavesForRaceBlobPrefix(ctx.slug, ctx.raceYear))
      const byWave = new Map<string, { url: string; fileName: string }>()
      for (const blob of waveBlobs) {
        const parsed = parseFolderFile(blob.pathname, 'fale')
        if (!parsed) continue
        byWave.set(parsed.id, {
          url: blob.downloadUrl || blob.url,
          fileName: safeStartlistUploadFileName(parsed.fileName),
        })
      }

      for (let i = 0; i < (waveRows as { id: string; start_time: string }[]).length; i++) {
        const w = waveRows[i] as { id: string; start_time: string }
        const hit = byWave.get(w.id)
        if (!hit) continue
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
        waves.push({ id: w.id, label, url: hit.url, fileName: hit.fileName })
      }
    }

    const groups: {
      id: string
      label: string
      url: string
      fileName: string
      categoryIds: string[]
    }[] = []
    if (sql) {
      const groupRows = await sql`
        SELECT
          g.id::text AS id,
          g.label,
          COALESCE(g.file_url, '') AS file_url,
          COALESCE(g.file_name, '') AS file_name
        FROM race_startlist_groups g
        WHERE g.race_id = ${raceId}::uuid
          AND g.file_url IS NOT NULL
          AND g.file_url <> ''
        ORDER BY g.created_at
      `
      for (const g of groupRows as { id: string; label: string; file_url: string; file_name: string }[]) {
        const gc = await sql`
          SELECT category_id::text AS id
          FROM race_startlist_group_categories
          WHERE group_id = ${g.id}::uuid
        `
        groups.push({
          id: String(g.id),
          label: String(g.label ?? ''),
          url: String(g.file_url),
          fileName: String(g.file_name ?? ''),
          categoryIds: (gc as { id: string }[]).map(r => String(r.id)),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      raceId,
      urls,
      fileNames,
      combined,
      waves,
      groups,
    })
  } catch (e) {
    console.error('[api/startlists]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się pobrać list startowych.' }, { status: 500 })
  }
}

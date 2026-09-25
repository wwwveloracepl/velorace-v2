import { NextRequest, NextResponse } from 'next/server'
import { deleteObjectsByPath, hasObjectStoreConfig, listObjects, putObject } from '@/lib/objectStore'
import { getAuthUserFromRequest } from '@/lib/serverAuth'
import { getDb } from '@/lib/db'
import { getRaceResultsPdfContext } from '@/lib/raceDb'
import {
  combinedResultsFileBlobPrefix,
  combinedResultsPdfBlobPrefix,
  isPdfUpload,
  resultsRaceRootBlobPrefixCandidates,
  safeResultUploadFileName,
} from '@/lib/results'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024

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

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
}

/** Utrzymuje kolumny races.results_combined_* na najnowszym pliku (kompatybilność wsteczna). */
async function syncRaceCombinedColumns(sql: NonNullable<ReturnType<typeof getDb>>, raceId: string) {
  const newest = await sql`
    SELECT
      COALESCE(storage_path, '') AS storage_path,
      COALESCE(file_url, '') AS file_url,
      COALESCE(file_name, '') AS file_name,
      uploaded_at
    FROM race_results_combined_files
    WHERE race_id = ${raceId}::uuid
      AND file_url IS NOT NULL
      AND file_url <> ''
    ORDER BY uploaded_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `
  const row = newest[0] as
    | { storage_path: string; file_url: string; file_name: string; uploaded_at: string | null }
    | undefined

  if (row?.file_url) {
    await sql`
      UPDATE races
      SET
        results_combined_storage_path = ${row.storage_path || null},
        results_combined_file_url = ${row.file_url},
        results_combined_file_name = ${row.file_name || null},
        results_combined_uploaded_at = ${row.uploaded_at},
        updated_at = NOW()
      WHERE id = ${raceId}::uuid
    `
  } else {
    await sql`
      UPDATE races
      SET
        results_combined_storage_path = NULL,
        results_combined_file_url = NULL,
        results_combined_file_name = NULL,
        results_combined_uploaded_at = NULL,
        updated_at = NOW()
      WHERE id = ${raceId}::uuid
    `
  }
}

export async function POST(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  if (!hasObjectStoreConfig()) {
    return NextResponse.json(
      { ok: false, message: 'Brak konfiguracji R2. Uzupełnij zmienne R2_*.' },
      { status: 500 },
    )
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const raceId = typeof resolved?.id === 'string' ? resolved.id.trim() : ''
  if (!raceId) {
    return NextResponse.json({ ok: false, message: 'Brak identyfikatora wyścigu.' }, { status: 400 })
  }

  const raceCtx = await getRaceResultsPdfContext(raceId)
  if (!raceCtx) {
    return NextResponse.json({ ok: false, message: 'Nie znaleziono wyścigu.' }, { status: 404 })
  }

  const sql = getDb()
  if (!sql) {
    return NextResponse.json({ ok: false, message: 'Brak DATABASE_URL.' }, { status: 503 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, message: 'Niepoprawne dane formularza.' }, { status: 400 })
  }

  const file = formData.get('file')
  const labelRaw = typeof formData.get('label') === 'string' ? String(formData.get('label')).trim() : ''

  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, message: 'Brak pliku.' }, { status: 400 })
  }

  const originalName = safeResultUploadFileName(file, 0)
  if (!isPdfUpload(file, originalName)) {
    return NextResponse.json({ ok: false, message: 'Wymagany plik PDF.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, message: 'Plik za duży (max 25 MB).' }, { status: 400 })
  }

  try {
    const inserted = await sql`
      INSERT INTO race_results_combined_files (race_id, label)
      VALUES (${raceId}::uuid, ${labelRaw})
      RETURNING id::text AS id
    `
    const fileId = String((inserted[0] as { id: string }).id)
    const folderPrefix = combinedResultsFileBlobPrefix(raceCtx.slug, fileId, raceCtx.raceYear)
    const pathname = `${folderPrefix}${originalName}`
    const blob = await putObject(pathname, file, { contentType: 'application/pdf' })
    const publicUrl = blob.downloadUrl || blob.url

    await sql`
      UPDATE race_results_combined_files
      SET
        storage_path = ${blob.pathname},
        file_url = ${publicUrl},
        file_name = ${originalName},
        uploaded_at = NOW()
      WHERE id = ${fileId}::uuid
    `

    await syncRaceCombinedColumns(sql, raceId)

    return NextResponse.json({
      ok: true,
      id: fileId,
      label: labelRaw,
      url: publicUrl,
      pathname: blob.pathname,
      fileName: originalName,
    })
  } catch (e) {
    console.error('[admin/races/[id]/results-combined/upload]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się wgrać wyników zbiorczych.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const raceId = typeof resolved?.id === 'string' ? resolved.id.trim() : ''
  if (!raceId) {
    return NextResponse.json({ ok: false, message: 'Brak identyfikatora wyścigu.' }, { status: 400 })
  }

  const sql = getDb()
  if (!sql) {
    return NextResponse.json({ ok: false, message: 'Brak DATABASE_URL.' }, { status: 503 })
  }

  const raceCtx = await getRaceResultsPdfContext(raceId)
  if (!raceCtx) {
    return NextResponse.json({ ok: false, message: 'Nie znaleziono wyścigu.' }, { status: 404 })
  }

  const fileId = req.nextUrl.searchParams.get('fileId')?.trim() || ''
  const legacy = req.nextUrl.searchParams.get('legacy') === '1'

  try {
    if (fileId.startsWith('legacy-path:')) {
      const pathname = fileId.slice('legacy-path:'.length).trim()
      const allowed = resultsRaceRootBlobPrefixCandidates(raceCtx.slug, raceId, raceCtx.raceYear)
      const okPath = allowed.some(prefix => pathname.startsWith(prefix))
      if (!pathname || !okPath) {
        return NextResponse.json({ ok: false, message: 'Nieprawidłowa ścieżka pliku.' }, { status: 400 })
      }
      const parts = pathname.split('/').filter(Boolean)
      // wyscigi_YYYY / slug / folder / ...
      const folder = parts[2]
      if (
        folder !== 'kategorie' &&
        folder !== 'fale' &&
        folder !== 'kategoria' &&
        folder !== 'fala'
      ) {
        return NextResponse.json({ ok: false, message: 'Można usunąć tylko plik ze starego modelu.' }, { status: 400 })
      }
      if (hasObjectStoreConfig()) {
        await deleteObjectsByPath([pathname])
      }
      return NextResponse.json({ ok: true })
    }

    // Stary pojedynczy plik z kolumn races.* (sprzed multi)
    if (legacy || fileId === 'legacy') {
      const prefix = combinedResultsPdfBlobPrefix(raceCtx.slug, raceCtx.raceYear)
      if (hasObjectStoreConfig()) {
        const existing = await listAllBlobsWithPrefix(prefix)
        // Usuń tylko pliki bezpośrednio w folderze (nie w podfolderach {uuid}/)
        const direct = existing.filter(b => {
          const rest = b.pathname.slice(prefix.length)
          return rest.length > 0 && !rest.includes('/')
        })
        if (direct.length > 0) {
          await deleteObjectsByPath(direct.map(b => b.pathname))
        }
      }
      await sql`
        UPDATE races
        SET
          results_combined_storage_path = NULL,
          results_combined_file_url = NULL,
          results_combined_file_name = NULL,
          results_combined_uploaded_at = NULL,
          updated_at = NOW()
        WHERE id = ${raceId}::uuid
      `
      await syncRaceCombinedColumns(sql, raceId)
      return NextResponse.json({ ok: true })
    }

    if (!fileId || !isUuidLike(fileId)) {
      return NextResponse.json({ ok: false, message: 'Podaj fileId pliku do usunięcia.' }, { status: 400 })
    }

    const rows = await sql`
      SELECT id::text AS id, COALESCE(storage_path, '') AS storage_path
      FROM race_results_combined_files
      WHERE id = ${fileId}::uuid AND race_id = ${raceId}::uuid
      LIMIT 1
    `
    if (!rows.length) {
      return NextResponse.json({ ok: false, message: 'Nie znaleziono pliku.' }, { status: 404 })
    }

    if (hasObjectStoreConfig()) {
      const folderPrefix = combinedResultsFileBlobPrefix(raceCtx.slug, fileId, raceCtx.raceYear)
      const existing = await listAllBlobsWithPrefix(folderPrefix)
      if (existing.length > 0) {
        await deleteObjectsByPath(existing.map(b => b.pathname))
      }
    }

    await sql`
      DELETE FROM race_results_combined_files
      WHERE id = ${fileId}::uuid AND race_id = ${raceId}::uuid
    `

    await syncRaceCombinedColumns(sql, raceId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/races/[id]/results-combined/upload DELETE]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się usunąć wyników zbiorczych.' }, { status: 500 })
  }
}

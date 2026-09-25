import { NextRequest, NextResponse } from 'next/server'
import { deleteObjectsByPath, hasObjectStoreConfig, listObjects, putObject } from '@/lib/objectStore'
import { getAuthUserFromRequest } from '@/lib/serverAuth'
import { getDb } from '@/lib/db'
import { getRaceResultsPdfContext, isAllowedResultsRaceId } from '@/lib/raceDb'
import {
  flexibleResultGroupBlobPrefix,
  isPdfUpload,
  safeFlexibleResultUploadFileName,
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

function parseCategoryIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(x => String(x).trim()).filter(isUuidLike)
  } catch {
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(isUuidLike)
  }
}

export async function POST(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  if (!hasObjectStoreConfig()) {
    return NextResponse.json({ ok: false, message: 'Brak konfiguracji R2. Uzupełnij zmienne R2_*.' }, { status: 500 })
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const raceId = typeof resolved?.id === 'string' ? resolved.id.trim() : ''
  if (!raceId || !(await isAllowedResultsRaceId(raceId))) {
    return NextResponse.json({ ok: false, message: 'Nieznany wyscig.' }, { status: 400 })
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
  const categoryIds = parseCategoryIds(formData.get('categoryIds'))
  const labelRaw = typeof formData.get('label') === 'string' ? String(formData.get('label')).trim() : ''

  if (categoryIds.length < 2) {
    return NextResponse.json(
      { ok: false, message: 'Wybierz co najmniej dwie kategorie do jednej listy wyników.' },
      { status: 400 },
    )
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, message: 'Brak pliku.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, message: 'Plik za duży (max 25 MB).' }, { status: 400 })
  }

  const nameCandidate =
    typeof (file as unknown as { name?: unknown }).name === 'string'
      ? (file as unknown as { name: string }).name
      : 'wyniki.pdf'
  const safeName = safeFlexibleResultUploadFileName(nameCandidate)

  if (!isPdfUpload(file, safeName)) {
    return NextResponse.json({ ok: false, message: 'Dozwolone są tylko pliki PDF.' }, { status: 400 })
  }

  const catRows = await sql`
    SELECT id::text AS id, name
    FROM race_categories
    WHERE race_id = ${raceId}::uuid
    ORDER BY display_order NULLS LAST, name NULLS LAST
  `
  const allCats = catRows as { id: string; name: string }[]
  const byId = new Map(allCats.map(c => [c.id, c]))
  const found: { id: string; name: string }[] = []
  for (const id of categoryIds) {
    const hit = byId.get(id)
    if (!hit) {
      return NextResponse.json(
        { ok: false, message: 'Niektóre kategorie nie należą do tego wyścigu.' },
        { status: 400 },
      )
    }
    found.push(hit)
  }
  found.sort((a, b) => {
    const ia = allCats.findIndex(c => c.id === a.id)
    const ib = allCats.findIndex(c => c.id === b.id)
    return ia - ib
  })

  const label = labelRaw || found.map(c => c.name).filter(Boolean).join(' + ') || 'Grupa kategorii'

  try {
    const inserted = await sql`
      INSERT INTO race_results_groups (race_id, label)
      VALUES (${raceId}::uuid, ${label})
      RETURNING id::text AS id
    `
    const groupId = String((inserted[0] as { id: string }).id)

    for (const cat of found) {
      await sql`
        INSERT INTO race_results_group_categories (group_id, category_id)
        VALUES (${groupId}::uuid, ${cat.id}::uuid)
      `
    }

    const folderPrefix = flexibleResultGroupBlobPrefix(raceCtx.slug, groupId, raceCtx.raceYear)
    const pathname = `${folderPrefix}${safeName}`
    const blob = await putObject(pathname, file, { contentType: 'application/pdf' })
    const publicUrl = blob.downloadUrl || blob.url

    await sql`
      UPDATE race_results_groups
      SET
        storage_path = ${blob.pathname},
        file_url = ${publicUrl},
        file_name = ${safeName},
        uploaded_at = NOW()
      WHERE id = ${groupId}::uuid
    `

    return NextResponse.json({
      ok: true,
      id: groupId,
      label,
      url: publicUrl,
      fileName: safeName,
      categoryIds: found.map(c => c.id),
    })
  } catch (e) {
    console.error('[results-groups/upload]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się wgrać wyników dla grupy.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const user = getAuthUserFromRequest(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ ok: false, message: 'Brak dostępu.' }, { status: 403 })
  }

  const resolved = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const raceId = typeof resolved?.id === 'string' ? resolved.id.trim() : ''
  if (!raceId || !(await isAllowedResultsRaceId(raceId))) {
    return NextResponse.json({ ok: false, message: 'Nieznany wyscig.' }, { status: 400 })
  }

  const groupId = req.nextUrl.searchParams.get('groupId')?.trim() || ''
  if (!groupId || !isUuidLike(groupId)) {
    return NextResponse.json({ ok: false, message: 'Nieprawidłowy groupId.' }, { status: 400 })
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
    const rows = await sql`
      SELECT id::text AS id
      FROM race_results_groups
      WHERE id = ${groupId}::uuid AND race_id = ${raceId}::uuid
      LIMIT 1
    `
    if (!rows.length) {
      return NextResponse.json({ ok: false, message: 'Nie znaleziono grupy.' }, { status: 404 })
    }

    if (hasObjectStoreConfig()) {
      const folderPrefix = flexibleResultGroupBlobPrefix(raceCtx.slug, groupId, raceCtx.raceYear)
      const existing = await listAllBlobsWithPrefix(folderPrefix)
      if (existing.length > 0) {
        await deleteObjectsByPath(existing.map(b => b.pathname))
      }
    }

    await sql`DELETE FROM race_results_groups WHERE id = ${groupId}::uuid AND race_id = ${raceId}::uuid`

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[results-groups/upload DELETE]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się usunąć wyników grupy.' }, { status: 500 })
  }
}

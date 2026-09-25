import { NextRequest, NextResponse } from 'next/server'
import { deleteObjectsByPath, hasObjectStoreConfig, listObjects, putObject } from '@/lib/objectStore'
import { getAuthUserFromRequest } from '@/lib/serverAuth'
import { getDb } from '@/lib/db'
import { getRaceResultsPdfContext, isAllowedResultsRaceId } from '@/lib/raceDb'
import {
  flexibleResultCategoryBlobPrefix,
  flexibleResultWaveBlobPrefix,
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

async function resolveTarget(
  raceId: string,
  categoryId: string,
  waveId: string,
): Promise<{ ok: true; folderPrefix: string } | { ok: false; message: string; status: number }> {
  const raceCtx = await getRaceResultsPdfContext(raceId)
  if (!raceCtx) {
    return { ok: false, message: 'Nie znaleziono wyścigu.', status: 404 }
  }

  if (categoryId && waveId) {
    return { ok: false, message: 'Podaj categoryId albo waveId — nie oba naraz.', status: 400 }
  }
  if (!categoryId && !waveId) {
    return { ok: false, message: 'Brak categoryId lub waveId.', status: 400 }
  }

  const sql = getDb()
  if (!sql) {
    return { ok: false, message: 'Brak DATABASE_URL.', status: 503 }
  }

  if (categoryId) {
    if (!isUuidLike(categoryId)) {
      return { ok: false, message: 'Nieprawidłowy categoryId.', status: 400 }
    }
    const rows = await sql`
      SELECT 1 FROM race_categories
      WHERE id = ${categoryId}::uuid AND race_id = ${raceId}::uuid
      LIMIT 1
    `
    if (!rows.length) {
      return { ok: false, message: 'Kategoria nie należy do tego wyścigu.', status: 400 }
    }
    return {
      ok: true,
      folderPrefix: flexibleResultCategoryBlobPrefix(raceCtx.slug, categoryId, raceCtx.raceYear),
    }
  }

  if (!isUuidLike(waveId)) {
    return { ok: false, message: 'Nieprawidłowy waveId.', status: 400 }
  }
  const waveRows = await sql`
    SELECT 1 FROM race_start_waves
    WHERE id = ${waveId}::uuid AND race_id = ${raceId}::uuid
    LIMIT 1
  `
  if (!waveRows.length) {
    return { ok: false, message: 'Fala nie należy do tego wyścigu.', status: 400 }
  }
  return {
    ok: true,
    folderPrefix: flexibleResultWaveBlobPrefix(raceCtx.slug, waveId, raceCtx.raceYear),
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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, message: 'Niepoprawne dane formularza.' }, { status: 400 })
  }

  const categoryId = typeof formData.get('categoryId') === 'string' ? String(formData.get('categoryId')).trim() : ''
  const waveId = typeof formData.get('waveId') === 'string' ? String(formData.get('waveId')).trim() : ''
  const file = formData.get('file')

  const target = await resolveTarget(raceId, categoryId, waveId)
  if (!target.ok) {
    return NextResponse.json({ ok: false, message: target.message }, { status: target.status })
  }

  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, message: 'Brak pliku.' }, { status: 400 })
  }

  const nameCandidate =
    typeof (file as unknown as { name?: unknown }).name === 'string'
      ? (file as unknown as { name: string }).name
      : 'wyniki.pdf'
  const safeName = safeFlexibleResultUploadFileName(nameCandidate)

  if (!isPdfUpload(file, safeName)) {
    return NextResponse.json({ ok: false, message: 'Dozwolone są tylko pliki PDF.' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, message: 'Plik za duży (max 25 MB).' }, { status: 400 })
  }

  try {
    const existing = await listAllBlobsWithPrefix(target.folderPrefix)
    if (existing.length > 0) {
      await deleteObjectsByPath(existing.map(b => b.pathname))
    }

    const pathname = `${target.folderPrefix}${safeName}`
    const blob = await putObject(pathname, file, { contentType: 'application/pdf' })
    const publicUrl = blob.downloadUrl || blob.url

    return NextResponse.json({
      ok: true,
      url: publicUrl,
      fileName: safeName,
      pathname: blob.pathname,
    })
  } catch (e) {
    console.error('[results-files/upload]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się wgrać wyników.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } | Promise<{ id: string }> }) {
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

  const categoryId = req.nextUrl.searchParams.get('categoryId')?.trim() || ''
  const waveId = req.nextUrl.searchParams.get('waveId')?.trim() || ''

  const target = await resolveTarget(raceId, categoryId, waveId)
  if (!target.ok) {
    return NextResponse.json({ ok: false, message: target.message }, { status: target.status })
  }

  try {
    const existing = await listAllBlobsWithPrefix(target.folderPrefix)
    if (existing.length === 0) return NextResponse.json({ ok: true, deleted: 0 })
    await deleteObjectsByPath(existing.map(b => b.pathname))
    return NextResponse.json({ ok: true, deleted: existing.length })
  } catch (e) {
    console.error('[results-files/upload DELETE]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się usunąć wyników.' }, { status: 500 })
  }
}

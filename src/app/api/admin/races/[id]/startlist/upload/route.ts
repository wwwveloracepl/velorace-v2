import { NextRequest, NextResponse } from 'next/server'
import { deleteObjectsByPath, hasObjectStoreConfig, listObjects, putObject } from '@/lib/objectStore'
import { getAuthUserFromRequest } from '@/lib/serverAuth'
import { getDb } from '@/lib/db'
import { getRaceResultsPdfContext } from '@/lib/raceDb'
import { isPdfUpload, safeResultUploadFileName } from '@/lib/results'
import { combinedStartlistBlobPrefix } from '@/lib/startlists'

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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, message: 'Niepoprawne dane formularza.' }, { status: 400 })
  }

  const file = formData.get('file')
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

  const prefix = combinedStartlistBlobPrefix(raceCtx.slug, raceCtx.raceYear)

  try {
    const existing = await listAllBlobsWithPrefix(prefix)
    if (existing.length > 0) {
      await deleteObjectsByPath(existing.map(b => b.pathname))
    }

    const pathname = `${prefix}${originalName}`
    const blob = await putObject(pathname, file, { contentType: 'application/pdf' })
    const publicUrl = blob.downloadUrl || blob.url

    const sql = getDb()
    if (!sql) {
      return NextResponse.json({ ok: false, message: 'Brak DATABASE_URL.' }, { status: 503 })
    }
    await sql`
      UPDATE races
      SET
        startlist_storage_path = ${blob.pathname},
        startlist_file_url = ${publicUrl},
        startlist_file_name = ${originalName},
        startlist_uploaded_at = NOW(),
        updated_at = NOW()
      WHERE id = ${raceId}::uuid
    `

    return NextResponse.json({
      ok: true,
      url: publicUrl,
      pathname: blob.pathname,
      fileName: originalName,
    })
  } catch (e) {
    console.error('[admin/races/[id]/startlist/upload]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się wgrać listy startowej.' }, { status: 500 })
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

  try {
    const prefix = combinedStartlistBlobPrefix(raceCtx.slug, raceCtx.raceYear)
    const existing = await listAllBlobsWithPrefix(prefix)
    if (existing.length > 0 && hasObjectStoreConfig()) {
      await deleteObjectsByPath(existing.map(b => b.pathname))
    }

    await sql`
      UPDATE races
      SET
        startlist_storage_path = NULL,
        startlist_file_url = NULL,
        startlist_file_name = NULL,
        startlist_uploaded_at = NULL,
        updated_at = NOW()
      WHERE id = ${raceId}::uuid
    `

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/races/[id]/startlist/upload DELETE]', e)
    return NextResponse.json({ ok: false, message: 'Nie udało się usunąć listy startowej.' }, { status: 500 })
  }
}

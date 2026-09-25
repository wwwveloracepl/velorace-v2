import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export type ObjectListBlob = {
  pathname: string
  url: string
  downloadUrl: string
  uploadedAt: string
}

export type ObjectListResult = {
  blobs: ObjectListBlob[]
  hasMore: boolean
  cursor?: string
}

function must(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Brak ${name}. Skonfiguruj Cloudflare R2.`)
  return value
}

function getEnv() {
  const accountId = must('R2_ACCOUNT_ID')
  const accessKeyId = must('R2_ACCESS_KEY_ID')
  const secretAccessKey = must('R2_SECRET_ACCESS_KEY')
  const bucket = must('R2_BUCKET_NAME')
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.trim() || ''
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint, publicBase }
}

let s3Client: S3Client | null = null

function client(): S3Client {
  if (s3Client) return s3Client
  const env = getEnv()
  s3Client = new S3Client({
    region: 'auto',
    endpoint: env.endpoint,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  })
  return s3Client
}

function keyToPublicUrl(key: string): string {
  const env = getEnv()
  if (env.publicBase) return `${env.publicBase.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`
  // Fallback: serwujemy przez lokalne API proxy, więc bucket nie musi być publiczny.
  return `/api/storage/file?key=${encodeURIComponent(key)}`
}

export function hasObjectStoreConfig(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_BUCKET_NAME?.trim(),
  )
}

export async function listObjects(params: { prefix: string; cursor?: string }): Promise<ObjectListResult> {
  const env = getEnv()
  const res = await client().send(
    new ListObjectsV2Command({
      Bucket: env.bucket,
      Prefix: params.prefix,
      ContinuationToken: params.cursor || undefined,
      MaxKeys: 1000,
    }),
  )

  const blobs: ObjectListBlob[] = (res.Contents ?? [])
    .filter(o => Boolean(o.Key))
    .map(o => {
      const pathname = String(o.Key)
      const url = keyToPublicUrl(pathname)
      return {
        pathname,
        url,
        downloadUrl: url,
        uploadedAt: (o.LastModified ?? new Date()).toISOString(),
      }
    })

  return {
    blobs,
    hasMore: Boolean(res.IsTruncated),
    cursor: res.NextContinuationToken,
  }
}

export async function putObject(
  pathname: string,
  file: Blob,
  opts?: { contentType?: string },
): Promise<{ pathname: string; url: string; downloadUrl: string }> {
  const env = getEnv()
  const bytes = Buffer.from(await file.arrayBuffer())
  await client().send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: pathname,
      Body: bytes,
      ContentType: opts?.contentType || file.type || 'application/octet-stream',
    }),
  )
  const url = keyToPublicUrl(pathname)
  return { pathname, url, downloadUrl: url }
}

export async function deleteObjectsByPath(pathnames: string[]): Promise<void> {
  const env = getEnv()
  const unique = Array.from(new Set(pathnames.map(p => p.trim()).filter(Boolean)))
  if (unique.length === 0) return

  const chunkSize = 1000
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    await client().send(
      new DeleteObjectsCommand({
        Bucket: env.bucket,
        Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true },
      }),
    )
  }
}

/** Usuwa wszystkie obiekty pod danymi prefiksami (paginacja ListObjects). Zwraca liczbę usuniętych kluczy. */
export async function deleteObjectsByPrefixes(prefixes: string[]): Promise<number> {
  const uniquePrefixes = Array.from(new Set(prefixes.map(p => p.trim()).filter(Boolean)))
  if (uniquePrefixes.length === 0) return 0

  const pathnames: string[] = []
  for (const prefix of uniquePrefixes) {
    let cursor: string | undefined
    for (;;) {
      const batch = await listObjects({ prefix, cursor })
      for (const blob of batch.blobs) {
        if (blob.pathname) pathnames.push(blob.pathname)
      }
      if (!batch.hasMore || !batch.cursor) break
      cursor = batch.cursor
    }
  }

  await deleteObjectsByPath(pathnames)
  return Array.from(new Set(pathnames)).length
}


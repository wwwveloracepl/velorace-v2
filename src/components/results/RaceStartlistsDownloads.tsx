'use client'

import { useEffect, useMemo, useState } from 'react'
import styles from './RaceStartlistDownloads.module.css'

type CategoryLike = { id: string; name: string }

type CombinedItem = { id: string; label: string; url: string; fileName: string }

type StartlistsResponse = {
  ok?: boolean
  message?: string
  urls?: Record<string, string | null>
  fileNames?: Record<string, string | null>
  combined?: CombinedItem[] | { url: string; fileName: string } | null
  waves?: { id: string; label: string; url: string; fileName: string }[]
  groups?: { id: string; label: string; url: string; fileName: string }[]
  categories?: CategoryLike[]
}

function normalizeCombined(
  raw: StartlistsResponse['combined'],
  fallbackUrl?: string,
): CombinedItem[] {
  if (Array.isArray(raw)) {
    return raw.filter(f => f?.url).map(f => ({
      id: f.id || f.url,
      label: f.label || '',
      url: f.url,
      fileName: f.fileName || '',
    }))
  }
  if (raw && typeof raw === 'object' && 'url' in raw && raw.url) {
    return [{ id: 'legacy', label: '', url: raw.url, fileName: raw.fileName || '' }]
  }
  if (fallbackUrl) {
    return [{ id: 'legacy', label: '', url: fallbackUrl, fileName: '' }]
  }
  return []
}

function labelFromFileName(fileName: string | null | undefined, index: number): string {
  const base = (fileName || '').replace(/\.pdf$/i, '').trim()
  if (base) return base
  return `Lista startowa ${index + 1}`
}

/** Lista plików list startowych do pobrania (używana też w modalu na stronie głównej). */
export default function RaceStartlistsDownloads({
  raceId,
  combinedStartlistUrl,
  categories = [],
}: {
  raceId: string
  combinedStartlistUrl?: string
  categories?: CategoryLike[]
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [fileNames, setFileNames] = useState<Record<string, string | null>>({})
  const [apiCategories, setApiCategories] = useState<CategoryLike[]>([])
  const [combined, setCombined] = useState<CombinedItem[]>([])
  const [waves, setWaves] = useState<{ id: string; label: string; url: string }[]>([])
  const [groups, setGroups] = useState<{ id: string; label: string; url: string }[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setCombined([])
    setWaves([])
    setGroups([])
    setUrls({})
    setFileNames({})

    const q = new URLSearchParams({ raceId })
    fetch(`/api/startlists?${q}`, { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then((d: StartlistsResponse) => {
        if (cancelled) return
        if (!d?.ok) {
          setError(typeof d?.message === 'string' ? d.message : 'Nie udało się pobrać list startowych.')
          setUrls({})
          setFileNames({})
          setApiCategories([])
          setWaves([])
          setGroups([])
          setCombined(normalizeCombined(null, combinedStartlistUrl))
          return
        }
        setUrls(d.urls ?? {})
        setFileNames(d.fileNames ?? {})
        setApiCategories(Array.isArray(d.categories) ? d.categories : [])
        setCombined(normalizeCombined(d.combined))
        setWaves((d.waves ?? []).map(w => ({ id: w.id, label: w.label, url: w.url })))
        setGroups((d.groups ?? []).map(g => ({ id: g.id, label: g.label, url: g.url })))
      })
      .catch(() => {
        if (cancelled) return
        setError('Błąd połączenia.')
        setUrls({})
        setFileNames({})
        setApiCategories([])
        setWaves([])
        setGroups([])
        setCombined(normalizeCombined(null, combinedStartlistUrl))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [raceId, combinedStartlistUrl])

  const resolvedCategories = categories.length > 0 ? categories : apiCategories

  const publishedCategories = useMemo(() => {
    return resolvedCategories
      .map(c => ({ cat: c, href: urls[c.id] ?? null }))
      .filter(x => x.href)
  }, [resolvedCategories, urls])

  /** Pliki w R2 pod starymi ID kategorii (np. po przebudowie kategorii w bazie). */
  const orphanCategoryFiles = useMemo(() => {
    const known = new Set(resolvedCategories.map(c => c.id))
    return Object.entries(urls)
      .filter(([id, href]) => Boolean(href) && !known.has(id))
      .map(([id, href], i) => ({
        id,
        href: href as string,
        label: labelFromFileName(fileNames[id], i),
      }))
  }, [resolvedCategories, urls, fileNames])

  const hasAny =
    combined.length > 0 ||
    publishedCategories.length > 0 ||
    orphanCategoryFiles.length > 0 ||
    waves.length > 0 ||
    groups.length > 0

  if (loading) {
    return <p className={styles.message}>Ładowanie list startowych…</p>
  }

  if (error && !hasAny) {
    return <p className={styles.message}>{error}</p>
  }

  if (!hasAny) {
    return <p className={styles.message}>Listy startowe nie zostały jeszcze opublikowane.</p>
  }

  return (
    <div className={styles.list}>
      {combined.map((f, i) => (
        <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className={styles.item}>
          <span className={styles.label}>
            {f.label?.trim() || (combined.length > 1 ? `Lista startowa ${i + 1}` : 'Lista startowa')}
          </span>
          <span className={styles.action}>Pobierz</span>
        </a>
      ))}
      {groups.map(g => (
        <a key={g.id} href={g.url} target="_blank" rel="noreferrer" className={styles.item}>
          <span className={styles.label}>{g.label}</span>
          <span className={styles.action}>Pobierz</span>
        </a>
      ))}
      {waves.map(w => (
        <a key={w.id} href={w.url} target="_blank" rel="noreferrer" className={styles.item}>
          <span className={styles.label}>{w.label}</span>
          <span className={styles.action}>Pobierz</span>
        </a>
      ))}
      {publishedCategories.map(x => (
        <a key={x.cat.id} href={x.href ?? '#'} target="_blank" rel="noreferrer" className={styles.item}>
          <span className={styles.label}>{x.cat.name}</span>
          <span className={styles.action}>Pobierz</span>
        </a>
      ))}
      {orphanCategoryFiles.map(x => (
        <a key={`orphan-${x.id}`} href={x.href} target="_blank" rel="noreferrer" className={styles.item}>
          <span className={styles.label}>{x.label}</span>
          <span className={styles.action}>Pobierz</span>
        </a>
      ))}
    </div>
  )
}

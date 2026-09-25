'use client'

import { useEffect, useMemo, useState } from 'react'
import styles from '@/app/wyniki/[id]/page.module.css'
import listStyles from './RaceStartlistDownloads.module.css'

type CategoryLike = { id: string; name: string }

type CombinedItem = { id: string; label: string; url: string; fileName: string }

type StartlistsResponse = {
  ok?: boolean
  urls?: Record<string, string | null>
  fileNames?: Record<string, string | null>
  combined?: CombinedItem[] | { url: string; fileName: string } | null
  waves?: { id: string; label: string; url: string; fileName: string }[]
  groups?: { id: string; label: string; url: string; fileName: string }[]
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

export default function RaceStartlistsSection({
  raceId,
  categories,
  combinedStartlistUrl,
}: {
  raceId: string
  categories: CategoryLike[]
  combinedStartlistUrl?: string
}) {
  const [loading, setLoading] = useState(true)
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const [fileNames, setFileNames] = useState<Record<string, string | null>>({})
  const [combined, setCombined] = useState<CombinedItem[]>([])
  const [waves, setWaves] = useState<{ id: string; label: string; url: string }[]>([])
  const [groups, setGroups] = useState<{ id: string; label: string; url: string }[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
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
          setUrls({})
          setFileNames({})
          setWaves([])
          setGroups([])
          setCombined(normalizeCombined(null, combinedStartlistUrl))
          return
        }
        setUrls(d.urls ?? {})
        setFileNames(d.fileNames ?? {})
        setCombined(normalizeCombined(d.combined))
        setWaves((d.waves ?? []).map(w => ({ id: w.id, label: w.label, url: w.url })))
        setGroups((d.groups ?? []).map(g => ({ id: g.id, label: g.label, url: g.url })))
      })
      .catch(() => {
        if (cancelled) return
        setUrls({})
        setFileNames({})
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

  const publishedCategories = useMemo(() => {
    return categories
      .map(c => ({ cat: c, href: urls[c.id] ?? null }))
      .filter(x => x.href)
  }, [categories, urls])

  const orphanCategoryFiles = useMemo(() => {
    const known = new Set(categories.map(c => c.id))
    return Object.entries(urls)
      .filter(([id, href]) => Boolean(href) && !known.has(id))
      .map(([id, href], i) => ({
        id,
        href: href as string,
        label: labelFromFileName(fileNames[id], i),
      }))
  }, [categories, urls, fileNames])

  const hasAny =
    combined.length > 0 ||
    publishedCategories.length > 0 ||
    orphanCategoryFiles.length > 0 ||
    waves.length > 0 ||
    groups.length > 0

  if (loading) return null
  if (!hasAny) return null

  return (
    <>
      <h2 className={styles.cardTitle}>Pobierz listy startowe</h2>
      <div className={styles.downloadsBody}>
        <div className={listStyles.list}>
          {combined.map((f, i) => (
            <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className={listStyles.item}>
              <span className={listStyles.label}>
                {f.label?.trim() ||
                  (combined.length > 1 ? `Lista startowa ${i + 1}` : 'Lista startowa')}
              </span>
              <span className={listStyles.action}>Pobierz</span>
            </a>
          ))}
          {groups.map(g => (
            <a key={g.id} href={g.url} target="_blank" rel="noreferrer" className={listStyles.item}>
              <span className={listStyles.label}>{g.label}</span>
              <span className={listStyles.action}>Pobierz</span>
            </a>
          ))}
          {waves.map(w => (
            <a key={w.id} href={w.url} target="_blank" rel="noreferrer" className={listStyles.item}>
              <span className={listStyles.label}>{w.label}</span>
              <span className={listStyles.action}>Pobierz</span>
            </a>
          ))}
          {publishedCategories.map(x => (
            <a key={x.cat.id} href={x.href ?? '#'} target="_blank" rel="noreferrer" className={listStyles.item}>
              <span className={listStyles.label}>{x.cat.name}</span>
              <span className={listStyles.action}>Pobierz</span>
            </a>
          ))}
          {orphanCategoryFiles.map(x => (
            <a key={`orphan-${x.id}`} href={x.href} target="_blank" rel="noreferrer" className={listStyles.item}>
              <span className={listStyles.label}>{x.label}</span>
              <span className={listStyles.action}>Pobierz</span>
            </a>
          ))}
        </div>
      </div>
    </>
  )
}

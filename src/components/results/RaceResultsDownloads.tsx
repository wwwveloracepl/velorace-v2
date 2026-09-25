'use client'

import { useEffect, useMemo, useState } from 'react'
import { useResultBlobUrls } from '@/components/results/ResultsCategoriesBody'
import styles from './RaceResultsDownloads.module.css'

type CategoryLike = { id: string; name: string }

type CombinedItem = { id: string; label: string; url: string; fileName: string }

type FlexibleResultsResponse = {
  ok?: boolean
  urls?: Record<string, string | null>
  combined?: CombinedItem[] | { url: string; fileName: string } | null
  waves?: { id: string; label: string; url: string; fileName: string }[]
  groups?: { id: string; label: string; url: string; fileName: string }[]
  categories?: CategoryLike[]
}

function normalizeCombined(
  raw: FlexibleResultsResponse['combined'],
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

export default function RaceResultsDownloads({
  raceId,
  combinedResultsUrl,
  categories = [],
}: {
  raceId: string
  combinedResultsUrl?: string
  categories?: CategoryLike[]
}) {
  const {
    downloadHrefs,
    labels,
    slotCount,
    blobsLoading: legacyLoading,
    listError: legacyError,
  } = useResultBlobUrls(raceId)

  const [flexLoading, setFlexLoading] = useState(true)
  const [categoryUrls, setCategoryUrls] = useState<Record<string, string | null>>({})
  const [apiCategories, setApiCategories] = useState<CategoryLike[]>([])
  const [combined, setCombined] = useState<CombinedItem[]>([])
  const [waves, setWaves] = useState<{ id: string; label: string; url: string }[]>([])
  const [groups, setGroups] = useState<{ id: string; label: string; url: string }[]>([])

  useEffect(() => {
    let cancelled = false
    setFlexLoading(true)
    setCombined([])
    setWaves([])
    setGroups([])
    setCategoryUrls({})

    const q = new URLSearchParams({ raceId })
    fetch(`/api/results-files?${q}`, { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then((d: FlexibleResultsResponse) => {
        if (cancelled) return
        if (!d?.ok) {
          setCategoryUrls({})
          setApiCategories([])
          setWaves([])
          setGroups([])
          setCombined(normalizeCombined(null, combinedResultsUrl))
          return
        }
        setCategoryUrls(d.urls ?? {})
        setApiCategories(Array.isArray(d.categories) ? d.categories : [])
        setCombined(normalizeCombined(d.combined))
        setWaves((d.waves ?? []).map(w => ({ id: w.id, label: w.label, url: w.url })))
        setGroups((d.groups ?? []).map(g => ({ id: g.id, label: g.label, url: g.url })))
      })
      .catch(() => {
        if (cancelled) return
        setCategoryUrls({})
        setApiCategories([])
        setWaves([])
        setGroups([])
        setCombined(normalizeCombined(null, combinedResultsUrl))
      })
      .finally(() => {
        if (!cancelled) setFlexLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [raceId, combinedResultsUrl])

  const resolvedCategories = categories.length > 0 ? categories : apiCategories

  const publishedCategories = useMemo(() => {
    return resolvedCategories
      .map(c => ({ cat: c, href: categoryUrls[c.id] ?? null }))
      .filter(x => x.href)
  }, [resolvedCategories, categoryUrls])

  const legacyRows = useMemo(
    () =>
      Array.from({ length: slotCount }, (_, i) => i + 1)
        .map(slot => ({
          slot,
          label: labels[slot] ?? `Wyniki ${slot}`,
          href: downloadHrefs[slot] ?? null,
        }))
        .filter(row => row.href),
    [downloadHrefs, labels, slotCount],
  )

  const hasFlexible =
    combined.length > 0 || publishedCategories.length > 0 || waves.length > 0 || groups.length > 0
  const hasLegacy = legacyRows.length > 0
  const loading = flexLoading || legacyLoading

  if (loading) {
    return <p className={styles.message}>Ładowanie listy wyników…</p>
  }

  if (!hasFlexible && !hasLegacy) {
    if (legacyError && !combinedResultsUrl) {
      return <p className={styles.message}>{legacyError}</p>
    }
    return <p className={styles.message}>Wyniki nie zostały jeszcze opublikowane.</p>
  }

  return (
    <div className={styles.list}>
      {combined.map((f, i) => (
        <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className={styles.item}>
          <span>
            {f.label?.trim() ||
              (combined.length > 1 ? `Wyniki łączne ${i + 1}` : 'Wyniki łączne')}
          </span>
          <span className={styles.itemAction}>Pobierz</span>
        </a>
      ))}
      {groups.map(g => (
        <a key={g.id} href={g.url} target="_blank" rel="noreferrer" className={styles.item}>
          <span>{g.label}</span>
          <span className={styles.itemAction}>Pobierz</span>
        </a>
      ))}
      {waves.map(w => (
        <a key={w.id} href={w.url} target="_blank" rel="noreferrer" className={styles.item}>
          <span>{w.label}</span>
          <span className={styles.itemAction}>Pobierz</span>
        </a>
      ))}
      {publishedCategories.map(x => (
        <a key={x.cat.id} href={x.href ?? '#'} target="_blank" rel="noreferrer" className={styles.item}>
          <span>{x.cat.name}</span>
          <span className={styles.itemAction}>Pobierz</span>
        </a>
      ))}
      {legacyRows.map(row => (
        <a key={`legacy-${row.slot}`} href={row.href ?? '#'} target="_blank" rel="noreferrer" className={styles.item}>
          <span>{row.label}</span>
          <span className={styles.itemAction}>Pobierz</span>
        </a>
      ))}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import styles from '@/app/wyniki/[id]/page.module.css'
import listStyles from './RaceStartlistDownloads.module.css'

type CategoryLike = { id: string; name: string }

type StartlistsResponse = {
  ok?: boolean
  urls?: Record<string, string | null>
  combined?: { url: string; fileName: string } | null
  waves?: { id: string; label: string; url: string; fileName: string }[]
  groups?: { id: string; label: string; url: string; fileName: string }[]
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
  const [combined, setCombined] = useState<{ url: string; fileName: string } | null>(
    combinedStartlistUrl ? { url: combinedStartlistUrl, fileName: '' } : null,
  )
  const [waves, setWaves] = useState<{ id: string; label: string; url: string }[]>([])
  const [groups, setGroups] = useState<{ id: string; label: string; url: string }[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const q = new URLSearchParams({ raceId })
    fetch(`/api/startlists?${q}`, { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then((d: StartlistsResponse) => {
        if (cancelled) return
        if (!d?.ok) {
          setUrls({})
          setWaves([])
          setGroups([])
          if (!combinedStartlistUrl) setCombined(null)
          return
        }
        setUrls(d.urls ?? {})
        setCombined(d.combined ?? (combinedStartlistUrl ? { url: combinedStartlistUrl, fileName: '' } : null))
        setWaves((d.waves ?? []).map(w => ({ id: w.id, label: w.label, url: w.url })))
        setGroups((d.groups ?? []).map(g => ({ id: g.id, label: g.label, url: g.url })))
      })
      .catch(() => {
        if (cancelled) return
        setUrls({})
        setWaves([])
        setGroups([])
        if (!combinedStartlistUrl) setCombined(null)
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

  const hasAny =
    Boolean(combined?.url) || publishedCategories.length > 0 || waves.length > 0 || groups.length > 0

  if (loading && !combinedStartlistUrl) return null
  if (!hasAny) return null

  return (
    <>
      <h2 className={styles.cardTitle}>Pobierz listy startowe</h2>
      <div className={styles.downloadsBody}>
        <div className={listStyles.list}>
          {combined?.url ? (
            <a href={combined.url} target="_blank" rel="noreferrer" className={listStyles.item}>
              <span className={listStyles.label}>Lista łączna</span>
              <span className={listStyles.action}>Pobierz</span>
            </a>
          ) : null}
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
        </div>
      </div>
    </>
  )
}

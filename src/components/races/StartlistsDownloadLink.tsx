'use client'

import { useCallback, useEffect, useState } from 'react'
import RaceDownloadsModal from '@/components/races/RaceDownloadsModal'
import RaceStartlistsDownloads from '@/components/results/RaceStartlistsDownloads'

export default function StartlistsDownloadLink({
  raceId,
  raceName,
  className,
  label = 'Listy startowe',
  startlistUrl,
}: {
  raceId: string
  raceName?: string
  className: string
  label?: string
  /** Bezpośredni URL listy łącznej (jeśli już znany z danych wyścigu). */
  startlistUrl?: string
}) {
  const [hasStartlists, setHasStartlists] = useState(Boolean(startlistUrl))
  const [loading, setLoading] = useState(!startlistUrl)
  const [open, setOpen] = useState(false)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const q = new URLSearchParams({ raceId })
    fetch(`/api/startlists?${q.toString()}`, { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then(
        (d: {
          ok?: boolean
          urls?: Record<string, string | null>
          combined?: unknown[] | { url?: string } | null
          waves?: { url: string }[]
          groups?: { url: string }[]
        }) => {
          if (cancelled) return
          const urls = d?.urls ?? {}
          const anyCategory = Object.values(urls).some(Boolean)
          const anyWave = (d.waves ?? []).some(w => Boolean(w.url))
          const anyGroup = (d.groups ?? []).some(g => Boolean(g.url))
          const anyCombined = Array.isArray(d.combined)
            ? d.combined.some(c => Boolean(c && typeof c === 'object' && 'url' in c && c.url)) ||
              Boolean(startlistUrl)
            : Boolean(
                (d.combined && typeof d.combined === 'object' && d.combined.url) || startlistUrl,
              )
          setHasStartlists(anyCategory || anyWave || anyGroup || anyCombined)
        },
      )
      .catch(() => {
        if (cancelled) return
        setHasStartlists(Boolean(startlistUrl))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [raceId, startlistUrl])

  if (loading || !hasStartlists) return null

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <RaceDownloadsModal title="Listy startowe" subtitle={raceName} onClose={close}>
          <RaceStartlistsDownloads raceId={raceId} combinedStartlistUrl={startlistUrl} />
        </RaceDownloadsModal>
      ) : null}
    </>
  )
}

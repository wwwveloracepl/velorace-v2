'use client'

import { useCallback, useEffect, useState } from 'react'
import RaceDownloadsModal from '@/components/races/RaceDownloadsModal'
import RaceResultsDownloads from '@/components/results/RaceResultsDownloads'

export default function ResultsDownloadLink({
  raceId,
  raceName,
  className,
  label = 'Pobierz wyniki',
  combinedResultsUrl,
}: {
  raceId: string
  raceName?: string
  className: string
  /** Unused when results are missing — link is hidden entirely. */
  disabledClassName?: string
  label?: string
  /** Bezpośredni URL wyników zbiorczych (jeśli już znany z danych wyścigu). */
  combinedResultsUrl?: string
}) {
  const [hasResults, setHasResults] = useState(Boolean(combinedResultsUrl))
  const [loading, setLoading] = useState(!combinedResultsUrl)
  const [open, setOpen] = useState(false)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (combinedResultsUrl) {
      setHasResults(true)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    const q = new URLSearchParams({ raceId })
    Promise.all([
      fetch(`/api/results-files?${q}`, { cache: 'no-store' }).then(r => r.json().catch(() => ({}))),
      fetch(`/api/results?${q}`, { cache: 'no-store' }).then(r => r.json().catch(() => ({}))),
    ])
      .then(
        ([flex, legacy]: [
          {
            ok?: boolean
            urls?: Record<string, string | null>
            combined?: unknown[] | { url?: string } | null
            waves?: { url: string }[]
            groups?: { url: string }[]
          },
          { urls?: Record<string, string | null> },
        ]) => {
          if (cancelled) return
          const flexUrls = flex?.urls ?? {}
          const anyCategory = Object.values(flexUrls).some(Boolean)
          const anyWave = (flex.waves ?? []).some(w => Boolean(w.url))
          const anyGroup = (flex.groups ?? []).some(g => Boolean(g.url))
          const anyCombined = Array.isArray(flex.combined)
            ? flex.combined.some(c => Boolean(c && typeof c === 'object' && 'url' in c && c.url))
            : Boolean(flex.combined && typeof flex.combined === 'object' && flex.combined.url)
          const anyLegacy = Object.values(legacy?.urls ?? {}).some(Boolean)
          setHasResults(anyCategory || anyWave || anyGroup || anyCombined || anyLegacy)
        },
      )
      .catch(() => {
        if (cancelled) return
        setHasResults(false)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [raceId, combinedResultsUrl])

  if (loading || !hasResults) return null

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <RaceDownloadsModal title="Wyniki" subtitle={raceName} onClose={close}>
          <RaceResultsDownloads raceId={raceId} combinedResultsUrl={combinedResultsUrl} />
        </RaceDownloadsModal>
      ) : null}
    </>
  )
}

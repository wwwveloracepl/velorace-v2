'use client'

import { useEffect, useState } from 'react'

export default function ResultsDownloadLink({
  raceId,
  className,
  label = 'Pobierz wyniki',
  combinedResultsUrl,
}: {
  raceId: string
  className: string
  /** Unused when results are missing — link is hidden entirely. */
  disabledClassName?: string
  label?: string
  /** Bezpośredni URL wyników zbiorczych (jeśli już znany z danych wyścigu). */
  combinedResultsUrl?: string
}) {
  const [hasResults, setHasResults] = useState(Boolean(combinedResultsUrl))
  const [loading, setLoading] = useState(!combinedResultsUrl)

  useEffect(() => {
    if (combinedResultsUrl) {
      setHasResults(true)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    const q = new URLSearchParams({ raceId })
    fetch(`/api/results?${q.toString()}`, { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then((d: { ok?: boolean; urls?: Record<string, string | null> }) => {
        if (cancelled) return
        const urls = d?.urls ?? {}
        const any = Object.values(urls).some(Boolean)
        setHasResults(any)
      })
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

  if (combinedResultsUrl) {
    return (
      <a href={combinedResultsUrl} className={className} target="_blank" rel="noreferrer">
        {label}
      </a>
    )
  }

  return (
    <a href={`/wyniki/${raceId}/pobierz`} className={className}>
      {label}
    </a>
  )
}

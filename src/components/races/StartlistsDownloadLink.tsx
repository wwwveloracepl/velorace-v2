'use client'

import { useEffect, useState } from 'react'

export default function StartlistsDownloadLink({
  raceId,
  className,
  label = 'Listy startowe',
  startlistUrl,
}: {
  raceId: string
  className: string
  label?: string
  /** Bezpośredni URL listy łącznej (jeśli już znany z danych wyścigu). */
  startlistUrl?: string
}) {
  const [hasStartlists, setHasStartlists] = useState(Boolean(startlistUrl))
  const [loading, setLoading] = useState(!startlistUrl)

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
          combined?: { url: string } | null
          waves?: { url: string }[]
          groups?: { url: string }[]
        }) => {
          if (cancelled) return
          const urls = d?.urls ?? {}
          const anyCategory = Object.values(urls).some(Boolean)
          const anyWave = (d.waves ?? []).some(w => Boolean(w.url))
          const anyGroup = (d.groups ?? []).some(g => Boolean(g.url))
          const anyCombined = Boolean(d.combined?.url || startlistUrl)
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
    <a href={`/wyniki/${raceId}`} className={className}>
      {label}
    </a>
  )
}

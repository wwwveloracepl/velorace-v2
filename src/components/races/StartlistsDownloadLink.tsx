'use client'

import { useEffect, useState } from 'react'

export default function StartlistsDownloadLink({
  raceId,
  className,
  label = 'Listy startowe',
}: {
  raceId: string
  className: string
  label?: string
}) {
  const [hasStartlists, setHasStartlists] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const q = new URLSearchParams({ raceId })
    fetch(`/api/startlists?${q.toString()}`, { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})))
      .then((d: { ok?: boolean; urls?: Record<string, string | null> }) => {
        if (cancelled) return
        const urls = d?.urls ?? {}
        const any = Object.values(urls).some(Boolean)
        setHasStartlists(any)
      })
      .catch(() => {
        if (cancelled) return
        setHasStartlists(false)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [raceId])

  if (loading || !hasStartlists) return null

  return (
    <a href={`/wyniki/${raceId}`} className={className}>
      {label}
    </a>
  )
}

'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import type { AdminDbRaceListItem } from '@/lib/raceDb'
import styles from './AdminDashboard.module.css'

function yearFromRaceDate(iso: string): number | null {
  if (!iso || iso.length < 4) return null
  const y = Number.parseInt(iso.slice(0, 4), 10)
  return Number.isFinite(y) ? y : null
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Szkic',
  published: 'Opublikowany',
  registration_open: 'Zapisy otwarte',
  registration_closed: 'Zapisy zamknięte',
  live: 'Na żywo',
  finished: 'Zakończony',
  cancelled: 'Odwołany',
}

function raceDateBadgeParts(raceDate: string): { day: string; month: string; dateLine: string } {
  const m = raceDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return { day: '—', month: '—', dateLine: raceDate }
  const [, y, mo, d] = m
  const MONTHS = ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAŹ', 'LIS', 'GRU'] as const
  const mi = Number(mo) - 1
  return {
    day: String(Number(d)),
    month: mi >= 0 && mi < 12 ? MONTHS[mi] : '—',
    dateLine: `${d}.${mo}.${y} r.`,
  }
}

export type AdminHistoryTabHandle = {
  backToRoot: () => void
}

type AdminHistoryTabProps = {
  onOpenEditRace?: (race: AdminDbRaceListItem) => void | Promise<void>
}

const AdminHistoryTab = forwardRef<AdminHistoryTabHandle, AdminHistoryTabProps>(function AdminHistoryTab(
  { onOpenEditRace },
  ref,
) {
  const [races, setRaces] = useState<AdminDbRaceListItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setErr(null)
    fetch('/api/admin/races/database', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { ok?: boolean; races?: AdminDbRaceListItem[]; message?: string }) => {
        if (cancelled) return
        if (!d?.ok || !Array.isArray(d.races)) {
          setErr(d?.message || 'Nie udało się wczytać wyścigów.')
          setRaces([])
          return
        }
        setRaces(d.races)
      })
      .catch(() => {
        if (!cancelled) {
          setErr('Brak połączenia z serwerem.')
          setRaces([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const raceList = races ?? []

  const nowY = new Date().getFullYear()

  const years = useMemo(() => {
    const cut = new Date().getFullYear()
    const s = new Set<number>()
    for (const r of raceList) {
      const y = yearFromRaceDate(r.race_date)
      if (y != null && y < cut) s.add(y)
    }
    return Array.from(s).sort((a, b) => b - a)
  }, [raceList])

  useEffect(() => {
    if (year != null || years.length === 0) return
    setYear(years[0])
  }, [years, year])

  const filtered = useMemo(() => {
    if (year == null) return []
    return raceList
      .filter(r => yearFromRaceDate(r.race_date) === year)
      .sort((a, b) => b.race_date.localeCompare(a.race_date) || a.name.localeCompare(b.name))
  }, [raceList, year])

  useImperativeHandle(
    ref,
    () => ({
      backToRoot: () => {
        if (years.length > 0) setYear(years[0])
      },
    }),
    [years],
  )

  return (
    <div className={styles.panel}>
      <p className={styles.intro}>
        Archiwum: tylko lata wcześniejsze niż bieżący rok kalendarzowy ({nowY}). Wyścigi z bieżącego roku edytujesz w
        zakładce „Lista wyścigów”.
      </p>

      {err && (
        <p className={styles.formError} role="alert">
          {err}
        </p>
      )}

      {races === null && !err && <p className={styles.placeholder}>Wczytywanie…</p>}

      {years.length > 0 && (
        <div className={styles.historyToolbar}>
          <label className={styles.historyYearField}>
            <span className={styles.formLabel}>Rok</span>
            <select
              className={styles.formSelect}
              value={year ?? ''}
              onChange={e => setYear(Number.parseInt(e.target.value, 10))}
            >
              {years.map(y => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {races !== null && years.length === 0 && !err && raceList.length > 0 && (
        <p className={styles.placeholder}>
          Brak wyścigów z datą sprzed roku {nowY} — wszystkie znane terminy są w bieżącym roku (patrz „Lista wyścigów”).
        </p>
      )}
      {races !== null && years.length === 0 && !err && raceList.length === 0 && (
        <p className={styles.placeholder}>Brak wyścigów na liście.</p>
      )}

      {year != null && filtered.length === 0 && years.length > 0 && (
        <p className={styles.placeholder}>W roku {year} nie ma żadnego wyścigu na liście.</p>
      )}

      {filtered.length > 0 && (
        <ul className={styles.editRaceList}>
          {filtered.map(race => {
            const { day, month, dateLine } = raceDateBadgeParts(race.race_date)
            const st = STATUS_LABEL[race.status] ?? race.status
            return (
              <li key={race.id} className={styles.editRaceListItem}>
                <div className={styles.editRaceListMain}>
                  <div className={styles.editRaceListRow}>
                    <div className={`${styles.raceListDate} ${styles.editRaceDateBadge}`}>
                      <span className={`${styles.raceListDay} ${styles.editRaceDay}`}>{day}</span>
                      <span className={`${styles.raceListMonth} ${styles.editRaceMonth}`}>{month}</span>
                    </div>
                    <div className={styles.editRaceListText}>
                      <div className={styles.editRaceListTitle}>{race.name}</div>
                      <div className={styles.editRaceListMetaRow}>
                        <span className={styles.editRaceListMetaItem}>
                          <span className={styles.editRaceListMetaIcon} aria-hidden>
                            📍
                          </span>
                          {race.city}
                        </span>
                        <span className={styles.editRaceListMetaItem}>
                          <span className={styles.editRaceListMetaIcon} aria-hidden>
                            📅
                          </span>
                          {dateLine}
                        </span>
                        <span className={styles.editRaceListMetaStatus}>{st}</span>
                      </div>
                      <div className={styles.editRaceListSlug}>
                        <code>{race.slug}</code>
                      </div>
                    </div>
                  </div>
                </div>
                <div className={styles.historyActions}>
                  <a className={styles.btnSecondary} href={`/wyniki/${encodeURIComponent(race.id)}`}>
                    Szczegóły wyścigu
                  </a>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => void onOpenEditRace?.(race)}
                  >
                    Edytuj wyścig
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})

export default AdminHistoryTab

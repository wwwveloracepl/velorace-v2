'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AdminDbRaceListItem } from '@/lib/raceDb'
import styles from './AdminDashboard.module.css'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Szkic',
  published: 'Opublikowany',
  registration_open: 'Zapisy otwarte',
  registration_closed: 'Zapisy zamknięte',
  live: 'Na żywo',
  finished: 'Zakończony',
  cancelled: 'Odwołany',
}

function calendarYearFromRaceDate(raceDate: string): number | null {
  const m = raceDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number.parseInt(m[1], 10)
  return Number.isFinite(y) ? y : null
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

type AdminRaceListTabProps = {
  onOpenEditRace?: (race: AdminDbRaceListItem) => void | Promise<void>
}

export default function AdminRaceListTab({ onOpenEditRace }: AdminRaceListTabProps) {
  const [listCalendarYear] = useState(() => new Date().getFullYear())
  const [races, setRaces] = useState<AdminDbRaceListItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setErr(null)
    fetch('/api/admin/races/database', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(r => r.json())
      .then((d: { ok?: boolean; races?: AdminDbRaceListItem[]; message?: string }) => {
        if (cancelled) return
        if (!d?.ok || !Array.isArray(d.races)) {
          setErr(d?.message || 'Nie udało się wczytać wyścigów.')
          setRaces([])
          return
        }
        setRaces(d.races.filter(x => calendarYearFromRaceDate(x.race_date) === listCalendarYear))
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
  }, [listCalendarYear])

  const sortedList = useMemo(() => {
    if (!races) return null
    return [...races].sort(
      (a, b) => b.race_date.localeCompare(a.race_date) || a.name.localeCompare(b.name),
    )
  }, [races])

  return (
    <div className={styles.panel}>
      <p className={styles.intro}>
        Wyścigi z bieżącego roku kalendarzowego ({listCalendarYear}). Wyniki i listy startowe wgrywasz po wejściu w
        „Edytuj”. Nowy wyścig dodasz w zakładce „Dodaj wyścig”. Starsze edycje znajdziesz w „Historia”.
      </p>

      {err && (
        <p className={styles.formError} role="alert">
          {err}
        </p>
      )}

      {sortedList === null && !err && <p className={styles.placeholder}>Wczytywanie listy…</p>}

      {sortedList && sortedList.length === 0 && !err && (
        <p className={styles.placeholder}>
          Brak wyścigów w bazie z datą w bieżącym roku ({listCalendarYear}) — dodaj wyścig w zakładce „Dodaj
          wyścig” albo zajrzyj do „Historia”, jeśli szukasz wcześniejszych lat.
        </p>
      )}

      {sortedList && sortedList.length > 0 && (
        <ul className={styles.editRaceList}>
          {sortedList.map(race => {
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
                <div className={styles.raceListActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => void onOpenEditRace?.(race)}
                  >
                    Edytuj
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

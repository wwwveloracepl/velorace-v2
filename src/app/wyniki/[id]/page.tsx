import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import RaceResultsDownloads from '@/components/results/RaceResultsDownloads'
import RaceStartlistsSection from '@/components/results/RaceStartlistsSection'
import { formatDate } from '@/lib/data'
import { getRaceByIdFromDatabase, getRaceCategoryDetails, getRaceResultsPdfContext } from '@/lib/raceDb'
import { getRaceTypeLabel } from '@/lib/raceDisplay'
import { notFound } from 'next/navigation'
import styles from './page.module.css'

interface Props {
  params: { id: string }
}

export default async function RaceResultsPage({ params }: Props) {
  const [race, pdfCtx, categoryDetails] = await Promise.all([
    getRaceByIdFromDatabase(params.id),
    getRaceResultsPdfContext(params.id),
    getRaceCategoryDetails(params.id),
  ])
  if (!race) notFound()

  const { full } = formatDate(race.date)
  const categoriesSortedByWave = [...categoryDetails].sort((a, b) => {
    const parseWaveMinutes = (value: string | null) => {
      if (!value) return Number.POSITIVE_INFINITY
      const m = value.match(/^(\d{1,2}):(\d{2})/)
      if (!m) return Number.POSITIVE_INFINITY
      const hh = Number(m[1])
      const mm = Number(m[2])
      if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return Number.POSITIVE_INFINITY
      }
      return hh * 60 + mm
    }
    const da = parseWaveMinutes(a.waveStartTime)
    const db = parseWaveMinutes(b.waveStartTime)
    if (da !== db) return da - db
    return a.name.localeCompare(b.name, 'pl')
  })

  const categoriesForStartlists = categoriesSortedByWave.map(c => ({ id: c.id, name: c.name }))

  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <div className={styles.back}>
          <a href="/">← Powrót do strony głównej</a>
        </div>

        <div className={styles.header}>
          <h1 className={styles.title}>{race.name}</h1>
          <p className={styles.subtitle}>
            {full} · {race.city} · {getRaceTypeLabel(race.type || race.category)}
          </p>
          {(race.regulationUrl || race.startlistUrl) ? (
            <div className={styles.headerActions}>
              {race.regulationUrl ? (
                <a href={race.regulationUrl} className={styles.regulationLink} target="_blank" rel="noreferrer">
                  Pobierz regulamin
                </a>
              ) : null}
              {race.startlistUrl ? (
                <a href={race.startlistUrl} className={styles.regulationLink} target="_blank" rel="noreferrer">
                  Pobierz listę startową
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.contentGrid}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Szczegóły wyścigu</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoRow}>
                <span>Data</span>
                <span>{full}</span>
              </div>
              <div className={styles.infoRow}>
                <span>Miejscowość</span>
                <span>{race.city}</span>
              </div>
              <div className={styles.infoRow}>
                <span>Typ</span>
                <span>{getRaceTypeLabel(race.type || race.category)}</span>
              </div>
            </div>
            <div className={styles.extraInfo}>
              <div className={styles.extraBlock}>
                <h3 className={styles.extraTitle}>Kategorie</h3>
                {categoriesSortedByWave.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.catTable}>
                      <thead>
                        <tr>
                          <th>Kategoria</th>
                          <th>Dystans</th>
                          <th>Okrążenia</th>
                          <th>Dł. okrążenia</th>
                          <th>Czas startu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoriesSortedByWave.map(cat => (
                          <tr key={cat.id}>
                            <td>{cat.name}</td>
                            <td>{cat.distanceKm != null ? `${cat.distanceKm} km` : '—'}</td>
                            <td>{cat.lapCount != null ? String(cat.lapCount) : '—'}</td>
                            <td>{cat.lapDistanceKm != null ? `${cat.lapDistanceKm} km` : '—'}</td>
                            <td>{cat.waveStartTime ? cat.waveStartTime.slice(0, 5) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.compactHint}>Brak zdefiniowanych kategorii.</p>
                )}
              </div>
              <div className={styles.extraBlock}>
                <h3 className={styles.extraTitle}>Czasy startów kategorii</h3>
                {pdfCtx?.waveSlots?.length ? (
                  <div className={styles.pills}>
                    {pdfCtx.waveSlots.map(slot => (
                      <span key={`wave-${slot.slot}`} className={styles.pill}>
                        {slot.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className={styles.compactHint}>Brak zdefiniowanych czasów startu.</p>
                )}
              </div>
            </div>
          </section>

          <aside className={`${styles.card} ${styles.sideCard}`}>
            <h2 className={styles.cardTitle}>Pobierz wyniki</h2>
            <div className={styles.downloadsBody}>
              <RaceResultsDownloads
                raceId={race.id}
                combinedResultsUrl={race.combinedResultsUrl}
                categories={categoriesForStartlists}
              />
            </div>
            <RaceStartlistsSection
              raceId={race.id}
              categories={categoriesForStartlists}
              combinedStartlistUrl={race.startlistUrl}
            />
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}

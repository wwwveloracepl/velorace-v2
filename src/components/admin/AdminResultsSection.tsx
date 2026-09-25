'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './AdminDashboard.module.css'

type FileMeta = { url: string; fileName: string; uploadedAt?: string }
type CombinedFile = FileMeta & { id: string; label?: string }

type CategorySlot = { id: string; name: string; url: string | null; fileName: string | null }
type WaveSlot = { id: string; label: string; url: string | null; fileName: string | null }
type GroupSlot = {
  id: string
  label: string
  url: string | null
  fileName: string | null
  uploadedAt?: string | null
  categories: { id: string; name: string }[]
}

type ResultsPayload = {
  ok?: boolean
  message?: string
  combined: CombinedFile[] | CombinedFile | null
  categories: CategorySlot[]
  waves: WaveSlot[]
  groups: GroupSlot[]
}

function normalizeCombined(raw: ResultsPayload['combined']): CombinedFile[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(f => f?.url)
  return raw.url ? [{ ...raw, id: (raw as CombinedFile).id || 'legacy' }] : []
}

export default function AdminResultsSection({
  raceId,
  raceName,
  refreshKey = 0,
}: {
  raceId: string | null
  raceName?: string
  /** Zmiana wymusza odświeżenie (np. po zapisie kategorii/fal). */
  refreshKey?: number
}) {
  const combinedInputRef = useRef<HTMLInputElement>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)
  const waveInputRef = useRef<HTMLInputElement>(null)
  const groupInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [combined, setCombined] = useState<CombinedFile[]>([])
  const [combinedLabel, setCombinedLabel] = useState('')
  const [categories, setCategories] = useState<CategorySlot[]>([])
  const [waves, setWaves] = useState<WaveSlot[]>([])
  const [groups, setGroups] = useState<GroupSlot[]>([])

  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null)
  const [pendingWaveId, setPendingWaveId] = useState<string | null>(null)
  const [groupSelected, setGroupSelected] = useState<Record<string, boolean>>({})
  const [groupLabel, setGroupLabel] = useState('')
  const [cardOpen, setCardOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  function toggleSection(key: string) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const load = useCallback(async () => {
    if (!raceId) {
      setCombined([])
      setCategories([])
      setWaves([])
      setGroups([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/results-files`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as ResultsPayload
      if (!res.ok || !data.ok) {
        setError(data.message || 'Nie udało się wczytać wyników.')
        return
      }
      setCombined(normalizeCombined(data.combined))
      setCategories(data.categories ?? [])
      setWaves(data.waves ?? [])
      setGroups(data.groups ?? [])
    } catch {
      setError('Błąd połączenia podczas wczytywania wyników.')
    } finally {
      setLoading(false)
    }
  }, [raceId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function uploadCombined(file: File) {
    if (!raceId) return
    setBusyKey('combined-new')
    setError('')
    setSuccess('')
    try {
      const data = new FormData()
      data.set('file', file)
      if (combinedLabel.trim()) data.set('label', combinedLabel.trim())
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/results-combined/upload`, {
        method: 'POST',
        credentials: 'include',
        body: data,
      })
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        id?: string
        label?: string
        url?: string
        fileName?: string
      }
      if (!res.ok || !payload.ok || !payload.url || !payload.id) {
        setError(payload.message || 'Nie udało się wgrać wyników łącznych.')
        return
      }
      setCombined(prev => [
        ...prev,
        {
          id: payload.id!,
          label: payload.label || combinedLabel.trim(),
          url: payload.url!,
          fileName: payload.fileName || file.name,
          uploadedAt: new Date().toISOString(),
        },
      ])
      setCombinedLabel('')
      setSuccess('Wgrano wyniki łączne.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteCombined(fileId: string) {
    if (!raceId) return
    if (!window.confirm('Usunąć ten plik wyników łącznych?')) return
    setBusyKey(`combined:${fileId}`)
    setError('')
    setSuccess('')
    try {
      const q = new URLSearchParams(
        fileId === 'legacy' ? { legacy: '1' } : { fileId },
      )
      const res = await fetch(
        `/api/admin/races/${encodeURIComponent(raceId)}/results-combined/upload?${q.toString()}`,
        { method: 'DELETE', credentials: 'include' },
      )
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć wyników łącznych.')
        return
      }
      setCombined(prev => prev.filter(f => f.id !== fileId))
      setSuccess('Usunięto plik wyników łącznych.')
    } catch {
      setError('Błąd połączenia podczas usuwania.')
    } finally {
      setBusyKey(null)
    }
  }

  async function uploadSlot(kind: 'category' | 'wave', id: string, file: File) {
    if (!raceId) return
    setBusyKey(`${kind}:${id}`)
    setError('')
    setSuccess('')
    try {
      const data = new FormData()
      data.set('file', file)
      if (kind === 'category') data.set('categoryId', id)
      else data.set('waveId', id)
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/results-files/upload`, {
        method: 'POST',
        credentials: 'include',
        body: data,
      })
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        url?: string
        fileName?: string
      }
      if (!res.ok || !payload.ok || !payload.url) {
        setError(payload.message || 'Nie udało się wgrać wyników.')
        return
      }
      if (kind === 'category') {
        setCategories(prev =>
          prev.map(c =>
            c.id === id ? { ...c, url: payload.url!, fileName: payload.fileName || file.name } : c,
          ),
        )
      } else {
        setWaves(prev =>
          prev.map(w =>
            w.id === id ? { ...w, url: payload.url!, fileName: payload.fileName || file.name } : w,
          ),
        )
      }
      setSuccess('Wgrano wyniki.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteSlot(kind: 'category' | 'wave', id: string) {
    if (!raceId) return
    if (!window.confirm('Usunąć te wyniki?')) return
    setBusyKey(`${kind}:${id}`)
    setError('')
    setSuccess('')
    try {
      const q = new URLSearchParams(kind === 'category' ? { categoryId: id } : { waveId: id })
      const res = await fetch(
        `/api/admin/races/${encodeURIComponent(raceId)}/results-files/upload?${q.toString()}`,
        { method: 'DELETE', credentials: 'include' },
      )
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć wyników.')
        return
      }
      if (kind === 'category') {
        setCategories(prev => prev.map(c => (c.id === id ? { ...c, url: null, fileName: null } : c)))
      } else {
        setWaves(prev => prev.map(w => (w.id === id ? { ...w, url: null, fileName: null } : w)))
      }
      setSuccess('Usunięto wyniki.')
    } catch {
      setError('Błąd połączenia podczas usuwania.')
    } finally {
      setBusyKey(null)
    }
  }

  async function uploadGroup(file: File) {
    if (!raceId) return
    const categoryIds = Object.entries(groupSelected)
      .filter(([, on]) => on)
      .map(([id]) => id)
    if (categoryIds.length < 2) {
      setError('Wybierz co najmniej dwie kategorie do jednej listy wyników.')
      return
    }
    setBusyKey('group-new')
    setError('')
    setSuccess('')
    try {
      const data = new FormData()
      data.set('file', file)
      data.set('categoryIds', JSON.stringify(categoryIds))
      if (groupLabel.trim()) data.set('label', groupLabel.trim())
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/results-groups/upload`, {
        method: 'POST',
        credentials: 'include',
        body: data,
      })
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        id?: string
        label?: string
        url?: string
        fileName?: string
        categoryIds?: string[]
      }
      if (!res.ok || !payload.ok || !payload.id || !payload.url) {
        setError(payload.message || 'Nie udało się wgrać wyników dla grupy.')
        return
      }
      const cats = categories
        .filter(c => (payload.categoryIds ?? categoryIds).includes(c.id))
        .map(c => ({ id: c.id, name: c.name }))
      setGroups(prev => [
        ...prev,
        {
          id: payload.id!,
          label: payload.label || groupLabel || cats.map(c => c.name).join(' + '),
          url: payload.url!,
          fileName: payload.fileName || file.name,
          uploadedAt: new Date().toISOString(),
          categories: cats,
        },
      ])
      setGroupSelected({})
      setGroupLabel('')
      setSuccess('Wgrano wyniki dla grupy kategorii.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteGroup(groupId: string) {
    if (!raceId) return
    if (!window.confirm('Usunąć wyniki tej grupy kategorii?')) return
    setBusyKey(`group:${groupId}`)
    setError('')
    setSuccess('')
    try {
      const q = new URLSearchParams({ groupId })
      const res = await fetch(
        `/api/admin/races/${encodeURIComponent(raceId)}/results-groups/upload?${q.toString()}`,
        { method: 'DELETE', credentials: 'include' },
      )
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć wyników grupy.')
        return
      }
      setGroups(prev => prev.filter(g => g.id !== groupId))
      setSuccess('Usunięto wyniki grupy.')
    } catch {
      setError('Błąd połączenia podczas usuwania.')
    } finally {
      setBusyKey(null)
    }
  }

  const idle = busyKey === null

  const categoryUploaded = categories.filter(c => c.url).length
  const waveUploaded = waves.filter(w => w.url).length
  const totalUploaded =
    combined.length + categoryUploaded + waveUploaded + groups.filter(g => g.url).length

  return (
    <div className={styles.regUploadCard}>
      <button
        type="button"
        className={styles.slCardToggle}
        onClick={() => setCardOpen(o => !o)}
        aria-expanded={cardOpen}
      >
        <div className={styles.regUploadHead} style={{ width: '100%', margin: 0 }}>
          <h3 className={styles.regUploadTitle}>
            <span className={styles.slSectionChevron} aria-hidden>
              {cardOpen ? '▼' : '▶'}
            </span>{' '}
            Wgraj wyniki
          </h3>
          {raceName ? <span className={styles.regUploadRace}>{raceName}</span> : null}
        </div>
      </button>

      {!cardOpen && raceId && !loading ? (
        <p className={styles.slCardSummary}>
          {totalUploaded > 0
            ? `Wgranych wyników: ${totalUploaded}`
            : 'Brak wgranych wyników — rozwiń, aby dodać'}
        </p>
      ) : null}

      {cardOpen ? (
        <>
          {!raceId ? (
            <p className={styles.formHint}>
              Najpierw zapisz wyścig — wtedy wgrasz wyniki łączne, per kategoria, per fala oraz własne
              grupy.
            </p>
          ) : null}

          {raceId && loading ? <p className={styles.formHint}>Wczytywanie wyników…</p> : null}

          {raceId && !loading ? (
            <>
              <div className={styles.slSection}>
                <button
                  type="button"
                  className={styles.slSectionToggle}
                  onClick={() => toggleSection('combined')}
                  aria-expanded={Boolean(openSections.combined)}
                >
                  <span className={styles.slSectionChevron} aria-hidden>
                    {openSections.combined ? '▼' : '▶'}
                  </span>
                  <h4 className={styles.slSectionTitle}>Wyniki łączne (cały wyścig)</h4>
                  <span className={styles.slSectionBadge}>{combined.length}</span>
                </button>
                {openSections.combined ? (
                  <div className={styles.slSectionBody}>
                    {combined.length === 0 ? (
                      <p className={styles.formHint}>Brak wyników łącznych — możesz wgrać kilka plików.</p>
                    ) : (
                      combined.map(f => (
                        <div key={f.id} className={styles.slRow}>
                          <div className={styles.slRowInfo}>
                            <span className={styles.slRowLabel}>
                              {f.label?.trim() || f.fileName || 'Wyniki łączne'}
                            </span>
                            <span className={styles.slRowMeta}>
                              <a href={f.url} target="_blank" rel="noreferrer">
                                Pobierz
                              </a>
                              {f.fileName && f.label?.trim() ? ` · ${f.fileName}` : ''}
                              {f.uploadedAt
                                ? ` · Wgrano: ${new Date(f.uploadedAt).toLocaleString('pl-PL')}`
                                : ''}
                            </span>
                          </div>
                          <div className={styles.slRowActions}>
                            <button
                              type="button"
                              className={styles.btnGhost}
                              disabled={!idle}
                              onClick={() => void deleteCombined(f.id)}
                            >
                              {busyKey === `combined:${f.id}` ? 'Usuwanie…' : 'Usuń'}
                            </button>
                          </div>
                        </div>
                      ))
                    )}

                    <div className={styles.slGroupForm}>
                      <label className={styles.formField}>
                        <span className={styles.formLabel}>Etykieta (opcjonalnie)</span>
                        <input
                          className={styles.formInput}
                          value={combinedLabel}
                          onChange={e => setCombinedLabel(e.target.value)}
                          placeholder="np. Dzień 1, Klasyfikacja generalna"
                        />
                      </label>
                      <div className={styles.regUploadActions}>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          disabled={!idle}
                          onClick={() => combinedInputRef.current?.click()}
                        >
                          {busyKey === 'combined-new' ? 'Wgrywanie…' : 'Dodaj plik wyników łącznych'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={styles.slSection}>
                <button
                  type="button"
                  className={styles.slSectionToggle}
                  onClick={() => toggleSection('categories')}
                  aria-expanded={Boolean(openSections.categories)}
                >
                  <span className={styles.slSectionChevron} aria-hidden>
                    {openSections.categories ? '▼' : '▶'}
                  </span>
                  <h4 className={styles.slSectionTitle}>Per kategoria</h4>
                  <span className={styles.slSectionBadge}>
                    {categoryUploaded} / {categories.length}
                  </span>
                </button>
                {openSections.categories ? (
                  <div className={styles.slSectionBody}>
                    {categories.length === 0 ? (
                      <p className={styles.formHint}>Brak zapisanych kategorii.</p>
                    ) : (
                      categories.map(c => (
                        <div key={c.id} className={styles.slRow}>
                          <div className={styles.slRowInfo}>
                            <span className={styles.slRowLabel}>{c.name || 'Bez nazwy'}</span>
                            {c.url ? (
                              <span className={styles.slRowMeta}>
                                <a href={c.url} target="_blank" rel="noreferrer">
                                  Pobierz
                                </a>
                                {c.fileName ? ` · ${c.fileName}` : ''}
                              </span>
                            ) : (
                              <span className={styles.slRowMeta}>Brak pliku</span>
                            )}
                          </div>
                          <div className={styles.slRowActions}>
                            {c.url ? (
                              <button
                                type="button"
                                className={styles.btnGhost}
                                disabled={!idle}
                                onClick={() => void deleteSlot('category', c.id)}
                              >
                                {busyKey === `category:${c.id}` ? 'Usuwanie…' : 'Usuń'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.btnSecondary}
                                disabled={!idle}
                                onClick={() => {
                                  setPendingCategoryId(c.id)
                                  categoryInputRef.current?.click()
                                }}
                              >
                                {busyKey === `category:${c.id}` ? 'Wgrywanie…' : 'Wgraj'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className={styles.slSection}>
                <button
                  type="button"
                  className={styles.slSectionToggle}
                  onClick={() => toggleSection('waves')}
                  aria-expanded={Boolean(openSections.waves)}
                >
                  <span className={styles.slSectionChevron} aria-hidden>
                    {openSections.waves ? '▼' : '▶'}
                  </span>
                  <h4 className={styles.slSectionTitle}>Per fala</h4>
                  <span className={styles.slSectionBadge}>
                    {waveUploaded} / {waves.length}
                  </span>
                </button>
                {openSections.waves ? (
                  <div className={styles.slSectionBody}>
                    {waves.length === 0 ? (
                      <p className={styles.formHint}>Brak zapisanych fal startu.</p>
                    ) : (
                      waves.map(w => (
                        <div key={w.id} className={styles.slRow}>
                          <div className={styles.slRowInfo}>
                            <span className={styles.slRowLabel}>{w.label}</span>
                            {w.url ? (
                              <span className={styles.slRowMeta}>
                                <a href={w.url} target="_blank" rel="noreferrer">
                                  Pobierz
                                </a>
                                {w.fileName ? ` · ${w.fileName}` : ''}
                              </span>
                            ) : (
                              <span className={styles.slRowMeta}>Brak pliku</span>
                            )}
                          </div>
                          <div className={styles.slRowActions}>
                            {w.url ? (
                              <button
                                type="button"
                                className={styles.btnGhost}
                                disabled={!idle}
                                onClick={() => void deleteSlot('wave', w.id)}
                              >
                                {busyKey === `wave:${w.id}` ? 'Usuwanie…' : 'Usuń'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.btnSecondary}
                                disabled={!idle}
                                onClick={() => {
                                  setPendingWaveId(w.id)
                                  waveInputRef.current?.click()
                                }}
                              >
                                {busyKey === `wave:${w.id}` ? 'Wgrywanie…' : 'Wgraj'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className={styles.slSection}>
                <button
                  type="button"
                  className={styles.slSectionToggle}
                  onClick={() => toggleSection('groups')}
                  aria-expanded={Boolean(openSections.groups)}
                >
                  <span className={styles.slSectionChevron} aria-hidden>
                    {openSections.groups ? '▼' : '▶'}
                  </span>
                  <h4 className={styles.slSectionTitle}>Grupa kategorii (własna)</h4>
                  <span className={styles.slSectionBadge}>{groups.length}</span>
                </button>
                {openSections.groups ? (
                  <div className={styles.slSectionBody}>
                    {groups.map(g => (
                      <div key={g.id} className={styles.slRow}>
                        <div className={styles.slRowInfo}>
                          <span className={styles.slRowLabel}>{g.label}</span>
                          <span className={styles.slRowMeta}>
                            {g.categories.map(c => c.name).join(', ')}
                            {g.url ? (
                              <>
                                {' · '}
                                <a href={g.url} target="_blank" rel="noreferrer">
                                  Pobierz
                                </a>
                                {g.fileName ? ` · ${g.fileName}` : ''}
                              </>
                            ) : null}
                          </span>
                        </div>
                        <div className={styles.slRowActions}>
                          <button
                            type="button"
                            className={styles.btnGhost}
                            disabled={!idle}
                            onClick={() => void deleteGroup(g.id)}
                          >
                            {busyKey === `group:${g.id}` ? 'Usuwanie…' : 'Usuń'}
                          </button>
                        </div>
                      </div>
                    ))}

                    {categories.length < 2 ? (
                      <p className={styles.formHint}>
                        Potrzebujesz co najmniej dwóch kategorii, aby utworzyć grupę.
                      </p>
                    ) : (
                      <div className={styles.slGroupForm}>
                        <p className={styles.formHint} style={{ margin: 0 }}>
                          Wybierz kategorie, które mają iść do jednego PDF wyników, i wgraj plik.
                        </p>
                        <div className={styles.slCheckList}>
                          {categories.map(c => (
                            <label key={c.id} className={styles.slCheckItem}>
                              <input
                                type="checkbox"
                                checked={Boolean(groupSelected[c.id])}
                                onChange={e =>
                                  setGroupSelected(prev => ({ ...prev, [c.id]: e.target.checked }))
                                }
                              />
                              <span>{c.name || 'Bez nazwy'}</span>
                            </label>
                          ))}
                        </div>
                        <label className={styles.formField}>
                          <span className={styles.formLabel}>Etykieta (opcjonalnie)</span>
                          <input
                            className={styles.formInput}
                            value={groupLabel}
                            onChange={e => setGroupLabel(e.target.value)}
                            placeholder="np. Elita M+K"
                          />
                        </label>
                        <div className={styles.regUploadActions}>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={!idle}
                            onClick={() => groupInputRef.current?.click()}
                          >
                            {busyKey === 'group-new' ? 'Wgrywanie…' : 'Wgraj wyniki dla grupy'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <input
            ref={combinedInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void uploadCombined(file)
              e.target.value = ''
            }}
          />
          <input
            ref={categoryInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              const id = pendingCategoryId
              setPendingCategoryId(null)
              if (file && id) void uploadSlot('category', id, file)
              e.target.value = ''
            }}
          />
          <input
            ref={waveInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              const id = pendingWaveId
              setPendingWaveId(null)
              if (file && id) void uploadSlot('wave', id, file)
              e.target.value = ''
            }}
          />
          <input
            ref={groupInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void uploadGroup(file)
              e.target.value = ''
            }}
          />

          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
          {!error && success ? <p className={styles.formSuccess}>{success}</p> : null}
        </>
      ) : null}
    </div>
  )
}

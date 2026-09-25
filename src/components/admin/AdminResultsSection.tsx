'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './AdminDashboard.module.css'

type CombinedFile = {
  id: string
  label?: string
  url: string
  fileName: string
  uploadedAt?: string
  legacy?: boolean
}

type CategoryOpt = { id: string; name: string }

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
  combined?: CombinedFile[] | CombinedFile | null
  categories?: (CategoryOpt & { url?: string | null; fileName?: string | null })[]
  groups?: GroupSlot[]
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
  refreshKey?: number
}) {
  const combinedInputRef = useRef<HTMLInputElement>(null)
  const groupInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [combined, setCombined] = useState<CombinedFile[]>([])
  const [combinedLabel, setCombinedLabel] = useState('')
  const [categories, setCategories] = useState<CategoryOpt[]>([])
  const [groups, setGroups] = useState<GroupSlot[]>([])

  const [groupSelected, setGroupSelected] = useState<Record<string, boolean>>({})
  const [groupLabel, setGroupLabel] = useState('')
  const [cardOpen, setCardOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  function toggleSection(key: string) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const takenCategoryIds = useMemo(() => {
    const s = new Set<string>()
    for (const g of groups) {
      for (const c of g.categories) s.add(c.id)
    }
    return s
  }, [groups])

  const availableCategories = useMemo(
    () => categories.filter(c => !takenCategoryIds.has(c.id)),
    [categories, takenCategoryIds],
  )

  const autoGroupLabel = useMemo(() => {
    return categories
      .filter(c => groupSelected[c.id])
      .map(c => c.name.trim())
      .filter(Boolean)
      .join(' + ')
  }, [categories, groupSelected])

  useEffect(() => {
    setGroupLabel(autoGroupLabel)
  }, [autoGroupLabel])

  const load = useCallback(async () => {
    if (!raceId) {
      setCombined([])
      setCategories([])
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
      setCategories(
        (data.categories ?? []).map(c => ({ id: c.id, name: c.name })),
      )
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
        setError(payload.message || 'Nie udało się wgrać wyników.')
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
      setSuccess('Wgrano plik wyników.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteCombined(fileId: string) {
    if (!raceId) return
    if (!window.confirm('Usunąć ten plik wyników?')) return
    setBusyKey(`combined:${fileId}`)
    setError('')
    setSuccess('')
    try {
      const q = new URLSearchParams(
        fileId === 'legacy'
          ? { legacy: '1' }
          : { fileId },
      )
      const res = await fetch(
        `/api/admin/races/${encodeURIComponent(raceId)}/results-combined/upload?${q.toString()}`,
        { method: 'DELETE', credentials: 'include' },
      )
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć pliku.')
        return
      }
      setCombined(prev => prev.filter(f => f.id !== fileId))
      setSuccess('Usunięto plik wyników.')
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
      setError('Wybierz co najmniej dwie kategorie do jednego zestawu.')
      return
    }
    if (categoryIds.some(id => takenCategoryIds.has(id))) {
      setError('Niektóre wybrane kategorie są już w innym zestawie.')
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
        setError(payload.message || 'Nie udało się wgrać wyników dla zestawu.')
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
      setSuccess('Wgrano wyniki dla zestawu kategorii.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteGroup(groupId: string) {
    if (!raceId) return
    if (!window.confirm('Usunąć ten zestaw wyników?')) return
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
        setError(payload.message || 'Nie udało się usunąć zestawu.')
        return
      }
      setGroups(prev => prev.filter(g => g.id !== groupId))
      setSuccess('Usunięto zestaw wyników.')
    } catch {
      setError('Błąd połączenia podczas usuwania.')
    } finally {
      setBusyKey(null)
    }
  }

  const idle = busyKey === null
  const totalUploaded = combined.length + groups.filter(g => g.url).length

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
            ? `Wgranych plików: ${totalUploaded}`
            : 'Brak wgranych wyników — rozwiń, aby dodać'}
        </p>
      ) : null}

      {cardOpen ? (
        <>
          {!raceId ? (
            <p className={styles.formHint}>
              Najpierw zapisz wyścig — wtedy wgrasz dowolne pliki wyników oraz własne zestawy kategorii.
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
                  <h4 className={styles.slSectionTitle}>Pliki ogólne / dowolne</h4>
                  <span className={styles.slSectionBadge}>{combined.length}</span>
                </button>
                {openSections.combined ? (
                  <div className={styles.slSectionBody}>
                    {combined.length === 0 ? (
                      <p className={styles.formHint}>Brak plików — możesz dodać dowolną liczbę PDF.</p>
                    ) : (
                      combined.map(f => (
                        <div key={f.id} className={styles.slRow}>
                          <div className={styles.slRowInfo}>
                            <span className={styles.slRowLabel}>
                              {f.label?.trim() || f.fileName || 'Wyniki'}
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
                              className={styles.btnFileDelete}
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
                        <span className={styles.formLabel}>Opis (opcjonalnie)</span>
                        <input
                          className={styles.formInput}
                          value={combinedLabel}
                          onChange={e => setCombinedLabel(e.target.value)}
                          placeholder="np. Klasyfikacja generalna, Dzień 1"
                        />
                      </label>
                      <div className={styles.regUploadActions}>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          disabled={!idle}
                          onClick={() => combinedInputRef.current?.click()}
                        >
                          {busyKey === 'combined-new' ? 'Wgrywanie…' : 'Dodaj plik'}
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
                  onClick={() => toggleSection('groups')}
                  aria-expanded={Boolean(openSections.groups)}
                >
                  <span className={styles.slSectionChevron} aria-hidden>
                    {openSections.groups ? '▼' : '▶'}
                  </span>
                  <h4 className={styles.slSectionTitle}>Własny zestaw kategorii</h4>
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
                            className={styles.btnFileDelete}
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
                        Potrzebujesz co najmniej dwóch kategorii, aby utworzyć zestaw.
                      </p>
                    ) : availableCategories.length < 2 ? (
                      <p className={styles.formHint}>
                        Wszystkie kategorie są już w zestawach. Usuń zestaw, aby zwolnić kategorie.
                      </p>
                    ) : (
                      <div className={styles.slGroupForm}>
                        <p className={styles.formHint} style={{ margin: 0 }}>
                          Wybierz kategorie (każdą tylko raz, w jednym zestawie) i wgraj jeden PDF.
                        </p>
                        <div className={styles.slCheckList}>
                          {categories.map(c => {
                            const taken = takenCategoryIds.has(c.id)
                            return (
                              <label key={c.id} className={styles.slCheckItem}>
                                <input
                                  type="checkbox"
                                  disabled={taken}
                                  checked={Boolean(groupSelected[c.id])}
                                  onChange={e =>
                                    setGroupSelected(prev => ({ ...prev, [c.id]: e.target.checked }))
                                  }
                                />
                                <span>
                                  {c.name || 'Bez nazwy'}
                                  {taken ? ' (już w zestawie)' : ''}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                        <label className={styles.formField}>
                          <span className={styles.formLabel}>Opis zestawu</span>
                          <input
                            className={styles.formInput}
                            value={groupLabel}
                            onChange={e => setGroupLabel(e.target.value)}
                            placeholder="Uzupełnia się z zaznaczonych kategorii — możesz zmienić"
                          />
                        </label>
                        <div className={styles.regUploadActions}>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={!idle}
                            onClick={() => groupInputRef.current?.click()}
                          >
                            {busyKey === 'group-new' ? 'Wgrywanie…' : 'Wgraj PDF dla zestawu'}
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

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './AdminDashboard.module.css'

type FileMeta = { url: string; fileName: string; uploadedAt?: string }

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

type StartlistsPayload = {
  ok?: boolean
  message?: string
  combined: FileMeta | null
  categories: CategorySlot[]
  waves: WaveSlot[]
  groups: GroupSlot[]
}

export default function AdminStartlistsSection({
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

  const [combined, setCombined] = useState<FileMeta | null>(null)
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
      setCombined(null)
      setCategories([])
      setWaves([])
      setGroups([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/startlists`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as StartlistsPayload
      if (!res.ok || !data.ok) {
        setError(data.message || 'Nie udało się wczytać list startowych.')
        return
      }
      setCombined(data.combined)
      setCategories(data.categories ?? [])
      setWaves(data.waves ?? [])
      setGroups(data.groups ?? [])
    } catch {
      setError('Błąd połączenia podczas wczytywania list startowych.')
    } finally {
      setLoading(false)
    }
  }, [raceId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function uploadCombined(file: File) {
    if (!raceId) return
    setBusyKey('combined')
    setError('')
    setSuccess('')
    try {
      const data = new FormData()
      data.set('file', file)
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/startlist/upload`, {
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
        setError(payload.message || 'Nie udało się wgrać listy łącznej.')
        return
      }
      setCombined({
        url: payload.url,
        fileName: payload.fileName || file.name,
        uploadedAt: new Date().toISOString(),
      })
      setSuccess('Wgrano listę łączną.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteCombined() {
    if (!raceId || !combined) return
    if (!window.confirm('Usunąć listę łączną dla tego wyścigu?')) return
    setBusyKey('combined')
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/startlist/upload`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć listy łącznej.')
        return
      }
      setCombined(null)
      setSuccess('Usunięto listę łączną.')
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
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/startlists/upload`, {
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
        setError(payload.message || 'Nie udało się wgrać listy startowej.')
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
      setSuccess('Wgrano listę startową.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteSlot(kind: 'category' | 'wave', id: string) {
    if (!raceId) return
    if (!window.confirm('Usunąć tę listę startową?')) return
    setBusyKey(`${kind}:${id}`)
    setError('')
    setSuccess('')
    try {
      const q = new URLSearchParams(kind === 'category' ? { categoryId: id } : { waveId: id })
      const res = await fetch(
        `/api/admin/races/${encodeURIComponent(raceId)}/startlists/upload?${q.toString()}`,
        { method: 'DELETE', credentials: 'include' },
      )
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć listy startowej.')
        return
      }
      if (kind === 'category') {
        setCategories(prev => prev.map(c => (c.id === id ? { ...c, url: null, fileName: null } : c)))
      } else {
        setWaves(prev => prev.map(w => (w.id === id ? { ...w, url: null, fileName: null } : w)))
      }
      setSuccess('Usunięto listę startową.')
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
      setError('Wybierz co najmniej dwie kategorie do jednej listy.')
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
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/startlist-groups/upload`, {
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
        setError(payload.message || 'Nie udało się wgrać listy dla grupy.')
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
      setSuccess('Wgrano listę dla grupy kategorii.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteGroup(groupId: string) {
    if (!raceId) return
    if (!window.confirm('Usunąć listę startową tej grupy kategorii?')) return
    setBusyKey(`group:${groupId}`)
    setError('')
    setSuccess('')
    try {
      const q = new URLSearchParams({ groupId })
      const res = await fetch(
        `/api/admin/races/${encodeURIComponent(raceId)}/startlist-groups/upload?${q.toString()}`,
        { method: 'DELETE', credentials: 'include' },
      )
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć listy grupy.')
        return
      }
      setGroups(prev => prev.filter(g => g.id !== groupId))
      setSuccess('Usunięto listę grupy.')
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
    (combined?.url ? 1 : 0) + categoryUploaded + waveUploaded + groups.filter(g => g.url).length

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
            Wgraj listy startowe
          </h3>
          {raceName ? <span className={styles.regUploadRace}>{raceName}</span> : null}
        </div>
      </button>

      {!cardOpen && raceId && !loading ? (
        <p className={styles.slCardSummary}>
          {totalUploaded > 0
            ? `Wgranych list: ${totalUploaded}`
            : 'Brak wgranych list — rozwiń, aby dodać'}
        </p>
      ) : null}

      {cardOpen ? (
        <>
          {!raceId ? (
            <p className={styles.formHint}>
              Najpierw zapisz wyścig — wtedy wgrasz listę łączną, listy per kategoria, per fala oraz własne
              grupy.
            </p>
          ) : null}

          {raceId && loading ? <p className={styles.formHint}>Wczytywanie list startowych…</p> : null}

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
                  <h4 className={styles.slSectionTitle}>Lista łączna (cały wyścig)</h4>
                  <span className={styles.slSectionBadge}>{combined?.url ? '1 / 1' : '0 / 1'}</span>
                </button>
                {openSections.combined ? (
                  <div className={styles.slSectionBody}>
                    <div className={styles.slRow}>
                      <div className={styles.slRowInfo}>
                        {combined?.url ? (
                          <>
                            <span className={styles.slRowLabel}>Opublikowana</span>
                            <span className={styles.slRowMeta}>
                              <a href={combined.url} target="_blank" rel="noreferrer">
                                Pobierz
                              </a>
                              {combined.fileName ? ` · ${combined.fileName}` : ''}
                              {combined.uploadedAt
                                ? ` · Wgrano: ${new Date(combined.uploadedAt).toLocaleString('pl-PL')}`
                                : ''}
                            </span>
                          </>
                        ) : (
                          <span className={styles.slRowLabel}>Brak listy łącznej</span>
                        )}
                      </div>
                      <div className={styles.slRowActions}>
                        {combined?.url ? (
                          <button
                            type="button"
                            className={styles.btnGhost}
                            disabled={!idle}
                            onClick={() => void deleteCombined()}
                          >
                            {busyKey === 'combined' ? 'Usuwanie…' : 'Usuń'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={!idle}
                            onClick={() => combinedInputRef.current?.click()}
                          >
                            {busyKey === 'combined' ? 'Wgrywanie…' : 'Wgraj'}
                          </button>
                        )}
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
                          Wybierz kategorie, które mają iść do jednej listy, i wgraj PDF.
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
                            {busyKey === 'group-new' ? 'Wgrywanie…' : 'Wgraj listę dla grupy'}
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

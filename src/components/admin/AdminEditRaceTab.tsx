'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import AdminRaceForm from '@/components/admin/AdminRaceForm'
import {
  emptyCategoryRow,
  emptyStartWave,
  formatWaveTimeForInput,
  getDuplicateCategoryKeys,
  initialRaceForm,
  newKey,
  parseOptionalInt,
  parseOptionalNumber,
  reorderCategories,
  scrollRaceFormToTop,
  type CategoryRow,
  type RaceFormState,
  type StartWaveRow,
} from '@/components/admin/adminRaceFormShared'
import { birthYearTemplateHint, templateGenderToForm } from '@/components/admin/adminCategoryTemplateUtils'
import { useCategoryTemplates } from '@/hooks/useCategoryTemplates'
import type { AdminDbRaceListItem, AdminRaceEditDetail } from '@/lib/raceDb'
import AdminFeedbackToast from '@/components/admin/AdminFeedbackToast'
import AdminRegulationUpload from '@/components/admin/AdminRegulationUpload'
import AdminStartlistsSection from '@/components/admin/AdminStartlistsSection'
import AdminResultsSection from '@/components/admin/AdminResultsSection'
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

const PL_MONTH_SHORT = [
  'STY',
  'LUT',
  'MAR',
  'KWI',
  'MAJ',
  'CZE',
  'LIP',
  'SIE',
  'WRZ',
  'PAŹ',
  'LIS',
  'GRU',
] as const

/** Data z `race_date` (YYYY-MM-DD) bez stref — spójny dzień i etykieta jak na liście publicznej. */
function raceDateBadgeParts(raceDate: string): { day: string; month: string; dateLine: string } {
  const m = raceDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) {
    return { day: '—', month: '—', dateLine: raceDate }
  }
  const [, y, mo, d] = m
  const mi = Number(mo) - 1
  const month = mi >= 0 && mi < 12 ? PL_MONTH_SHORT[mi] : '—'
  const day = String(Number(d))
  const dateLine = `${d}.${mo}.${y} r.`
  return { day, month, dateLine }
}

function calendarYearFromRaceDate(raceDate: string): number | null {
  const m = raceDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number.parseInt(m[1], 10)
  return Number.isFinite(y) ? y : null
}

function isEndedRaceStatus(status: string): boolean {
  return status === 'finished' || status === 'cancelled'
}

function isUpcomingOrTodayRaceDate(raceDate: string): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return raceDate >= today
}

/** Pola niewidoczne w formularzu — przy PATCH odtwarzamy z ostatniego GET, żeby nie zerować kolumn w bazie. */
function mergePreservedRaceScalars(body: Record<string, unknown>, snap: AdminRaceEditDetail) {
  body.slug = snap.slug
  const ts = snap.race_time_start.trim()
  body.race_time_start = ts ? (ts.length <= 5 ? `${ts}:00` : ts) : null
  body.region = snap.region.trim() ? snap.region.trim() : null
  const co = snap.country.trim().toUpperCase()
  body.country = co.length === 2 ? co : null
  body.edition_year = parseOptionalInt(snap.edition_year)
  body.spots_total = parseOptionalInt(snap.spots_total)
  const eg = parseOptionalNumber(snap.elevation_gain_m)
  body.elevation_gain_m = eg != null ? Math.floor(eg) : null
  const mx = parseOptionalNumber(snap.max_elevation_m)
  body.max_elevation_m = mx != null ? Math.floor(mx) : null
  body.gpx_url = snap.gpx_url.trim() ? snap.gpx_url.trim() : null
  body.cover_image_url = snap.cover_image_url.trim() ? snap.cover_image_url.trim() : null
}

function detailToFormState(r: AdminRaceEditDetail): RaceFormState {
  return {
    name: r.name,
    race_date: r.race_date,
    city: r.city,
    race_type: r.race_type,
    status: r.status,
    description: r.description,
    registration_opens: r.registration_opens,
    registration_closes: r.registration_closes,
  }
}

function detailToCategories(r: AdminRaceEditDetail): CategoryRow[] {
  return r.categories.map(cat => ({
    key: cat.id,
    dbId: cat.id,
    open: false,
    templateSelect: '',
    birthYearHint: '',
    name: cat.name,
    min_age: cat.min_age != null ? String(cat.min_age) : '',
    max_age: cat.max_age != null ? String(cat.max_age) : '',
    gender: cat.gender === 'M' || cat.gender === 'F' ? cat.gender : '',
    entry_fee_pln: cat.entry_fee_pln != null ? String(cat.entry_fee_pln) : '',
    distance_km: cat.distance_km != null ? String(cat.distance_km) : '',
    lap_count: cat.lap_count != null ? String(cat.lap_count) : '',
    laps_distance_km: cat.laps_distance_km != null ? String(cat.laps_distance_km) : '',
  }))
}

function detailToStartWaves(r: AdminRaceEditDetail): StartWaveRow[] {
  const catKeys = r.categories.map(c => c.id)
  return r.startWaves.map(sw => ({
    key: newKey(),
    startTime: formatWaveTimeForInput(sw.start_time),
    categoryKeys: sw.category_indexes.map(i => catKeys[i]).filter(Boolean),
  }))
}

function editStateFingerprint(form: RaceFormState, categories: CategoryRow[], waves: StartWaveRow[]): string {
  const catSig = categories.map(c => ({
    dbId: c.dbId ?? '',
    templateSelect: c.templateSelect,
    birthYearHint: c.birthYearHint,
    name: c.name,
    min_age: c.min_age,
    max_age: c.max_age,
    gender: c.gender,
    entry_fee_pln: c.entry_fee_pln,
    distance_km: c.distance_km,
    lap_count: c.lap_count,
    laps_distance_km: c.laps_distance_km,
  }))
  const waveSig = [...waves]
    .map(w => ({
      start: w.startTime.trim(),
      cats: [...w.categoryKeys].sort().join('\0'),
    }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.cats.localeCompare(b.cats))
  return JSON.stringify({ form, catSig, waveSig })
}

export type AdminEditRaceTabHandle = {
  backToList: () => Promise<void>
  confirmLeaveIfEditing: () => Promise<boolean>
  openRace: (race: AdminDbRaceListItem) => Promise<void>
}

const AdminEditRaceTab = forwardRef<AdminEditRaceTabHandle>(function AdminEditRaceTab(_, ref) {
  const {
    templates: categoryTemplates,
    loading: categoryTemplatesLoading,
    error: categoryTemplatesError,
    empty: categoryTemplatesEmpty,
  } = useCategoryTemplates()
  const detailSnap = useRef<AdminRaceEditDetail | null>(null)
  const [list, setList] = useState<AdminDbRaceListItem[] | null>(null)
  const [listErr, setListErr] = useState<string | null>(null)
  const [listCalendarYear] = useState(() => new Date().getFullYear())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const [form, setForm] = useState(() => initialRaceForm())
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [startWaves, setStartWaves] = useState<StartWaveRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [regulationMeta, setRegulationMeta] = useState<{ url: string; fileName: string; uploadedAt: string }>({
    url: '',
    fileName: '',
    uploadedAt: '',
  })
  const [startlistsRefreshKey, setStartlistsRefreshKey] = useState(0)
  const [invalidCategoryKeys, setInvalidCategoryKeys] = useState<string[]>([])
  const [categoryRequiredError, setCategoryRequiredError] = useState(false)
  const [editBaseline, setEditBaseline] = useState<string | null>(null)
  const [unsavedPrompt, setUnsavedPrompt] = useState<{
    resolve: (choice: 'save' | 'discard' | 'cancel') => void
  } | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deletingRace, setDeletingRace] = useState(false)

  const isDirty = useMemo(() => {
    if (!editingId || loadingDetail || loadErr || editBaseline === null || !detailSnap.current) return false
    return editStateFingerprint(form, categories, startWaves) !== editBaseline
  }, [editingId, loadingDetail, loadErr, editBaseline, form, categories, startWaves])

  const sortedList = useMemo(() => {
    if (!list) return list
    return [...list].sort((a, b) => {
      const aEnded = isEndedRaceStatus(a.status)
      const bEnded = isEndedRaceStatus(b.status)
      if (aEnded !== bEnded) return aEnded ? 1 : -1

      const aUpcoming = isUpcomingOrTodayRaceDate(a.race_date)
      const bUpcoming = isUpcomingOrTodayRaceDate(b.race_date)
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1

      if (aUpcoming && bUpcoming) {
        return a.race_date.localeCompare(b.race_date) || a.name.localeCompare(b.name)
      }
      return a.race_date.localeCompare(b.race_date) || a.name.localeCompare(b.name)
    })
  }, [list])

  const performSaveRef = useRef<() => Promise<boolean>>(async () => false)
  const unsavedPromptRef = useRef(unsavedPrompt)
  unsavedPromptRef.current = unsavedPrompt

  const setField = useCallback((key: keyof RaceFormState, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const updateCategory = useCallback((key: string, patch: Partial<CategoryRow>) => {
    if (typeof patch.name === 'string' && patch.name.trim()) {
      setInvalidCategoryKeys(prev => prev.filter(k => k !== key))
    }
    setCategories(prev => prev.map(c => (c.key === key ? { ...c, ...patch } : c)))
  }, [])

  const toggleCategory = useCallback((key: string) => {
    setCategories(prev => prev.map(c => (c.key === key ? { ...c, open: !c.open } : c)))
  }, [])

  const addCategory = useCallback(() => {
    setCategoryRequiredError(false)
    setCategories(prev => [...prev, emptyCategoryRow()])
  }, [])

  const removeCategory = useCallback((key: string) => {
    setCategories(prev => prev.filter(c => c.key !== key))
    setStartWaves(prev => prev.map(w => ({ ...w, categoryKeys: w.categoryKeys.filter(k => k !== key) })))
  }, [])

  const moveCategory = useCallback((key: string, dir: 'up' | 'down') => {
    setCategories(prev => reorderCategories(prev, key, dir))
  }, [])

  const onCategoryTemplateSelect = useCallback(
    (categoryKey: string, value: string) => {
      if (value === 'custom') {
        updateCategory(categoryKey, {
          templateSelect: 'custom',
          name: '',
          gender: '',
          birthYearHint: '',
          min_age: '',
          max_age: '',
        })
        return
      }
      if (value === '') {
        updateCategory(categoryKey, { templateSelect: '', birthYearHint: '', min_age: '', max_age: '' })
        return
      }
      const id = Number(value)
      const t = categoryTemplates.find(x => x.id === id)
      if (!t) return
      updateCategory(categoryKey, {
        templateSelect: String(id),
        name: t.name,
        gender: templateGenderToForm(t.gender),
        birthYearHint: birthYearTemplateHint(t),
        min_age: t.birthYearMin != null ? String(t.birthYearMin) : '',
        max_age: t.birthYearMax != null ? String(t.birthYearMax) : '',
      })
    },
    [categoryTemplates, updateCategory],
  )

  const addStartWave = useCallback(() => {
    setStartWaves(prev => [...prev, emptyStartWave()])
  }, [])

  const removeStartWave = useCallback((waveKey: string) => {
    setStartWaves(prev => prev.filter(w => w.key !== waveKey))
  }, [])

  const toggleWaveCategory = useCallback((waveKey: string, catKey: string, checked: boolean) => {
    setStartWaves(prev => {
      if (checked) {
        return prev.map(w => {
          const keys =
            w.key === waveKey
              ? [...w.categoryKeys.filter(k => k !== catKey), catKey]
              : w.categoryKeys.filter(k => k !== catKey)
          return { ...w, categoryKeys: keys }
        })
      }
      return prev.map(w =>
        w.key === waveKey ? { ...w, categoryKeys: w.categoryKeys.filter(k => k !== catKey) } : w,
      )
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setListErr(null)
    fetch('/api/admin/races/database', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(r => r.json())
      .then((d: { ok?: boolean; races?: AdminDbRaceListItem[]; message?: string }) => {
        if (cancelled) return
        if (!d?.ok || !Array.isArray(d.races)) {
          setListErr(d?.message || 'Nie udało się wczytać listy.')
          setList([])
          return
        }
        setList(d.races.filter(x => calendarYearFromRaceDate(x.race_date) === listCalendarYear))
      })
      .catch(() => {
        if (!cancelled) {
          setListErr('Brak połączenia z serwerem.')
          setList([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [listCalendarYear])

  useEffect(() => {
    if (!editingId) return
    detailSnap.current = null
    setEditBaseline(null)
    let cancelled = false
    setLoadErr(null)
    setLoadingDetail(true)
    setMessage(null)
    fetch(`/api/admin/races/${encodeURIComponent(editingId)}`, { credentials: 'include' })
      .then(async r => {
        const d = (await r.json().catch(() => ({}))) as {
          ok?: boolean
          race?: AdminRaceEditDetail
          message?: string
        }
        if (cancelled) return
        if (!r.ok || !d?.ok || !d.race) {
          setLoadErr(d?.message || `Nie udało się wczytać wyścigu (HTTP ${r.status}).`)
          return
        }
        const raceDetail = d.race
        detailSnap.current = raceDetail
        const nextForm = detailToFormState(raceDetail)
        const nextCats = detailToCategories(raceDetail)
        const nextWaves = detailToStartWaves(raceDetail)
        setForm(nextForm)
        setCategories(nextCats)
        setStartWaves(nextWaves)
        setRegulationMeta({
          url: raceDetail.regulation_file_url ?? '',
          fileName: raceDetail.regulation_file_name ?? '',
          uploadedAt: raceDetail.regulation_uploaded_at ?? '',
        })
        setStartlistsRefreshKey(k => k + 1)
        setEditBaseline(editStateFingerprint(nextForm, nextCats, nextWaves))
      })
      .catch(() => {
        if (!cancelled) setLoadErr('Brak połączenia z serwerem.')
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })
    return () => {
      cancelled = true
    }
  }, [editingId])

  const closeEditor = useCallback(() => {
    detailSnap.current = null
    setEditingId(null)
    setLoadErr(null)
    setMessage(null)
    setEditBaseline(null)
    setConfirmDeleteOpen(false)
    setDeletingRace(false)
    setForm(initialRaceForm())
    setCategories([])
    setStartWaves([])
    setRegulationMeta({ url: '', fileName: '', uploadedAt: '' })
    setStartlistsRefreshKey(0)
    setInvalidCategoryKeys([])
    setCategoryRequiredError(false)
  }, [])

  function openUnsavedPrompt(): Promise<'save' | 'discard' | 'cancel'> {
    return new Promise(resolve => {
      setUnsavedPrompt({ resolve })
    })
  }

  function resolveUnsaved(choice: 'save' | 'discard' | 'cancel') {
    const p = unsavedPromptRef.current
    setUnsavedPrompt(null)
    p?.resolve(choice)
  }

  async function performSave(): Promise<boolean> {
    if (!editingId) return false
    setMessage(null)
    setInvalidCategoryKeys([])
    setCategoryRequiredError(false)

    const validCats = categories.filter(c => c.name.trim())
    if (categories.length > 0 && validCats.length !== categories.length) {
      const missingKeys = categories.filter(c => !c.name.trim()).map(c => c.key)
      setInvalidCategoryKeys(missingKeys)
      setCategories(prev =>
        prev.map(c => (missingKeys.includes(c.key) && !c.open ? { ...c, open: true } : c)),
      )
      const firstMissing = missingKeys[0]
      if (firstMissing) {
        requestAnimationFrame(() => {
          const el = document.getElementById(`race-category-name-${firstMissing}`) as HTMLInputElement | null
          if (!el) return
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.focus()
        })
      }
      setMessage({ type: 'err', text: 'Każda dodana kategoria musi mieć nazwę — uzupełnij lub usuń pustą kartę.' })
      return false
    }

    const duplicateKeys = getDuplicateCategoryKeys(categories)
    if (duplicateKeys.length > 0) {
      setInvalidCategoryKeys(duplicateKeys)
      setCategories(prev =>
        prev.map(c => (duplicateKeys.includes(c.key) && !c.open ? { ...c, open: true } : c)),
      )
      const firstDup = duplicateKeys[0]
      if (firstDup) {
        requestAnimationFrame(() => {
          const el = document.getElementById(`race-category-name-${firstDup}`) as HTMLInputElement | null
          if (!el) return
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.focus()
        })
      }
      setMessage({ type: 'err', text: 'Kategorie muszą mieć unikalne nazwy — popraw zduplikowane pozycje.' })
      return false
    }

    for (const w of startWaves) {
      const hasT = w.startTime.trim().length > 0
      const hasC = w.categoryKeys.length > 0
      if (hasT !== hasC) {
        setMessage({
          type: 'err',
          text: 'Dla każdej fali startu ustaw godzinę i wybierz co najmniej jedną kategorię (albo usuń niepełną falę).',
        })
        return false
      }
      if (hasT && hasC) {
        const allNamed = w.categoryKeys.every(k => validCats.some(c => c.key === k))
        if (!allNamed) {
          setMessage({
            type: 'err',
            text: 'W fali startu są kategorie bez nazwy — uzupełnij nazwy lub odznacz je w fali.',
          })
          return false
        }
      }
    }

    if (validCats.length === 0) {
      setCategoryRequiredError(true)
      requestAnimationFrame(() => {
        const btn = document.getElementById('add-category-button')
        if (!btn) return
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return false
    }

    setSubmitting(true)

    const snap = detailSnap.current
    if (!snap) {
      setMessage({ type: 'err', text: 'Brak danych wyścigu — wróć do listy i otwórz edycję ponownie.' })
      setSubmitting(false)
      return false
    }

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      city: form.city.trim(),
      race_date: form.race_date,
      race_type: form.race_type,
      status: form.status,
    }

    const desc = form.description.trim()
    if (desc) body.description = desc

    const ro = form.registration_opens.trim()
    if (ro) body.registration_opens = ro
    const rc = form.registration_closes.trim()
    if (rc) body.registration_closes = rc

    mergePreservedRaceScalars(body, snap)

    body.categories = validCats.map((c, index) => {
      const row: Record<string, unknown> = {
        name: c.name.trim(),
        min_age: parseOptionalInt(c.min_age),
        max_age: parseOptionalInt(c.max_age),
        gender: c.gender === 'M' || c.gender === 'F' ? c.gender : null,
        entry_fee_pln: parseOptionalNumber(c.entry_fee_pln),
        display_order: index,
        distance_km: parseOptionalNumber(c.distance_km),
        lap_count: parseOptionalInt(c.lap_count),
        laps_distance_km: parseOptionalNumber(c.laps_distance_km),
      }
      if (c.dbId) {
        row.id = c.dbId
        const orig = snap.categories.find(x => x.id === c.dbId)
        if (orig) {
          row.bib_start = orig.bib_start
          row.spots_total = orig.spots_total
        }
      }
      return row
    })

    const wavesPayload = startWaves
      .filter(w => w.startTime.trim() && w.categoryKeys.length > 0)
      .map(w => {
        const wt = w.startTime.trim()
        return {
          start_time: wt.length <= 5 ? `${wt}:00` : wt,
          category_indexes: Array.from(
            new Set(w.categoryKeys.map(k => validCats.findIndex(c => c.key === k)).filter(i => i >= 0)),
          ).sort((a, b) => a - b),
        }
      })
      .filter(w => w.category_indexes.length > 0)
    if (wavesPayload.length > 0) body.startWaves = wavesPayload

    const id = editingId
    const fpForm = form
    const fpCats = categories
    const fpWaves = startWaves

    try {
      const res = await fetch(`/api/admin/races/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; slug?: string }

      if (!res.ok || !data.ok) {
        setMessage({ type: 'err', text: data.message || `Błąd (${res.status})` })
        return false
      }

      setMessage({ type: 'ok', text: data.message || 'Zapisano zmiany.' })
      scrollRaceFormToTop()
      setEditBaseline(editStateFingerprint(fpForm, fpCats, fpWaves))
      setStartlistsRefreshKey(k => k + 1)
      setList(prev =>
        prev
          ? prev
              .map(x =>
                x.id === id
                  ? {
                      ...x,
                      name: fpForm.name.trim(),
                      city: fpForm.city.trim(),
                      race_date: fpForm.race_date.slice(0, 10),
                      status: fpForm.status,
                      slug: data.slug ?? x.slug,
                    }
                  : x,
              )
              .filter(x => calendarYearFromRaceDate(x.race_date) === listCalendarYear)
          : prev,
      )
      return true
    } catch {
      setMessage({ type: 'err', text: 'Brak połączenia z serwerem.' })
      return false
    } finally {
      setSubmitting(false)
    }
  }

  performSaveRef.current = performSave

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await performSave()
  }

  async function handleDeleteRaceConfirmed() {
    if (!editingId || deletingRace) return
    setDeletingRace(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/races/${encodeURIComponent(editingId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        deletedFiles?: number
      }
      if (!res.ok || !d?.ok) {
        setMessage({ type: 'err', text: d?.message || 'Nie udało się usunąć wyścigu.' })
        setConfirmDeleteOpen(false)
        return
      }
      const deletedId = editingId
      const filesNote =
        typeof d.deletedFiles === 'number' && d.deletedFiles > 0
          ? ` Usunięto też ${d.deletedFiles} plik(ów) z magazynu.`
          : ''
      setList(prev => (prev ? prev.filter(r => r.id !== deletedId) : prev))
      closeEditor()
      setMessage({
        type: 'ok',
        text: (d.message || 'Usunięto wyścig.') + filesNote,
      })
    } catch {
      setMessage({ type: 'err', text: 'Brak połączenia z serwerem.' })
      setConfirmDeleteOpen(false)
    } finally {
      setDeletingRace(false)
    }
  }

  const tryBackToList = useCallback(async () => {
    if (!editingId) return
    if (!isDirty) {
      closeEditor()
      return
    }
    const choice = await openUnsavedPrompt()
    if (choice === 'cancel') return
    if (choice === 'discard') {
      closeEditor()
      return
    }
    const ok = await performSaveRef.current()
    if (ok) closeEditor()
  }, [editingId, isDirty, closeEditor])

  const confirmLeaveIfEditing = useCallback(async (): Promise<boolean> => {
    if (!editingId) return true
    if (!isDirty) {
      closeEditor()
      return true
    }
    const choice = await openUnsavedPrompt()
    if (choice === 'cancel') return false
    if (choice === 'discard') {
      closeEditor()
      return true
    }
    const ok = await performSaveRef.current()
    if (!ok) return false
    closeEditor()
    return true
  }, [editingId, isDirty, closeEditor])

  useImperativeHandle(
    ref,
    () => ({
      backToList: tryBackToList,
      confirmLeaveIfEditing,
      openRace: async (race: AdminDbRaceListItem) => {
        if (!race?.id) return
        const canLeave = await confirmLeaveIfEditing()
        if (!canLeave) return
        setList(prev => {
          if (!prev) return [race]
          if (prev.some(x => x.id === race.id)) return prev
          return [race, ...prev]
        })
        setEditingId(race.id)
      },
    }),
    [tryBackToList, confirmLeaveIfEditing],
  )

  return (
    <>
      {!editingId ? (
      <div className={styles.panel}>
        <p className={styles.intro}>
          Lista zawiera tylko wyścigi z datą w bieżącym roku kalendarzowym ({listCalendarYear}). Starsze edycje
          znajdziesz w zakładce „Historia”. Po zapisie wyścig zostaje na liście tylko wtedy, gdy data wyścigu nadal
          przypada do tego roku.
        </p>
        {listErr && (
          <p className={styles.formError} role="alert">
            {listErr}
          </p>
        )}
        {sortedList === null && !listErr && <p className={styles.placeholder}>Wczytywanie listy…</p>}
        {sortedList && sortedList.length === 0 && !listErr && (
          <p className={styles.placeholder}>
            Brak wyścigów w bazie z datą w bieżącym roku ({listCalendarYear}) — dodaj wyścig w zakładce „Dodaj
            wyścig” albo zajrzyj do „Historia”, jeśli szukasz wcześniejszych lat.
          </p>
        )}
        {sortedList && sortedList.length > 0 && (
          <ul className={styles.editRaceList}>
            {sortedList.map(r => {
              const { day, month, dateLine } = raceDateBadgeParts(r.race_date)
              return (
                <li key={r.id} className={styles.editRaceListItem}>
                  <button
                    type="button"
                    className={`${styles.editRaceListMain} ${styles.editRaceListMainClickable}`}
                    onClick={() => setEditingId(r.id)}
                    aria-label={`Edytuj wyścig: ${r.name}`}
                  >
                    <div className={styles.editRaceListRow}>
                      <div className={`${styles.raceListDate} ${styles.editRaceDateBadge}`}>
                        <span className={`${styles.raceListDay} ${styles.editRaceDay}`}>{day}</span>
                        <span className={`${styles.raceListMonth} ${styles.editRaceMonth}`}>{month}</span>
                      </div>
                      <div className={styles.editRaceListText}>
                        <div className={styles.editRaceListTitle}>{r.name}</div>
                        <div className={styles.editRaceListMetaRow}>
                          <span className={styles.editRaceListMetaItem}>
                            <span className={styles.editRaceListMetaIcon} aria-hidden>
                              📍
                            </span>
                            {r.city}
                          </span>
                          <span className={styles.editRaceListMetaItem}>
                            <span className={styles.editRaceListMetaIcon} aria-hidden>
                              📅
                            </span>
                            {dateLine}
                          </span>
                          <span className={styles.editRaceListMetaStatus}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                        </div>
                        <div className={styles.editRaceListSlug}>
                          <code>{r.slug}</code>
                        </div>
                      </div>
                    </div>
                  </button>
                  <button type="button" className={styles.btnSecondary} onClick={() => setEditingId(r.id)}>
                    Edytuj
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      ) : (
    <div className={styles.panel}>
      <button type="button" className={styles.backLink} onClick={() => void tryBackToList()}>
        ← Lista wyścigów
      </button>

      {loadErr && (
        <p className={styles.formError} role="alert">
          {loadErr}
        </p>
      )}
      {loadingDetail && !loadErr && <p className={styles.placeholder}>Wczytywanie wyścigu…</p>}

      {!loadErr && !loadingDetail && (
        <>
          <AdminRegulationUpload
            raceId={editingId}
            raceName={form.name}
            initialUrl={regulationMeta.url}
            initialFileName={regulationMeta.fileName}
            initialUploadedAt={regulationMeta.uploadedAt}
            onUploaded={meta => {
              setRegulationMeta(meta)
              if (detailSnap.current) {
                detailSnap.current = {
                  ...detailSnap.current,
                  regulation_file_url: meta.url,
                  regulation_file_name: meta.fileName,
                  regulation_uploaded_at: meta.uploadedAt,
                }
              }
            }}
            onDeleted={() => {
              setRegulationMeta({ url: '', fileName: '', uploadedAt: '' })
              if (detailSnap.current) {
                detailSnap.current = {
                  ...detailSnap.current,
                  regulation_file_url: '',
                  regulation_file_name: '',
                  regulation_uploaded_at: '',
                }
              }
            }}
          />
          <AdminStartlistsSection
            raceId={editingId}
            raceName={form.name}
            refreshKey={startlistsRefreshKey}
          />
          <AdminResultsSection
            raceId={editingId}
            raceName={form.name}
            refreshKey={startlistsRefreshKey}
          />
          <AdminRaceForm
            form={form}
            setField={setField}
            categories={categories}
            updateCategory={updateCategory}
            toggleCategory={toggleCategory}
            addCategory={addCategory}
            removeCategory={removeCategory}
            moveCategory={moveCategory}
            categoryTemplates={categoryTemplates}
            categoryTemplatesLoading={categoryTemplatesLoading}
            categoryTemplatesError={categoryTemplatesError}
            categoryTemplatesEmpty={categoryTemplatesEmpty}
            onCategoryTemplateSelect={onCategoryTemplateSelect}
            startWaves={startWaves}
            setStartWaves={setStartWaves}
            addStartWave={addStartWave}
            removeStartWave={removeStartWave}
            toggleWaveCategory={toggleWaveCategory}
            onSubmit={handleSubmit}
            submitLabel="Zapisz zmiany"
            submitting={submitting}
            invalidCategoryKeys={invalidCategoryKeys}
            categoryRequiredError={categoryRequiredError}
          />

          <div className={styles.raceDeleteZone}>
            <p className={styles.raceDeleteZoneTitle}>Usuń wyścig</p>
            <p className={styles.raceDeleteZoneHint}>
              Trwale usuwa wyścig z bazy oraz wszystkie powiązane pliki (regulamin, listy startowe, wyniki).
            </p>
            <div className={styles.resultsDangerZone}>
              <button
                type="button"
                className={`${styles.btnSecondary} ${styles.btnDanger}`}
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={deletingRace || submitting}
              >
                {deletingRace ? 'Usuwanie…' : 'Usuń wyścig'}
              </button>
              {confirmDeleteOpen ? (
                <div className={styles.resultsDangerConfirmBox}>
                  <p className={styles.resultsDangerConfirmText}>
                    Na pewno usunąć „{form.name.trim() || 'ten wyścig'}”? Tej operacji nie można cofnąć.
                  </p>
                  <div className={styles.resultsDangerConfirmActions}>
                    <button
                      type="button"
                      className={`${styles.btnSecondary} ${styles.resultsDangerCancel}`}
                      onClick={() => setConfirmDeleteOpen(false)}
                      disabled={deletingRace}
                    >
                      Anuluj
                    </button>
                    <button
                      type="button"
                      className={`${styles.btnSecondary} ${styles.btnDanger}`}
                      onClick={() => void handleDeleteRaceConfirmed()}
                      disabled={deletingRace}
                    >
                      {deletingRace ? 'Usuwanie…' : 'Usuń trwale'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
      )}

      <AdminFeedbackToast message={message} onDismiss={() => setMessage(null)} />

      {unsavedPrompt && (
        <div
          className={styles.unsavedOverlay}
          role="presentation"
          onClick={() => !submitting && resolveUnsaved('cancel')}
        >
          <div
            className={styles.unsavedDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="unsaved-title" className={styles.unsavedDialogTitle}>
              Niezapisane zmiany
            </h2>
            <p className={styles.unsavedDialogText}>
              Masz niezapisane zmiany w tym wyścigu. Zapisz, odrzuć albo zostań w edycji.
            </p>
            <div className={styles.unsavedDialogActions}>
              <button
                type="button"
                className={styles.formSubmit}
                disabled={submitting}
                onClick={() => resolveUnsaved('save')}
              >
                {submitting ? 'Zapisywanie…' : 'Zapisz'}
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={submitting}
                onClick={() => resolveUnsaved('discard')}
              >
                Odrzuć
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                disabled={submitting}
                onClick={() => resolveUnsaved('cancel')}
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
})

export default AdminEditRaceTab

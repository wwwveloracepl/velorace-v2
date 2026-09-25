'use client'

import { useCallback, useState } from 'react'
import AdminRaceForm from '@/components/admin/AdminRaceForm'
import {
  emptyCategoryRow,
  emptyStartWave,
  getDuplicateCategoryKeys,
  initialRaceForm,
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
import AdminFeedbackToast from '@/components/admin/AdminFeedbackToast'
import AdminRegulationUpload from '@/components/admin/AdminRegulationUpload'
import AdminStartlistsSection from '@/components/admin/AdminStartlistsSection'
import AdminResultsSection from '@/components/admin/AdminResultsSection'
import styles from './AdminDashboard.module.css'

export default function AdminAddRaceTab() {
  const {
    templates: categoryTemplates,
    loading: categoryTemplatesLoading,
    error: categoryTemplatesError,
    empty: categoryTemplatesEmpty,
  } = useCategoryTemplates()
  const [form, setForm] = useState(() => initialRaceForm())
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [startWaves, setStartWaves] = useState<StartWaveRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [invalidCategoryKeys, setInvalidCategoryKeys] = useState<string[]>([])
  const [categoryRequiredError, setCategoryRequiredError] = useState(false)
  const [createdRace, setCreatedRace] = useState<{ id: string; name: string } | null>(null)
  const [startlistsRefreshKey, setStartlistsRefreshKey] = useState(0)

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
    setCategories(prev => [...prev, emptyCategoryRow()])
    setCategoryRequiredError(false)
  }, [])

  const removeCategory = useCallback((key: string) => {
    setCategories(prev => prev.filter(c => c.key !== key))
    setStartWaves(prev =>
      prev.map(w => ({ ...w, categoryKeys: w.categoryKeys.filter(k => k !== key) })),
    )
    setInvalidCategoryKeys(prev => prev.filter(k => k !== key))
  }, [])

  const moveCategory = useCallback((key: string, dir: 'up' | 'down') => {
    setCategories(prev => reorderCategories(prev, key, dir))
  }, [])

  const onCategoryTemplateSelect = useCallback(
    (categoryKey: string, value: string) => {
      const tpl = categoryTemplates.find(t => String(t.id) === value)
      if (!tpl) {
        setCategories(prev => prev.map(c => (c.key === categoryKey ? { ...c, templateSelect: value } : c)))
        return
      }
      setCategories(prev =>
        prev.map(c =>
          c.key === categoryKey
            ? {
                ...c,
                templateSelect: value,
                name: tpl.name,
                gender: templateGenderToForm(tpl.gender),
                birthYearHint: birthYearTemplateHint(tpl),
              }
            : c,
        ),
      )
      setInvalidCategoryKeys(prev => prev.filter(k => k !== categoryKey))
    },
    [categoryTemplates],
  )

  const addStartWave = useCallback(() => {
    setStartWaves(prev => [...prev, emptyStartWave()])
  }, [])

  const removeStartWave = useCallback((waveKey: string) => {
    setStartWaves(prev => prev.filter(w => w.key !== waveKey))
  }, [])

  const toggleWaveCategory = useCallback((waveKey: string, catKey: string, checked: boolean) => {
    setStartWaves(prev =>
      prev.map(w => {
        if (w.key === waveKey) {
          const set = new Set(w.categoryKeys)
          if (checked) set.add(catKey)
          else set.delete(catKey)
          return { ...w, categoryKeys: [...set] }
        }
        if (checked) {
          return { ...w, categoryKeys: w.categoryKeys.filter(k => k !== catKey) }
        }
        return w
      }),
    )
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    setInvalidCategoryKeys([])
    setCategoryRequiredError(false)

    if (categories.length === 0) {
      setCategoryRequiredError(true)
      setMessage({ type: 'err', text: 'Dodaj co najmniej jedną kategorię.' })
      return
    }

    const emptyNameKeys = categories.filter(c => !c.name.trim()).map(c => c.key)
    if (emptyNameKeys.length > 0) {
      setInvalidCategoryKeys(emptyNameKeys)
      setMessage({
        type: 'err',
        text: 'Każda dodana kategoria musi mieć nazwę — uzupełnij lub usuń pustą kartę.',
      })
      return
    }

    const dupKeys = getDuplicateCategoryKeys(categories)
    if (dupKeys.length > 0) {
      setInvalidCategoryKeys(dupKeys)
      setMessage({ type: 'err', text: 'Kategorie muszą mieć unikalne nazwy — popraw zduplikowane pozycje.' })
      return
    }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        race_date: form.race_date,
        city: form.city.trim(),
        race_type: form.race_type,
        status: form.status,
        description: form.description.trim() || null,
        registration_opens: form.registration_opens || null,
        registration_closes: form.registration_closes || null,
        categories: categories.map((c, i) => ({
          name: c.name.trim(),
          gender: c.gender || null,
          entry_fee_pln: parseOptionalNumber(c.entry_fee_pln),
          spots_total: parseOptionalInt(c.spots_total),
          bib_start: parseOptionalInt(c.bib_start),
          display_order: i,
          distance_km: parseOptionalNumber(c.distance_km),
          lap_count: parseOptionalInt(c.lap_count),
          laps_distance_km: parseOptionalNumber(c.laps_distance_km),
          min_age: parseOptionalInt(c.min_age),
          max_age: parseOptionalInt(c.max_age),
        })),
      }

      const keyToIndex = new Map(categories.map((c, i) => [c.key, i]))
      const wavesPayload = startWaves
        .map(w => ({
          start_time: w.start_time.trim(),
          category_indexes: w.categoryKeys
            .map(k => keyToIndex.get(k))
            .filter((x): x is number => typeof x === 'number'),
        }))
        .filter(w => w.start_time && w.category_indexes.length > 0)
      if (wavesPayload.length > 0) body.startWaves = wavesPayload

      const res = await fetch('/api/admin/races', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; slug?: string; id?: string }

      if (!res.ok || !data.ok) {
        setMessage({ type: 'err', text: data.message || `Błąd (${res.status})` })
        return
      }

      setMessage({
        type: 'ok',
        text: data.message || `Zapisano (slug: ${data.slug ?? '—'}).`,
      })

      const nextRaceId = data?.id ?? null
      setCreatedRace(nextRaceId ? { id: nextRaceId, name: form.name.trim() } : null)
      setStartlistsRefreshKey(k => k + 1)
      scrollRaceFormToTop()
      setForm(initialRaceForm())
      setCategories([])
      setStartWaves([])
      setInvalidCategoryKeys([])
      setCategoryRequiredError(false)
    } catch {
      setMessage({ type: 'err', text: 'Brak połączenia z serwerem.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.panel}>
      <AdminRegulationUpload
        raceId={createdRace?.id ?? null}
        raceName={createdRace?.name ?? ''}
      />
      <AdminStartlistsSection
        raceId={createdRace?.id ?? null}
        raceName={createdRace?.name ?? ''}
        refreshKey={startlistsRefreshKey}
      />
      <AdminResultsSection
        raceId={createdRace?.id ?? null}
        raceName={createdRace?.name ?? ''}
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
        submitLabel="Zapisz wyścig"
        submitting={submitting}
        invalidCategoryKeys={invalidCategoryKeys}
        categoryRequiredError={categoryRequiredError}
      />

      <AdminFeedbackToast message={message} onDismiss={() => setMessage(null)} />
    </div>
  )
}

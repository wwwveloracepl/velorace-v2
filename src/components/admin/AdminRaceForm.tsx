'use client'

import { useEffect, useState } from 'react'
import styles from './AdminDashboard.module.css'
import {
  RACE_TYPES,
  RACE_STATUSES,
  parseTime24,
  type CategoryRow,
  type RaceFormState,
  type StartWaveRow,
} from './adminRaceFormShared'
import type { CategoryTemplate } from '@/lib/types'
import RegistrationDateTimeBlock from '@/components/admin/RegistrationDateTimeBlock'

function WaveStartTimeField({
  waveKey,
  committed,
  onCommit,
}: {
  waveKey: string
  committed: string
  onCommit: (key: string, hhmm: string) => void
}) {
  const [draft, setDraft] = useState(committed)
  const [err, setErr] = useState(false)

  useEffect(() => {
    setDraft(committed)
    setErr(false)
  }, [committed, waveKey])

  return (
    <>
      <input
        className={`${styles.formInput} ${err ? styles.formInputInvalid : ''}`}
        type="text"
        inputMode="numeric"
        placeholder="np. 09:30 (24h)"
        autoComplete="off"
        value={draft}
        maxLength={8}
        aria-invalid={err}
        aria-describedby={err ? `wave-time-hint-${waveKey}` : undefined}
        onChange={e => {
          setErr(false)
          const v = e.target.value
          setDraft(v)
          const t = v.trim()
          if (!t) onCommit(waveKey, '')
          else {
            const p = parseTime24(v)
            if (p) onCommit(waveKey, `${p.hh}:${p.mm}`)
          }
        }}
        onBlur={() => {
          const t = draft.trim()
          if (!t) {
            setErr(false)
            onCommit(waveKey, '')
            return
          }
          const p = parseTime24(t)
          if (!p) {
            setErr(true)
            setDraft(committed)
            return
          }
          setErr(false)
          onCommit(waveKey, `${p.hh}:${p.mm}`)
        }}
      />
      {err && (
        <p id={`wave-time-hint-${waveKey}`} className={styles.regDtTimeErr} role="alert">
          Godzina 00:00–23:59 (minuty 00–59), np. 09:30.
        </p>
      )}
    </>
  )
}

export type AdminRaceFormProps = {
  form: RaceFormState
  setField: (key: keyof RaceFormState, value: string) => void
  categories: CategoryRow[]
  updateCategory: (key: string, patch: Partial<CategoryRow>) => void
  toggleCategory: (key: string) => void
  addCategory: () => void
  removeCategory: (key: string) => void
  moveCategory: (key: string, dir: 'up' | 'down') => void
  categoryTemplates: CategoryTemplate[]
  categoryTemplatesLoading: boolean
  categoryTemplatesError: string | null
  /** API OK, ale brak wierszy w `category_templates` — zwykle nie uruchomiono migracji/seeda. */
  categoryTemplatesEmpty?: boolean
  onCategoryTemplateSelect: (categoryKey: string, value: string) => void
  startWaves: StartWaveRow[]
  setStartWaves: React.Dispatch<React.SetStateAction<StartWaveRow[]>>
  addStartWave: () => void
  removeStartWave: (waveKey: string) => void
  toggleWaveCategory: (waveKey: string, catKey: string, checked: boolean) => void
  onSubmit: (e: React.FormEvent) => void
  submitLabel: string
  submitting: boolean
  invalidCategoryKeys?: string[]
  categoryRequiredError?: boolean
}

export default function AdminRaceForm({
  form,
  setField,
  categories,
  updateCategory,
  toggleCategory,
  addCategory,
  removeCategory,
  moveCategory,
  categoryTemplates,
  categoryTemplatesLoading,
  categoryTemplatesError,
  categoryTemplatesEmpty,
  onCategoryTemplateSelect,
  startWaves,
  setStartWaves,
  addStartWave,
  removeStartWave,
  toggleWaveCategory,
  onSubmit,
  submitLabel,
  submitting,
  invalidCategoryKeys = [],
  categoryRequiredError = false,
}: AdminRaceFormProps) {
  const categoriesWithNames = categories.filter(c => c.name.trim())
  const invalidCategoryKeySet = new Set(invalidCategoryKeys)
  const categoryWaveOwner = new Map<string, string>()
  for (const w of startWaves) {
    for (const key of w.categoryKeys) {
      if (!categoryWaveOwner.has(key)) categoryWaveOwner.set(key, w.key)
    }
  }

  return (
    <form className={styles.raceForm} onSubmit={onSubmit}>
      <h2 className={styles.formSectionTitle}>Dane wyścigu</h2>
      <div className={styles.formGrid}>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Nazwa wyścigu *</span>
          <input
            className={styles.formInput}
            value={form.name}
            onChange={e => setField('name', e.target.value)}
            required
            maxLength={200}
            autoComplete="off"
          />
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Data wyścigu *</span>
          <input
            className={styles.formInput}
            type="date"
            value={form.race_date}
            onChange={e => setField('race_date', e.target.value)}
            required
          />
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Miejsce *</span>
          <input
            className={styles.formInput}
            value={form.city}
            onChange={e => setField('city', e.target.value)}
            required
            maxLength={500}
            placeholder="np. ul. Sportowa 1, 40-001 Katowice"
          />
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Typ trasy</span>
          <select
            className={styles.formSelect}
            value={form.race_type}
            onChange={e => setField('race_type', e.target.value)}
          >
            {RACE_TYPES.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Status</span>
          <select
            className={styles.formSelect}
            value={form.status}
            onChange={e => setField('status', e.target.value)}
          >
            {RACE_STATUSES.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.formGrid}>
        <RegistrationDateTimeBlock
          label="Otwarcie zapisów"
          value={form.registration_opens}
          onChange={v => setField('registration_opens', v)}
        />
        <RegistrationDateTimeBlock
          label="Zamknięcie zapisów"
          value={form.registration_closes}
          onChange={v => setField('registration_closes', v)}
        />
      </div>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Opis</span>
        <textarea
          className={styles.formTextarea}
          value={form.description}
          onChange={e => setField('description', e.target.value)}
          rows={4}
        />
      </label>

      <h2 className={styles.formSectionTitle}>Kategorie startowe</h2>

      {categoryTemplatesError && (
        <p className={styles.formError} role="status">
          Szablony PZKol: {categoryTemplatesError} (możesz użyć „własna kategoria”).
        </p>
      )}
      {categoryTemplatesEmpty && !categoryTemplatesError && (
        <p className={styles.formHint} role="status">
          W bazie nie ma jeszcze słownika szablonów PZKol (tabela <code>category_templates</code>). Uruchom lokalnie{' '}
          <code>npm run db:seed-templates</code> (wymaga poprawnego <code>DATABASE_URL</code> w{' '}
          <code>.env.local</code>) albo wklej SQL z pliku{' '}
          <code>database/migrations/20260207_category_templates.sql</code> w Neon SQL Editor.
        </p>
      )}

      <div className={styles.accordionList}>
        {categories.map((c, catIndex) => (
          <div key={c.key} className={styles.accordion}>
            <div className={styles.accordionHead}>
              <button
                type="button"
                className={styles.accordionToggle}
                onClick={() => toggleCategory(c.key)}
                aria-expanded={c.open}
              >
                <span className={styles.accordionChevron}>{c.open ? '▼' : '▶'}</span>
                <span className={styles.accordionTitle}>{c.name.trim() || 'Nowa kategoria'}</span>
              </button>
              <div className={styles.accordionHeadActions}>
                <button
                  type="button"
                  className={styles.accordionOrderBtn}
                  title="Wyżej na liście"
                  disabled={catIndex === 0}
                  onClick={() => moveCategory(c.key, 'up')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.accordionOrderBtn}
                  title="Niżej na liście"
                  disabled={catIndex >= categories.length - 1}
                  onClick={() => moveCategory(c.key, 'down')}
                >
                  ↓
                </button>
                <button type="button" className={styles.btnGhost} onClick={() => removeCategory(c.key)}>
                  Usuń
                </button>
              </div>
            </div>
            {c.open && (
              <div className={styles.accordionBody}>
                <div className={styles.formGrid}>
                  <label className={`${styles.formField} ${styles.formFieldFull}`}>
                    <span className={styles.formLabel}>Szablon kategorii (PZKol)</span>
                    <select
                      className={styles.formSelect}
                      disabled={categoryTemplatesLoading}
                      value={c.templateSelect === '' ? '' : c.templateSelect === 'custom' ? 'custom' : c.templateSelect}
                      onChange={e => onCategoryTemplateSelect(c.key, e.target.value)}
                    >
                      <option value="">— wybierz szablon —</option>
                      {categoryTemplates.map(t => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name}
                        </option>
                      ))}
                      <option value="custom">— własna kategoria —</option>
                    </select>
                  </label>
                  {c.birthYearHint ? <p className={styles.formHint}>{c.birthYearHint}</p> : null}
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Nazwa kategorii *</span>
                    <input
                      id={`race-category-name-${c.key}`}
                      className={`${styles.formInput} ${invalidCategoryKeySet.has(c.key) ? styles.formInputInvalid : ''}`}
                      value={c.name}
                      onChange={e => updateCategory(c.key, { name: e.target.value })}
                      maxLength={120}
                      aria-invalid={invalidCategoryKeySet.has(c.key)}
                    />
                  </label>
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Rok urodzenia od</span>
                    <input
                      className={styles.formInput}
                      inputMode="numeric"
                      value={c.min_age}
                      onChange={e => updateCategory(c.key, { min_age: e.target.value })}
                      placeholder="np. 1990"
                    />
                  </label>
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Rok urodzenia do</span>
                    <input
                      className={styles.formInput}
                      inputMode="numeric"
                      value={c.max_age}
                      onChange={e => updateCategory(c.key, { max_age: e.target.value })}
                      placeholder="np. 2008"
                    />
                  </label>
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Płeć</span>
                    <select
                      className={styles.formSelect}
                      value={c.gender}
                      onChange={e => updateCategory(c.key, { gender: e.target.value as '' | 'M' | 'F' })}
                    >
                      <option value="">Open</option>
                      <option value="M">M</option>
                      <option value="F">K</option>
                    </select>
                  </label>
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Wpłata (PLN)</span>
                    <input
                      className={styles.formInput}
                      inputMode="decimal"
                      value={c.entry_fee_pln}
                      onChange={e => updateCategory(c.key, { entry_fee_pln: e.target.value })}
                    />
                  </label>
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Dystans (km)</span>
                    <input
                      className={styles.formInput}
                      inputMode="decimal"
                      value={c.distance_km}
                      onChange={e => updateCategory(c.key, { distance_km: e.target.value })}
                    />
                  </label>
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Liczba okrążeń</span>
                    <input
                      className={styles.formInput}
                      inputMode="numeric"
                      value={c.lap_count}
                      onChange={e => updateCategory(c.key, { lap_count: e.target.value })}
                    />
                  </label>
                  <label className={styles.formField}>
                    <span className={styles.formLabel}>Długość okrążenia (km)</span>
                    <input
                      className={styles.formInput}
                      inputMode="decimal"
                      value={c.laps_distance_km}
                      onChange={e => updateCategory(c.key, { laps_distance_km: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.catToolbar}>
        <button
          id="add-category-button"
          type="button"
          className={`${styles.btnSecondary} ${categoryRequiredError ? styles.btnSecondaryInvalid : ''}`}
          onClick={addCategory}
          aria-invalid={categoryRequiredError}
        >
          + Dodaj kategorię
        </button>
      </div>

      <h2 className={styles.formSectionTitle}>Kolejność startów</h2>
      <p className={styles.formHint}>
        Ustal fale startu: ta sama godzina może obejmować wiele kategorii (wspólny start). Liczba okrążeń nadal wynika
        z ustawień każdej kategorii powyżej.
      </p>
      {categoriesWithNames.length === 0 && (
        <p className={styles.formHint}>
          Nadaj co najmniej jednej kategorii nazwę w sekcji powyżej — wtedy dodasz fale i przypiszesz do nich kategorie.
        </p>
      )}
      <div className={styles.waveList}>
        {startWaves.map(w => (
          <div key={w.key} className={styles.waveCard}>
            <div className={styles.waveHead}>
              <span className={styles.waveTitle}>Fala startu</span>
              <button type="button" className={styles.btnGhost} onClick={() => removeStartWave(w.key)}>
                Usuń
              </button>
            </div>
            <div className={styles.waveBody}>
              <label className={styles.formField}>
                <span className={styles.formLabel}>Godzina startu</span>
                <WaveStartTimeField
                  waveKey={w.key}
                  committed={w.startTime}
                  onCommit={(key, hhmm) =>
                    setStartWaves(prev => prev.map(x => (x.key === key ? { ...x, startTime: hhmm } : x)))
                  }
                />
              </label>
              <div className={styles.waveCatBlock}>
                <span className={styles.formLabel}>Kategorie w tej fali</span>
                <div className={styles.waveCatGrid}>
                  {categoriesWithNames.map(c => (
                    <label
                      key={c.key}
                      className={styles.waveCatLabel}
                      aria-disabled={Boolean(categoryWaveOwner.get(c.key) && !w.categoryKeys.includes(c.key))}
                    >
                      <input
                        type="checkbox"
                        checked={w.categoryKeys.includes(c.key)}
                        disabled={Boolean(categoryWaveOwner.get(c.key) && !w.categoryKeys.includes(c.key))}
                        onChange={e => toggleWaveCategory(w.key, c.key, e.target.checked)}
                      />
                      <span>{c.name.trim()}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.catToolbar}>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={addStartWave}
          disabled={categoriesWithNames.length === 0}
          title={
            categoriesWithNames.length === 0
              ? 'Najpierw wpisz nazwy kategorii'
              : undefined
          }
        >
          + Dodaj falę startu
        </button>
      </div>

      <div className={styles.formActions}>
        <button type="submit" className={styles.formSubmit} disabled={submitting}>
          {submitting ? 'Zapisywanie…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

'use client'

import { useCallback, useRef, useState } from 'react'
import AdminAddRaceTab from '@/components/admin/AdminAddRaceTab'
import AdminEditRaceTab, { type AdminEditRaceTabHandle } from '@/components/admin/AdminEditRaceTab'
import AdminHistoryTab, { type AdminHistoryTabHandle } from '@/components/admin/AdminHistoryTab'
import type { AdminDbRaceListItem } from '@/lib/raceDb'
import styles from './AdminDashboard.module.css'

type TabId = 'list' | 'race' | 'history'

const TABS: { id: TabId; label: string }[] = [
  { id: 'list', label: 'Lista wyścigów' },
  { id: 'race', label: 'Dodaj wyścig' },
  { id: 'history', label: 'Historia' },
]

export default function AdminDashboard() {
  const [tab, setTab] = useState<TabId>('list')
  const editRef = useRef<AdminEditRaceTabHandle>(null)
  const historyRef = useRef<AdminHistoryTabHandle>(null)

  const handleTabClick = useCallback(
    async (next: TabId) => {
      if (next === tab) {
        if (next === 'list') await editRef.current?.backToList()
        else if (next === 'history') historyRef.current?.backToRoot()
        return
      }
      if (tab === 'list') {
        const ok = await editRef.current?.confirmLeaveIfEditing()
        if (ok === false) return
      }
      setTab(next)
    },
    [tab],
  )

  const openEditRace = useCallback(
    async (race: AdminDbRaceListItem) => {
      if (tab === 'list') {
        await editRef.current?.openRace(race)
        return
      }
      setTab('list')
      setTimeout(() => {
        void editRef.current?.openRace(race)
      }, 0)
    },
    [tab],
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist" aria-label="Panel administratora">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => void handleTabClick(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'list' && <AdminEditRaceTab ref={editRef} />}
      {tab === 'race' && <AdminAddRaceTab />}
      {tab === 'history' && <AdminHistoryTab ref={historyRef} onOpenEditRace={openEditRace} />}
    </div>
  )
}

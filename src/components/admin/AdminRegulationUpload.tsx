'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './AdminDashboard.module.css'

type UploadedMeta = { url: string; fileName: string; uploadedAt: string }

export default function AdminRegulationUpload({
  raceId,
  raceName,
  initialUrl = '',
  initialFileName = '',
  initialUploadedAt = '',
  onUploaded,
  onDeleted,
}: {
  raceId: string | null
  raceName?: string
  initialUrl?: string
  initialFileName?: string
  initialUploadedAt?: string
  onUploaded?: (meta: UploadedMeta) => void
  onDeleted?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl)
  const [fileName, setFileName] = useState(initialFileName)
  const [uploadedAt, setUploadedAt] = useState(initialUploadedAt)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'deleting'>('idle')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [queuedFile, setQueuedFile] = useState<File | null>(null)
  const [queuedFileName, setQueuedFileName] = useState('')

  useEffect(() => {
    setUrl(initialUrl)
    setFileName(initialFileName)
    setUploadedAt(initialUploadedAt)
    setSuccess('')
  }, [initialUrl, initialFileName, initialUploadedAt])

  async function uploadFile(file: File, activeRaceId: string) {
    setStatus('uploading')
    setError('')
    setSuccess('')

    try {
      const data = new FormData()
      data.set('file', file)
      const res = await fetch(`/api/admin/races/${encodeURIComponent(activeRaceId)}/regulation/upload`, {
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
        setError(payload.message || 'Nie udało się wgrać regulaminu.')
        return
      }
      const nowIso = new Date().toISOString()
      setUrl(payload.url)
      setFileName(payload.fileName || file.name || 'regulamin.pdf')
      setUploadedAt(nowIso)
      onUploaded?.({
        url: payload.url,
        fileName: payload.fileName || file.name || 'regulamin.pdf',
        uploadedAt: nowIso,
      })
      setSuccess('Upload zakończony pomyślnie.')
    } catch {
      setError('Błąd połączenia podczas uploadu.')
    } finally {
      setStatus('idle')
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!raceId) {
      setQueuedFile(file)
      setQueuedFileName(file.name || 'regulamin.pdf')
      setError('')
      setSuccess('Plik zapisany. Zostanie wysłany po zapisaniu wyścigu.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    await uploadFile(file, raceId)
    if (inputRef.current) inputRef.current.value = ''
  }

  useEffect(() => {
    if (!raceId || !queuedFile || status !== 'idle') return
    void uploadFile(queuedFile, raceId).then(() => {
      setQueuedFile(null)
      setQueuedFileName('')
      if (inputRef.current) inputRef.current.value = ''
    })
  }, [raceId, queuedFile, status])

  async function handleDelete() {
    if (!raceId || !url) return
    const ok = window.confirm('Usunąć opublikowany regulamin dla tego wyścigu?')
    if (!ok) return

    setStatus('deleting')
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/regulation/upload`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !payload.ok) {
        setError(payload.message || 'Nie udało się usunąć regulaminu.')
        return
      }
      setUrl('')
      setFileName('')
      setUploadedAt('')
      onDeleted?.()
      setSuccess('Regulamin został usunięty.')
    } catch {
      setError('Błąd połączenia podczas usuwania.')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className={styles.regUploadCard}>
      <div className={styles.regUploadHead}>
        <h3 className={styles.regUploadTitle}>Regulamin wyścigu (PDF)</h3>
        {raceName ? <span className={styles.regUploadRace}>{raceName}</span> : null}
      </div>

      {!raceId ? (
        <p className={styles.formHint}>
          Możesz już wybrać plik regulaminu. Zostanie automatycznie wgrany po zapisaniu nowego wyścigu.
        </p>
      ) : null}
      {!raceId && queuedFileName ? (
        <p className={styles.formHint}>Wybrano plik: {queuedFileName}. Zapisz wyścig, aby rozpocząć upload.</p>
      ) : null}

      {url ? (
        <div className={styles.regUploadMeta}>
          <a href={url} target="_blank" rel="noreferrer" className={styles.regUploadLink}>
            Pobierz aktualny regulamin
          </a>
          {fileName ? <span>{fileName}</span> : null}
          {uploadedAt ? <span>Wgrano: {new Date(uploadedAt).toLocaleString('pl-PL')}</span> : null}
        </div>
      ) : (
        <p className={styles.formHint}>Brak opublikowanego regulaminu.</p>
      )}

      <div className={styles.regUploadActions}>
        {!url ? (
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={status !== 'idle'}
            onClick={() => inputRef.current?.click()}
          >
            {status === 'uploading'
              ? 'Wgrywanie…'
              : !raceId && queuedFile
                ? 'Plik gotowy do wysłania'
                : 'Wgraj regulamin'}
          </button>
        ) : (
          <button
            type="button"
            className={styles.btnFileDelete}
            disabled={!raceId || status !== 'idle'}
            onClick={handleDelete}
          >
            {status === 'deleting' ? 'Usuwanie…' : 'Usuń regulamin'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {!error && success ? <p className={styles.formSuccess}>{success}</p> : null}
    </div>
  )
}

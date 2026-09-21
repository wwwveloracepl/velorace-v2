'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { useAuth } from '@/components/auth/AuthProvider'
import styles from './page.module.css'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      router.replace('/')
    }
  }, [loading, user, router])

  if (loading) {
    return (
      <>
        <Navbar />
        <main className={styles.page}>
          <h1 className={styles.title}>Logowanie</h1>
          <div className={styles.card}>
            <p>Sprawdzam sesje...</p>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (user) {
    return (
      <>
        <Navbar />
        <main className={styles.page}>
          <h1 className={styles.title}>Logowanie</h1>
          <div className={styles.card}>
            <p>Przekierowanie na stronę główną…</p>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    const result = await login(email, password)
    if (!result.ok) {
      setError(result.message || 'Nieprawidlowy email lub haslo.')
      setPending(false)
      return
    }
    router.replace('/')
  }

  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <h1 className={styles.title}>Logowanie</h1>
        <form onSubmit={handleSubmit} className={styles.card}>
          <label className={styles.label} htmlFor="email">Login</label>
          <input
            id="email"
            type="text"
            className={styles.input}
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="username"
            required
          />

          <label className={styles.label} htmlFor="password">Haslo</label>
          <input
            id="password"
            type="password"
            className={styles.input}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.btn} disabled={pending}>
            {pending ? 'Logowanie...' : 'Zaloguj sie'}
          </button>
        </form>
      </main>
      <Footer />
    </>
  )
}

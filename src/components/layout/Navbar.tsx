'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import styles from './Navbar.module.css'

const SHOW_LIVE_SECTION = false

const NAV_LINKS = [
  { label: 'Strona główna', href: '/' },
  { label: 'Wyniki',        href: '/wyniki' },
  { label: 'Live',          href: '/live', isLive: true, hidden: !SHOW_LIVE_SECTION },
  { label: 'Kontakt',       href: '/kontakt' },
]

function isAdminPanelPath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

export default function Navbar() {
  const pathname = usePathname()
  const { user, loading, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const onAdminPanel = isAdminPanelPath(pathname)

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.logo}>
        VELO<span>RACE</span>
      </Link>

      <div className={styles.links}>
        {NAV_LINKS.filter(link => !link.hidden).map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={[
              styles.link,
              pathname === link.href ? styles.active : '',
              link.isLive ? styles.liveLink : '',
            ].join(' ')}
          >
            {link.isLive && <span className={styles.liveDot} />}
            {link.label}
          </Link>
        ))}
      </div>

      <div className={styles.right}>
        {user ? (
          <>
            {!onAdminPanel ? (
              <Link href="/admin" className={`${styles.loginBtn} ${styles.hideOnMobile}`}>
                Panel admina
              </Link>
            ) : null}
            <button
              className={`${styles.outlineBtn} ${styles.hideOnMobile}`}
              onClick={() => void logout()}
            >
              Wyloguj
            </button>
          </>
        ) : (
          <Link href="/login" className={`${styles.loginBtn} ${styles.hideOnMobile}`}>
            Zaloguj się
          </Link>
        )}

        <button
          type="button"
          className={styles.burger}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}
        >
          <span className={`${styles.burgerLine} ${menuOpen ? styles.burgerLineOpen1 : ''}`} />
          <span className={`${styles.burgerLine} ${menuOpen ? styles.burgerLineHidden : ''}`} />
          <span className={`${styles.burgerLine} ${menuOpen ? styles.burgerLineOpen2 : ''}`} />
        </button>
      </div>

      {menuOpen && (
        <div className={styles.mobilePanel}>
          {NAV_LINKS.filter(link => !link.hidden).map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={[
                styles.mobileLink,
                pathname === link.href ? styles.mobileLinkActive : '',
                link.isLive ? styles.liveLink : '',
              ].join(' ')}
              onClick={() => setMenuOpen(false)}
            >
              {link.isLive && <span className={styles.liveDot} />}
              {link.label}
            </Link>
          ))}

          <div className={styles.mobileAuth}>
            {user ? (
              <>
                {!onAdminPanel ? (
                  <Link href="/admin" className={styles.loginBtn} onClick={() => setMenuOpen(false)}>
                    Panel admina
                  </Link>
                ) : null}
                <button
                  className={styles.outlineBtn}
                  onClick={() => {
                    setMenuOpen(false)
                    void logout()
                  }}
                >
                  Wyloguj
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className={styles.loginBtn}
                onClick={() => setMenuOpen(false)}
              >
                Zaloguj się
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}

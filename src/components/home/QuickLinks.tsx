import Link from 'next/link'
import styles from './QuickLinks.module.css'

const LINKS = [
  { icon: '🏆', label: 'Wyniki',      sub: 'Ostatnie i archiwalne', href: '/wyniki'    },
  { icon: '📋', label: 'Zgłoszenia',  sub: 'Otwarte zapisy',        href: '/zapisy'    },
  { icon: '🔴', label: 'Live Timing', sub: 'Wyścig na żywo',        href: '/live'      },
]

export default function QuickLinks() {
  return (
    <div className={styles.grid}>
      {LINKS.map(link => (
        <Link key={link.href} href={link.href} className={styles.btn}>
          <div className={styles.icon}>{link.icon}</div>
          <div>
            <div className={styles.label}>{link.label}</div>
            <div className={styles.sub}>{link.sub}</div>
          </div>
        </Link>
      ))}
    </div>
  )
}

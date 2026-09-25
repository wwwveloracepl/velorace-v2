import { resultsBlobSlugSegment } from '@/lib/results'

export const STARTLISTS_BLOB_ROOT = 'listy_startowe'

export function startlistsBlobRootPrefix(raceYear: number): string {
  const year = Number.isInteger(raceYear) && raceYear >= 2000 && raceYear <= 9999 ? raceYear : new Date().getFullYear()
  return `${STARTLISTS_BLOB_ROOT}/${year}`
}

function raceSeg(raceSlug: string): string {
  return resultsBlobSlugSegment(raceSlug)
}

/**
 * Prefix dla listy startowej per kategoria:
 * `{root}/{year}/{raceSlugSeg}/kategorie/{categoryId}/`
 */
export function startlistBlobPrefix(raceSlug: string, raceYear: number, categoryId: string): string {
  return `${startlistsBlobRootPrefix(raceYear)}/${raceSeg(raceSlug)}/kategorie/${categoryId}/`
}

/**
 * Prefix dla wszystkich list per kategoria danego wyścigu:
 * `{root}/{year}/{raceSlugSeg}/kategorie/`
 */
export function startlistsForRaceBlobPrefix(raceSlug: string, raceYear: number): string {
  return `${startlistsBlobRootPrefix(raceYear)}/${raceSeg(raceSlug)}/kategorie/`
}

/**
 * Prefix dla jednej listy łącznej wyścigu:
 * `{root}/{year}/{raceSlugSeg}/laczna/`
 */
export function combinedStartlistBlobPrefix(raceSlug: string, raceYear: number): string {
  return `${startlistsBlobRootPrefix(raceYear)}/${raceSeg(raceSlug)}/laczna/`
}

/**
 * Jeden plik listy ogólnej (wiele dozwolonych):
 * `{root}/{year}/{raceSlugSeg}/laczna/{fileId}/`
 */
export function combinedStartlistFileBlobPrefix(raceSlug: string, raceYear: number, fileId: string): string {
  return `${combinedStartlistBlobPrefix(raceSlug, raceYear)}${fileId}/`
}

/**
 * Prefix dla listy startowej per fala:
 * `{root}/{year}/{raceSlugSeg}/fale/{waveId}/`
 */
export function startlistWaveBlobPrefix(raceSlug: string, raceYear: number, waveId: string): string {
  return `${startlistsBlobRootPrefix(raceYear)}/${raceSeg(raceSlug)}/fale/${waveId}/`
}

/**
 * Prefix dla wszystkich list per fala:
 * `{root}/{year}/{raceSlugSeg}/fale/`
 */
export function startlistsWavesForRaceBlobPrefix(raceSlug: string, raceYear: number): string {
  return `${startlistsBlobRootPrefix(raceYear)}/${raceSeg(raceSlug)}/fale/`
}

/**
 * Prefix dla listy startowej grupy kategorii:
 * `{root}/{year}/{raceSlugSeg}/grupy/{groupId}/`
 */
export function startlistGroupBlobPrefix(raceSlug: string, raceYear: number, groupId: string): string {
  return `${startlistsBlobRootPrefix(raceYear)}/${raceSeg(raceSlug)}/grupy/${groupId}/`
}

/**
 * Prefiks całego drzewa list startowych wyścigu (kategorie + fale + grupy + łączna):
 * `{root}/{year}/{raceSlugSeg}/`
 */
export function startlistsRaceRootBlobPrefix(raceSlug: string, raceYear: number): string {
  return `${startlistsBlobRootPrefix(raceYear)}/${raceSeg(raceSlug)}/`
}

function safeBaseName(fileName: string): string {
  const base = fileName
    .replace(/\\/g, '/')
    .split('/')
    .pop()
  const t = (base ?? fileName).replace(/\.\./g, '').replace(/[\x00-\x1f<>:"|?*]/g, '_').trim()
  return t || 'startlist.pdf'
}

export function safeStartlistUploadFileName(fileName: string): string {
  const raw = safeBaseName(fileName)
  if (/\.pdf$/i.test(raw)) return raw
  return `${raw.replace(/\.pdf$/i, '')}.pdf`
}

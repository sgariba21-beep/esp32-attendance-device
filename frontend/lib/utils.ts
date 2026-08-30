import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Pluralize a single word, handling common English irregular endings.
 * Used for institution labels (e.g. "Branch" → "Branches", "Class" → "Classes")
 * so naive "+ s" concatenation never produces "Branchs" / "Classs".
 * Preserves the casing of the input (operates on the suffix only).
 */
export function pluralize(word: string): string {
  if (!word) return word
  const lower = word.toLowerCase()
  // -s, -ss, -sh, -ch, -x, -z  →  add "es"  (Class→Classes, Branch→Branches, Box→Boxes)
  if (/(?:s|sh|ch|x|z)$/.test(lower)) return word + 'es'
  // consonant + y  →  "ies"  (Company→Companies, but not "Day"→"Days")
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + (word.slice(-1) === 'Y' ? 'IES' : 'ies')
  return word + 's'
}

/**
 * Pick "a" or "an" for a word based on its leading sound (not just its letter).
 * Used so label-driven copy reads correctly: "an Employee", "a Student",
 * "a Branch", "an Office", "a Unit". Falls back gracefully on combined labels
 * like "Student / Teacher" (keys off the first word).
 */
/**
 * Normalize a Ghana phone number to E.164 (+233XXXXXXXXX). §D rule.
 * Accepts: 0XXXXXXXXX, 233XXXXXXXXX, +233XXXXXXXXX. Returns null if invalid.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.trim().replace(/\D/g, '')
  const s = input.trim().startsWith('+') ? '+' + digits : digits
  if (/^0\d{9}$/.test(s))       return '+233' + s.slice(1)
  if (/^233\d{9}$/.test(s))     return '+' + s
  if (/^\+233\d{9}$/.test(s))   return s
  return null
}

/** Convert E.164 +233XXXXXXXXX to local display form 0XXXXXXXXX. §D rule. */
export function displayPhone(e164: string): string {
  if (/^\+233\d{9}$/.test(e164)) return '0' + e164.slice(4)
  return e164
}

/**
 * Format a number in the institution's currency (e.g. GH₵1,234.56, ₦1,234.56).
 * `currency` is an ISO-4217 code from institutions.currency. Intl applies the
 * correct symbol and minor-unit precision per currency (e.g. XOF → 0 decimals),
 * so callers never hardcode "2dp". Defaults to GHS for any legacy call site.
 */
export function formatMoney(amount: number | string, currency: string = 'GHS'): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency }).format(Number(amount))
}

/**
 * Render a stored wall-clock time in the institution's chosen clock format.
 * Input is the raw "HH:MM" or "HH:MM:SS" string kept on attendance rows
 * (always 24h, seconds dropped on display). `format` comes from
 * institutions.time_format: '24h' → "13:30", '12h' → "1:30 PM".
 * Returns the input unchanged if it isn't a parseable time.
 */
export function formatClockTime(value: string, format: '12h' | '24h' = '24h'): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value?.trim() ?? '')
  if (!m) return value
  const hours = Number(m[1])
  const minutes = m[2]
  if (hours > 23 || Number(minutes) > 59) return value
  if (format === '24h') return `${String(hours).padStart(2, '0')}:${minutes}`
  const period = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${minutes} ${period}`
}

export function indefiniteArticle(word: string): string {
  const w = word.trim().toLowerCase()
  // "yoo"-sound words take "a" despite a leading vowel: a Unit, a University, a User.
  if (/^(uni|use|usu|uti|ubi|eu|ewe)/.test(w)) return 'a'
  // Silent-h words take "an": an hour, an honest mistake.
  if (/^(hour|honest|heir|honou?r)/.test(w)) return 'an'
  return /^[aeiou]/.test(w) ? 'an' : 'a'
}

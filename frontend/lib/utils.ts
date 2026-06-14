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

'use client'

import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { promptInstall, useInstallState } from '@/components/pwa/use-install-prompt'

/**
 * "Install app" affordance for the PWA.
 *
 * - Chrome / Edge / Android: fires the native install prompt captured by
 *   `use-install-prompt`.
 * - iOS Safari: no such event exists, so the button expands a short
 *   Share → "Add to Home Screen" instruction instead.
 * - Already installed (standalone display mode) or an unsupported browser with
 *   no prompt: renders nothing.
 *
 * Dismissal is remembered for the browser session only (sessionStorage), so it
 * doesn't nag but comes back on the next visit.
 */

const HIDE_KEY = 'pwa-install-hidden'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mm = (q: string) => window.matchMedia(q).matches
  return (
    mm('(display-mode: standalone)') ||
    mm('(display-mode: fullscreen)') ||
    mm('(display-mode: minimal-ui)') ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  return (
    /iphone|ipad|ipod/.test(ua) ||
    // iPadOS 13+ reports as MacIntel with a touch screen
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

type Props = {
  /** `button` = standalone control (login screen). `row` = nav-menu row. */
  variant?: 'button' | 'row'
  /** Class for the trigger element — pass sibling nav-row classes for `row`. */
  className?: string
}

function initiallyHidden(): boolean {
  if (typeof window === 'undefined') return false
  if (isStandalone()) return true
  try {
    return sessionStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}

export function InstallPrompt({ variant = 'button', className }: Props) {
  const installState = useInstallState()
  // Render nothing until mounted so SSR and the first client render agree
  // (mirrors components/theme-toggle.tsx).
  const [mounted, setMounted] = useState(false)
  const [ios] = useState(detectIOS)
  const [hidden, setHidden] = useState(initiallyHidden)
  const [iosOpen, setIosOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || hidden || installState === 'installed') return null

  const canPrompt = installState === 'available'
  // Nothing to offer: no native prompt available and not an iOS device.
  if (!canPrompt && !ios) return null

  async function handleClick() {
    if (canPrompt) {
      const outcome = await promptInstall()
      if (outcome === 'accepted') setHidden(true)
      return
    }
    // iOS: toggle the manual instructions.
    setIosOpen((v) => !v)
  }

  function dismiss() {
    setHidden(true)
    try {
      sessionStorage.setItem(HIDE_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const iosNote = ios && !canPrompt && iosOpen && (
    <p
      className={cn(
        'text-muted-foreground',
        variant === 'row'
          ? 'px-2.5 pb-2 pt-1 text-xs leading-relaxed'
          : 'mt-2 text-center text-xs leading-relaxed',
      )}
    >
      In Safari, tap the Share icon{' '}
      <Share className="inline-block h-3.5 w-3.5 -translate-y-px" aria-hidden />{' '}
      then <span className="font-medium text-foreground">Add to Home Screen</span>.
    </p>
  )

  if (variant === 'row') {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          aria-expanded={ios && !canPrompt ? iosOpen : undefined}
          className={className}
        >
          <Download className="h-[18px] w-[18px] shrink-0 opacity-70" aria-hidden />
          Install app
        </button>
        {iosNote}
      </>
    )
  }

  return (
    <div className="mt-4 flex flex-col items-center">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleClick}
          aria-expanded={ios && !canPrompt ? iosOpen : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
            className,
          )}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Install app
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {iosNote}
    </div>
  )
}

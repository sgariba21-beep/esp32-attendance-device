'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { THEME_PRESETS, isValidHex, normalizeHex, brandForeground } from '@/lib/theme'

type Props = {
  /** Current hex value, '' for none. */
  value: string
  /** Current preset key, '' / 'custom'. */
  preset: string
  onChange: (hex: string, preset: string) => void
}

/**
 * Brand-colour control: curated swatches + custom hex, with a live preview of
 * the accent applied to a button and an active nav chip. Used on Settings and
 * the institution editor; the chosen colour drives the dashboard --primary.
 */
export function BrandColorPicker({ value, preset, onChange }: Props) {
  const current = isValidHex(value) ? normalizeHex(value) : ''
  const fg = current ? brandForeground(current) : '#fff'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {THEME_PRESETS.map((p) => {
          const selected = current === normalizeHex(p.hex)
          return (
            <button
              key={p.key}
              type="button"
              title={p.label}
              aria-label={p.label}
              onClick={() => onChange(p.hex, p.key)}
              className={cn(
                'relative h-8 w-8 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110',
                selected && 'ring-2 ring-offset-2 ring-offset-card ring-foreground'
              )}
              style={{ backgroundColor: p.hex }}
            >
              {selected && (
                <Check
                  className="absolute inset-0 m-auto h-4 w-4"
                  style={{ color: brandForeground(p.hex) }}
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className="h-8 w-8 shrink-0 rounded-md ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: current || 'var(--muted)' }}
          />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value, 'custom')}
            placeholder="#4F46E5"
            spellCheck={false}
            autoCapitalize="none"
            className="h-8 w-32 font-mono"
            aria-label="Custom brand colour hex"
          />
        </div>

        {/* Live preview */}
        {current && (
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium"
              style={{ backgroundColor: current, color: fg }}
            >
              Primary button
            </span>
            <span
              className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium"
              style={{
                backgroundColor: `color-mix(in oklab, ${current} 12%, transparent)`,
                color: current,
              }}
            >
              Active nav
            </span>
          </div>
        )}
      </div>

      {value && !isValidHex(value) && (
        <p className="text-xs text-destructive">Enter a valid hex colour, e.g. #4F46E5.</p>
      )}
      <input type="hidden" name="theme_preset" value={preset} />
    </div>
  )
}

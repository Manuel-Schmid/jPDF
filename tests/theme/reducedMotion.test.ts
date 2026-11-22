import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Body of the `prefers-reduced-motion: reduce` block in base.css. */
function reducedMotionBlock(): string {
  const css = readFileSync('src/theme/base.css', 'utf8')
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(start).toBeGreaterThanOrEqual(0)
  // The block holds a single rule: it ends at the second closing brace.
  const end = css.indexOf('}', css.indexOf('}', start) + 1)
  return css.slice(start, end)
}

describe('reduced motion (base.css)', () => {
  it('starts no transitions at all', () => {
    // transition-property defaults to `all`: any non-zero duration here would
    // make every style change a transition, and per-frame updates (a text box
    // dragged wider) restart it before it lands, so the element lags and jumps.
    const durations = [...reducedMotionBlock().matchAll(/transition-duration:\s*([^;!]+)/g)].map((m) => m[1].trim())
    expect(durations).toEqual(['0s'])
  })
})

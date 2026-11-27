import { fireEvent, render, screen } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import ExplainAreaBar from '../../../src/core/viewer/ExplainAreaBar.svelte'
import SelectionBar from '../../../src/core/viewer/SelectionBar.svelte'
import { CommandRegistry } from '../../../src/core/registry/commands'
import type { Annotation } from '../../../src/core/session/model'

const vp = { width: 600, height: 800 } as unknown as PageViewport
const shape = { id: 's', kind: 'shape', page: 0 } as unknown as Annotation

describe('Explain buttons', () => {
  it('the selection bar shows "Explain this" only when it can explain', async () => {
    const onexplain = vi.fn()
    const r = render(SelectionBar, { props: { rect: [100, 300, 200, 400], vp, annotations: [shape], commands: new CommandRegistry(), onexplain } })
    await fireEvent.click(screen.getByRole('button', { name: 'Explain this' }))
    expect(onexplain).toHaveBeenCalledOnce()
    r.unmount()
    render(SelectionBar, { props: { rect: [100, 300, 200, 400], vp, annotations: [shape], commands: new CommandRegistry() } })
    expect(screen.queryByRole('button', { name: 'Explain this' })).toBeNull()
  })

  it('the area bar sits above the area (below it near the top) and explains on click', async () => {
    const onexplain = vi.fn()
    const { container } = render(ExplainAreaBar, { props: { rect: [100, 300, 200, 400], vp, onexplain } })
    const bar = container.querySelector('.area-bar') as HTMLElement
    expect(parseFloat(bar.style.top)).toBeLessThan(300)
    await fireEvent.click(screen.getByRole('button', { name: /Explain this area/ }))
    expect(onexplain).toHaveBeenCalledOnce()
  })
})

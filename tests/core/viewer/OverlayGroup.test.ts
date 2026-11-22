import { fireEvent, render } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import { commands } from '../../../src/core/registry/commands'
import type { ToolHandler } from '../../../src/core/registry/tools'
import type { Annotation, ShapeAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import Overlay from '../../../src/core/viewer/Overlay.svelte'
import { cssColor } from '../../../src/annotations/freetext/screen'
import { UNMARK_COLOR } from '../../../src/tools/shared/unmark'

// Page 100 x 100 pt at scale 2.
const vp = {
  scale: 2,
  rotation: 0,
  width: 200,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

function sq(id: string, x: number, y: number, extra: Partial<ShapeAnnotation> = {}): ShapeAnnotation {
  return {
    id, page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'shape', shape: 'rect',
    rect: [x, y, x + 10, y + 10], border: null, fill: { color: [0, 1, 0], opacity: 1 }, ...extra,
  }
}

const groupTool: ToolHandler = { groupSelection: true }

function mount(props: Record<string, unknown>, list: Annotation[]) {
  const store = new AnnotationStore()
  store.load(list)
  return render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp, tool: groupTool, ...props } })
}

const attrs = (el: Element | null) => el && ['x', 'y', 'width', 'height'].map((k) => Number(el.getAttribute(k)))

afterEach(() => vi.restoreAllMocks())

describe('Overlay group selection', () => {
  it('outlines each selected annotation and their common box, with only the rotate handle', () => {
    const { container } = mount({ selection: ['a', 'b'] }, [sq('a', 10, 70), sq('b', 40, 50), sq('c', 80, 10)])
    // a → screen [20, 40, 40, 60], b → [80, 80, 100, 100]: common box [20, 40, 100, 100].
    expect(attrs(container.querySelector('.selection-box'))).toEqual([20, 40, 80, 60])
    expect(container.querySelectorAll('.member-box')).toHaveLength(2)
    const handles = [...container.querySelectorAll('.handle')]
    expect(handles.map((h) => h.getAttribute('data-handle'))).toEqual(['rotate'])
    // Above the top edge: the box is too high for the bar above, so the bar goes below.
    expect(['cx', 'cy'].map((k) => Number(handles[0].getAttribute(k)))).toEqual([60, 18])
  })

  it('offers no rotate handle when a selected annotation cannot turn (text markup)', () => {
    const hl: Annotation = {
      id: 'h', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'highlight',
      quads: [[0, 10, 10, 10, 0, 0, 10, 0]], color: [1, 1, 0], opacity: 0.4,
    }
    const { container } = mount({ selection: ['a', 'h'] }, [sq('a', 10, 70), hl])
    expect(container.querySelectorAll('.handle')).toHaveLength(0)
  })

  it('draws the box of a group being rotated turned, as the tool reports it', () => {
    const tool: ToolHandler = { groupSelection: true, rotatingFrame: () => ({ page: 0, rect: [10, 70, 20, 80], angle: 30 }) }
    const { container } = mount({ selection: ['a'], tool }, [sq('a', 10, 70)])
    const turned = container.querySelector('.selection-box')!.parentElement!
    expect(turned.getAttribute('transform')).toBe('rotate(-30 30 50)')
    expect(attrs(container.querySelector('.selection-box'))).toEqual([20, 40, 20, 20])
  })

  it('shows the selection actions, which run the selection commands', async () => {
    const run = vi.spyOn(commands, 'execute').mockResolvedValue(true)
    const { getByRole, getByText } = mount({ selection: ['a', 'b'] }, [sq('a', 10, 70), sq('b', 40, 50)])
    expect(getByText('2 selected')).toBeTruthy()
    await fireEvent.click(getByRole('button', { name: /Duplicate/ }))
    await fireEvent.click(getByRole('button', { name: /Flatten/ }))
    await fireEvent.click(getByRole('button', { name: /Delete/ }))
    expect(run.mock.calls.map((c) => c[0])).toEqual(['edit.duplicate', 'edit.flatten', 'edit.delete'])
  })

  it('hides the actions while the group is dragged, and follows the previews', () => {
    const moved = { ...sq('a', 20, 70) }
    const { container, queryByRole } = mount(
      { selection: ['a'], hidden: new Set(['a']), previews: [moved] },
      [sq('a', 10, 70)],
    )
    expect(queryByRole('toolbar')).toBeNull()
    expect(attrs(container.querySelector('.selection-box'))).toEqual([40, 40, 20, 20])
  })

  it('shows nothing for a selection on another page', () => {
    const { container, queryByRole } = mount({ selection: ['p1'] }, [{ ...sq('p1', 10, 10), page: 1 }])
    expect(container.querySelector('.selection-box')).toBeNull()
    expect(queryByRole('toolbar')).toBeNull()
  })

  it('draws the lasso outline on its page', () => {
    const lasso = { page: 0, points: [[0, 100], [50, 100], [50, 50]] }
    const { container, queryByRole } = mount({ selection: [], lasso }, [])
    const outline = container.querySelector('.lasso')!
    expect(outline.getAttribute('points')).toBe('0,0 100,0 100,100')
    // The blue of text being unmarked, not the accent of the selection box.
    expect(outline.getAttribute('stroke')).toBe(cssColor(UNMARK_COLOR))
    expect(outline.getAttribute('fill')).toBe(cssColor(UNMARK_COLOR))
    expect(queryByRole('toolbar')).toBeNull()
  })

  it('draws flattened annotations under the others', () => {
    const red = { color: [1, 0, 0] as [number, number, number], opacity: 1 }
    const { container } = mount({ selection: [] }, [sq('top', 10, 10), sq('flat', 10, 10, { flattened: true, fill: red })])
    const fills = [...container.querySelectorAll('rect[fill]')].map((el) => el.getAttribute('fill'))
    expect(fills).toEqual([cssColor([1, 0, 0]), cssColor([0, 1, 0])])
  })
})

import { fireEvent, render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PageViewport } from 'pdfjs-dist'
import '../../src/annotations'
import { freetextKind } from '../../src/annotations/freetext'
import { EDITOR_BASELINE_SHIFT, editorInsets } from '../../src/annotations/freetext/screen'
import type { TextEdit } from '../../src/core/registry/tools'
import type { FreeTextAnnotation } from '../../src/core/session/model'
import { AnnotationStore } from '../../src/core/session/store.svelte'
import Overlay from '../../src/core/viewer/Overlay.svelte'

const ft = (over: Partial<FreeTextAnnotation> = {}): FreeTextAnnotation => ({
  id: 't1', page: 0, sourceRef: null, modifiedAt: '', author: '', kind: 'freetext',
  rect: [10, 60, 60, 90], text: 'ab\ncd', lines: ['ab', 'cd'], fontSize: 10, textColor: [0, 0, 1],
  background: { color: [1, 1, 0], opacity: 0.5 }, ...over,
})

// Page 100pt tall, scale 2: screen = (2x, 2(100 - y)).
const vp = {
  scale: 2,
  width: 200,
  height: 200,
  rotation: 0,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

describe('freetext kind', () => {
  it('renders background then one text per line at the shared baselines', () => {
    const store = new AnnotationStore()
    store.add(ft())
    const { container } = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp } })
    const rect = container.querySelector('rect')!
    expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')])
      .toEqual(['20', '20', '100', '60'])
    expect(rect.getAttribute('fill')).toBe('rgb(255,255,0)')
    expect(rect.getAttribute('fill-opacity')).toBe('0.5')
    const texts = [...container.querySelectorAll('text')]
    expect(texts.map((t) => t.textContent)).toEqual(['ab', 'cd'])
    // top 20 + (4 + 10 * 0.8) * 2 = 44; next line + 10 * 1.2 * 2 = 24.
    expect(texts.map((t) => [t.getAttribute('x'), t.getAttribute('y')])).toEqual([['23', '39'], ['23', '63']])
    expect(texts[0].getAttribute('font-size')).toBe('20')
    expect(texts[0].getAttribute('fill')).toBe('rgb(0,0,255)')
    expect(texts[0].getAttribute('font-family')).toContain('Arial')
  })

  it('draws no background rect when transparent', () => {
    const store = new AnnotationStore()
    store.add(ft({ background: null }))
    const { container } = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp } })
    expect(container.querySelector('rect')).toBeNull()
  })

  it('hit-tests the rect with tolerance, translates and reports bounds', () => {
    const a = ft()
    expect(freetextKind.hitTest(a, [30, 70], 0)).toBe(true)
    expect(freetextKind.hitTest(a, [62, 70], 0)).toBe(false)
    expect(freetextKind.hitTest(a, [62, 70], 3)).toBe(true)
    expect(freetextKind.translate(a, 5, -5).rect).toEqual([15, 55, 65, 85])
    expect(freetextKind.bounds(a)).toEqual([10, 60, 60, 90])
  })
})

describe('editor insets (baseline parity with the committed box)', () => {
  it('lifts Arial text by 0.146 em so the baseline sits at top + pad + 0.8 em', () => {
    // Arial in a 1.2 line box: baseline 0.0415 + 0.905 = 0.9465 em below the line top.
    expect(EDITOR_BASELINE_SHIFT).toBeCloseTo((1.2 - (0.905 + 0.212)) / 2 + 0.905 - 0.8, 3)
    expect(editorInsets(10, 2)).toEqual({ offsetTop: 0, paddingTop: 0.08, paddingBottom: 3.7, minHeight: 27.78 })
  })

  it('moves the box up when the lift exceeds the top padding, keeping the bottom edge', () => {
    // 40pt at scale 1: lift 5.84 > padding 1.5. The bottom padding loses the
    // 0.111 em the box's shorter last line leaves out (4.44).
    expect(editorInsets(40, 1)).toEqual({ offsetTop: 4.34, paddingTop: 0, paddingBottom: 2.9, minHeight: 50.9 })
  })
})

describe('text box editor in the overlay', () => {
  function mountEditor(over: Partial<TextEdit> = {}) {
    const edit: TextEdit = { draft: ft({ text: 'hi', background: null }), rotation: 0, setText: vi.fn(), commit: vi.fn(), ...over }
    const tool = { onPointerDown: vi.fn() }
    const r = render(Overlay, { props: { pageNumber: 1, scale: 2, store: new AnnotationStore(), viewport: vp, tool, textEdit: edit } })
    const ta = r.container.querySelector('textarea')!
    return { ...r, edit, tool, ta }
  }

  it('positions a focused textarea over the box with matching font metrics', () => {
    const { ta } = mountEditor()
    expect(ta.value).toBe('hi')
    expect(document.activeElement).toBe(ta)
    expect(ta.style.left).toBe('20px')
    expect(ta.style.top).toBe('20px')
    expect(ta.style.width).toBe('100px')
    expect(ta.style.fontSize).toBe('20px')
    expect(ta.style.paddingTop).toBe('0.08px')
    expect(ta.style.paddingBottom).toBe('3.7px')
    expect(ta.style.paddingLeft).toBe('3px')
    expect(ta.style.paddingRight).toBe('3px')
    expect(ta.style.minHeight).toBe('27.78px')
    expect(ta.style.fontFamily).toContain('Arial')
    expect(ta.style.background).toBe('transparent')
  })

  it('reports input, commits on Escape and on blur, and keeps pointer input from the tool', async () => {
    const { ta, edit, tool } = mountEditor()
    ta.value = 'hello'
    await fireEvent.input(ta)
    expect(edit.setText).toHaveBeenCalledWith('hello')
    await fireEvent.pointerDown(ta, { button: 0, pointerId: 1 })
    expect(tool.onPointerDown).not.toHaveBeenCalled()
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    ta.dispatchEvent(esc)
    window.removeEventListener('keydown', onWindow)
    expect(edit.commit).toHaveBeenCalledTimes(1)
    expect(onWindow).not.toHaveBeenCalled()
    await fireEvent.blur(ta)
    expect(edit.commit).toHaveBeenCalledTimes(2)
  })

  it('shows the "Text" placeholder', () => {
    const { ta } = mountEditor({ draft: ft({ text: '', background: null }) })
    expect(ta.placeholder).toBe('Text')
  })

  it('while sizing, is shown without focus or pointer input, and takes focus when placed', async () => {
    const draft = ft({ text: '', background: null })
    const { ta, edit, rerender } = mountEditor({ draft, sizing: true })
    expect(document.activeElement).not.toBe(ta)
    expect(ta.classList).toContain('sizing')
    await rerender({ textEdit: { ...edit, sizing: false } })
    expect(document.activeElement).toBe(ta)
    expect(ta.classList).not.toContain('sizing')
    expect(edit.commit).not.toHaveBeenCalled()
  })

  it('keeps Ctrl+Z in the textarea but lets Ctrl+S reach the app', () => {
    const { ta } = mountEditor()
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    window.removeEventListener('keydown', onWindow)
    expect(onWindow.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual(['s'])
  })

  it('commits when unmounted (page scrolled away)', () => {
    const { edit, unmount } = mountEditor()
    unmount()
    expect(edit.commit).toHaveBeenCalled()
  })
})

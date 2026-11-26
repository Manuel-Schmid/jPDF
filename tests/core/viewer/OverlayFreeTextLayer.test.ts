import { render } from '@testing-library/svelte'
import type { PageViewport } from 'pdfjs-dist'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import type { TextEdit, ToolHandler } from '../../../src/core/registry/tools'
import type { FreeTextAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import Overlay from '../../../src/core/viewer/Overlay.svelte'
import { textLayers } from '../../../src/core/viewer/textLayers'

// Page 100pt tall at scale 2.
const vp = {
  scale: 2,
  rotation: 0,
  width: 200,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x * 2, (100 - y) * 2],
  convertToPdfPoint: (x: number, y: number) => [x / 2, 100 - y / 2],
} as unknown as PageViewport

function textBox(id: string, over: Partial<FreeTextAnnotation> = {}): FreeTextAnnotation {
  return {
    id,
    page: 0,
    sourceRef: null,
    modifiedAt: '',
    author: '',
    kind: 'freetext',
    rect: [10, 50, 60, 70],
    text: id,
    lines: [id],
    fontSize: 10,
    textColor: [0, 0, 0],
    background: null,
    align: 'left',
    ...over,
  }
}

/** A text-selecting tool (underline-like): previews instead of tinting the selection. */
const underline: ToolHandler = { textSelection: () => ({ color: null }) }

function mount(props: Record<string, unknown>, boxes: FreeTextAnnotation[]) {
  const store = new AnnotationStore()
  store.load(boxes)
  const r = render(Overlay, { props: { pageNumber: 1, scale: 2, store, viewport: vp, ...props } })
  return { ...r, store, layer: () => r.container.querySelector('.free-text-layer') }
}

afterEach(() => vi.restoreAllMocks())

describe('Overlay: text boxes markable by the text markup tools', () => {
  it('a text-selecting tool gets a text layer of the boxes, registered as freeText', () => {
    const { layer } = mount({ tool: underline }, [textBox('Note')])
    const el = layer()
    expect(el).not.toBeNull()
    expect(el!.querySelector('.box span')?.textContent).toBe('Note')
    const entry = [...textLayers()].find(([l]) => l === el)
    expect(entry?.[1]).toMatchObject({ page: 0, freeText: true })
    // Hidden selection colour: the tool previews its lines instead.
    expect((el as HTMLElement).style.getPropertyValue('--selection-tint')).toBe('transparent')
  })

  it('other tools (and no tool) never mount it', () => {
    expect(mount({ tool: { onPointerDown() {} } }, [textBox('Note')]).layer()).toBeNull()
    expect(mount({ tool: null }, [textBox('Note')]).layer()).toBeNull()
  })

  it('leaves out turned boxes and the box being edited', () => {
    const edited = textBox('Edited')
    const edit = { draft: edited, rotation: 0, setText() {}, commit() {} } satisfies TextEdit
    const { layer } = mount({ tool: underline, textEdit: edit }, [textBox('Upright'), textBox('Turned', { rotation: 90 }), edited])
    expect([...layer()!.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['Upright'])
  })

  it('is not there without any markable box, and goes away with its unregistration', () => {
    const { layer, unmount } = mount({ tool: underline }, [textBox('Turned', { rotation: 90 })])
    expect(layer()).toBeNull()
    unmount()
    expect([...textLayers()].some(([, info]) => info.freeText)).toBe(false)
  })

  it('a right press on box text with a text-selecting tool is left to unmarking, not erased', () => {
    const erase = vi.fn()
    const { layer } = mount({ tool: underline, eraser: { onPointerDown: erase } }, [textBox('Note')])
    const span = layer()!.querySelector('span')!
    const down = new PointerEvent('pointerdown', { button: 2, buttons: 2, pointerId: 1, bubbles: true, cancelable: true })
    span.dispatchEvent(down)
    expect(erase).not.toHaveBeenCalled()
    expect(down.defaultPrevented).toBe(false)
  })
})

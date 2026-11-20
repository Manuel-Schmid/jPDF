import { describe, expect, it, vi } from 'vitest'
import '../../../src/annotations'
import { createTextHandler, textTool, type TextSettings } from '../../../src/tools/text'
import { fittedWidth } from '../../../src/tools/text/editing'
import type { PagePointerEvent, TextEdit, ToolContext } from '../../../src/core/registry/tools'
import { History } from '../../../src/core/session/history.svelte'
import type { FreeTextAnnotation, Point } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'
import { settings as appSettings } from '../../../src/core/settings/settings.svelte'
import { defaultBoxWidth, measureHelvetica, minBoxWidth, pageBoxRect } from '../../../src/core/geometry/textLayout'

/** A 600 x 800 pt page at scale 2; `screen` follows `pdf` on unrotated pages. */
function ev(pdf: Point, rotation = 0): PagePointerEvent {
  return {
    page: 1,
    pdf,
    screen: [pdf[0] * 2, (800 - pdf[1]) * 2],
    vp: { scale: 2, rotation, width: 1200, height: 1600 } as never,
    native: {} as PointerEvent,
    toPdf: () => pdf,
  }
}

const SETTINGS: TextSettings = { textColor: [0, 0, 1], fontSize: 10, background: { color: [1, 1, 0], opacity: 0.5 } }

function box(over: Partial<FreeTextAnnotation> = {}): FreeTextAnnotation {
  return {
    id: 'box', page: 1, sourceRef: '7R', modifiedAt: '2026-01-01T00:00:00Z', author: 'Someone', kind: 'freetext',
    rect: [100, 468, 300, 500], text: 'old', lines: ['old'], fontSize: 10, textColor: [1, 0, 0], background: null, align: 'left',
    ...over,
  }
}

function setup(loaded: FreeTextAnnotation[] = [], settings: TextSettings = SETTINGS) {
  const store = new AnnotationStore()
  store.load(loaded)
  const history = new History(store)
  const session = {
    store,
    history,
    pendingEdit: null as (() => void) | null,
    commitPendingEdit() {
      const c = session.pendingEdit
      session.pendingEdit = null
      c?.()
    },
  }
  let edit: TextEdit | null = null
  let hidden: string[] = []
  const ctx = {
    session,
    execute: (c: Parameters<History['execute']>[0]) => history.execute(c),
    exit: vi.fn(),
    textEdit: { set: (e: TextEdit | null) => void (edit = e) },
    hidden: { set: (ids: Iterable<string>) => void (hidden = [...ids]) },
  } as unknown as ToolContext
  const handler = createTextHandler(ctx, () => settings)
  const click = (p: Point, rotation = 0) => {
    handler.onPointerDown!(ev(p, rotation))
    handler.onPointerUp!(ev(p, rotation))
  }
  /** Press at `from`, drag through `path`, release at its last point. */
  const drag = (from: Point, ...path: Point[]) => {
    handler.onPointerDown!(ev(from))
    for (const p of path) handler.onPointerMove!(ev(p))
    handler.onPointerUp!(ev(path.at(-1) ?? from))
  }
  return { store, history, session, ctx, handler, click, drag, edit: () => edit, hidden: () => hidden }
}

const texts = (store: AnnotationStore) => store.all().map((a) => (a as FreeTextAnnotation).text)

describe('text tool', () => {
  it('default settings match the toolbar default', () => {
    expect(textTool.defaultSettings).toEqual({ textColor: [0, 0, 0], fontSize: 12, background: null, align: 'left' })
    expect(textTool.shortcut).toBe('T')
    expect(textTool.allowMultipleInstances).toBe(true)
  })

  it('new boxes take the alignment from the settings, left when saved settings have none', () => {
    const right = setup([], { ...SETTINGS, align: 'right' })
    right.click([100, 500])
    expect(right.edit()!.draft.align).toBe('right')
    // Settings saved before alignment existed have no `align`.
    const old = setup([], SETTINGS)
    old.click([100, 500])
    expect(old.edit()!.draft.align).toBe('left')
  })

  it('click creates a box at the click point in edit state', () => {
    const t = setup()
    t.click([100, 500])
    const e = t.edit()!
    expect(e).not.toBeNull()
    expect(e.rotation).toBe(0)
    // One line at 10pt: 10 * 1.2 + 2 * 1.5 = 15 tall, the placeholder's 23 wide, top-left at the click.
    expect(e.sizing).toBe(false)
    expect(e.draft).toMatchObject({
      kind: 'freetext', page: 1, sourceRef: null, text: '', rect: [100, 485, 123, 500],
      fontSize: 10, textColor: [0, 0, 1], background: { color: [1, 1, 0], opacity: 0.5 },
      author: appSettings.data.author,
    })
    expect(t.store.all()).toEqual([])
    expect(t.history.canUndo).toBe(false)
    expect(t.session.pendingEdit).not.toBeNull()
  })

  it('commit adds the annotation with wrapped lines and fitted height', () => {
    const t = setup()
    t.drag([100, 500], [300, 500])
    const e = t.edit()!
    e.setText('Hello world\nsecond')
    e.commit()
    expect(t.edit()).toBeNull()
    expect(t.session.pendingEdit).toBeNull()
    const [a] = t.store.all() as FreeTextAnnotation[]
    expect(a).toMatchObject({ text: 'Hello world\nsecond', lines: ['Hello world', 'second'], rect: [100, 473, 300, 500] })
    expect(a.id).toBe(e.draft.id)
    e.commit() // blur after Escape: no second add
    expect(t.store.all()).toHaveLength(1)
    t.history.undo()
    expect(t.store.all()).toEqual([])
  })

  it('Escape commits the box, then hands over to the select tool', () => {
    const t = setup()
    t.click([100, 500])
    const e = t.edit()!
    e.setText('Hi')
    e.escape!()
    expect(texts(t.store)).toEqual(['Hi'])
    expect(t.edit()).toBeNull()
    expect(t.ctx.exit).toHaveBeenCalledOnce()
    // A stale editor (already closed) does nothing.
    e.escape!()
    expect(t.ctx.exit).toHaveBeenCalledOnce()
  })

  it('is unlocked by default: it hands over to the select tool after each box', () => {
    expect(textTool.defaultLocked).toBe(false)
  })

  it('blank text discards a new box', () => {
    const t = setup()
    t.click([100, 500])
    t.edit()!.setText('  \n ')
    t.edit()!.commit()
    expect(t.store.all()).toEqual([])
    expect(t.history.canUndo).toBe(false)
  })

  it('clicking an existing box edits it and commits updateAnnotation', () => {
    const t = setup([box()])
    t.click([150, 490])
    const e = t.edit()!
    expect(e.draft.id).toBe('box')
    expect(t.hidden()).toEqual(['box'])
    e.setText('new text')
    e.commit()
    expect(t.hidden()).toEqual([])
    expect(t.store.all()).toHaveLength(1)
    expect(t.store.get('box')).toMatchObject({
      text: 'new text', lines: ['new text'], rect: [100, 485, 300, 500], sourceRef: '7R',
      author: 'Someone', textColor: [1, 0, 0],
    })
    t.history.undo()
    expect(texts(t.store)).toEqual(['old'])
  })

  it('an unchanged edit records nothing', () => {
    const t = setup([box()])
    t.click([150, 490])
    t.edit()!.commit()
    expect(t.history.canUndo).toBe(false)
    expect(t.session.pendingEdit).toBeNull()
  })

  it('editing an existing box to blank deletes it', () => {
    const t = setup([box()])
    t.click([150, 490])
    t.edit()!.setText(' ')
    t.edit()!.commit()
    expect(t.store.all()).toEqual([])
    t.history.undo()
    expect(texts(t.store)).toEqual(['old'])
  })

  it('a click while a box is open only closes it', () => {
    const t = setup()
    t.click([100, 500])
    t.edit()!.setText('first')
    t.click([10, 10])
    expect(t.edit()).toBeNull()
    expect(texts(t.store)).toEqual(['first'])
    t.click([10, 10])
    expect(t.edit()).not.toBeNull()
  })

  it('commitPendingEdit (save) and deactivation commit the open box', () => {
    const t = setup()
    t.click([100, 500])
    t.edit()!.setText('saved')
    t.session.commitPendingEdit()
    expect(texts(t.store)).toEqual(['saved'])
    t.click([100, 300])
    t.edit()!.setText('on tool switch')
    t.handler.onDeactivate!()
    expect(texts(t.store)).toEqual(['saved', 'on tool switch'])
    expect(t.edit()).toBeNull()
  })

  it('on a rotated page the box is laid out in the screen frame', () => {
    const t = setup()
    t.click([100, 500], 90)
    const e = t.edit()!
    expect(e.rotation).toBe(90)
    expect(e.draft.rect).toEqual(pageBoxRect([100, 500], 23, 15, 90))
    e.setText('a\nb')
    e.commit()
    // Two lines: 27 tall on screen = 27 wide in PDF x; top-left corner kept.
    expect((t.store.all()[0] as FreeTextAnnotation).rect).toEqual([100, 500, 127, 523])
  })

  it('a new box shows on the press, unfocused (sizing) until release', () => {
    const t = setup()
    t.handler.onPointerDown!(ev([100, 500]))
    expect(t.edit()!.sizing).toBe(true)
    expect(t.edit()!.draft.rect).toEqual([100, 485, 123, 500])
    t.handler.onPointerUp!(ev([100, 500]))
    expect(t.edit()!.sizing).toBe(false)
  })

  it('dragging right sets the width; the box keeps one line and its corner', () => {
    const t = setup()
    t.drag([100, 500], [150, 490], [250, 470])
    const e = t.edit()!
    expect(e.sizing).toBe(false)
    expect(e.draft.rect).toEqual([100, 485, 250, 500])
    e.setText('typed')
    e.commit()
    expect((t.store.all()[0] as FreeTextAnnotation).rect).toEqual([100, 485, 250, 500])
  })

  it('keeps the default width until the pointer passes its right edge', () => {
    const t = setup()
    const width = () => t.edit()!.draft.rect[2] - t.edit()!.draft.rect[0]
    t.handler.onPointerDown!(ev([100, 500]))
    // Inside the default width (23) and to the left: unchanged.
    for (const x of [105, 115, 123, 40]) {
      t.handler.onPointerMove!(ev([x, 500]))
      expect(width()).toBe(defaultBoxWidth(10))
    }
    t.handler.onPointerMove!(ev([200, 500]))
    expect(width()).toBe(100)
  })

  it('once past the default width, the right edge follows the pointer both ways, down to one letter', () => {
    const t = setup()
    const width = () => t.edit()!.draft.rect[2] - t.edit()!.draft.rect[0]
    t.handler.onPointerDown!(ev([100, 500]))
    t.handler.onPointerMove!(ev([180, 500]))
    expect(width()).toBe(80)
    t.handler.onPointerMove!(ev([130, 500]))
    expect(width()).toBe(30)
    t.handler.onPointerMove!(ev([101, 500]))
    expect(width()).toBeCloseTo(minBoxWidth(10))
    t.handler.onPointerMove!(ev([20, 500]))
    expect(width()).toBeCloseTo(minBoxWidth(10))
    t.handler.onPointerUp!(ev([20, 500]))
    expect(t.edit()!.sizing).toBe(false)
  })

  it('dragging on a rotated page widens along screen right', () => {
    const t = setup()
    t.handler.onPointerDown!(ev([100, 500], 90))
    t.handler.onPointerMove!(ev([100, 620], 90))
    t.handler.onPointerUp!(ev([100, 620], 90))
    expect(t.edit()!.draft.rect).toEqual(pageBoxRect([100, 500], 120, 15, 90))
  })

  it('an aborted placement leaves nothing behind', () => {
    const t = setup()
    t.handler.onPointerDown!(ev([100, 500]))
    t.handler.onPointerCancel!(ev([100, 500]))
    expect(t.edit()).toBeNull()
    expect(t.store.all()).toEqual([])
    expect(t.session.pendingEdit).toBeNull()
  })

  it('fittedWidth: longest hard line plus padding, whole points, clamped', () => {
    // "Hello" is 22.78 pt at 10 pt: + 3 padding = 25.78, rounded up.
    expect(fittedWidth('Hello', 10, 23, 150)).toBe(26)
    expect(fittedWidth('Hi\nHello', 10, 23, 150)).toBe(26)
    expect(fittedWidth('', 10, 23, 150)).toBe(23)
    expect(fittedWidth('x'.repeat(100), 10, 23, 150)).toBe(150)
  })

  describe('a clicked box grows while typing', () => {
    const width = (t: ReturnType<typeof setup>) => t.edit()!.draft.rect[2] - t.edit()!.draft.rect[0]

    it('widens with the text and narrows again when text is removed', () => {
      const t = setup()
      t.click([100, 500])
      t.edit()!.setText('Hello')
      expect(width(t)).toBe(26)
      expect(t.edit()!.draft.lines).toEqual(['Hello'])
      t.edit()!.setText('Hi')
      expect(width(t)).toBe(defaultBoxWidth(10))
    })

    it('stops at a quarter of the page width and wraps beyond', () => {
      const t = setup()
      t.click([100, 500])
      const text = 'the quick brown fox jumps over the lazy dog again and again'
      expect(measureHelvetica(text, 10)).toBeGreaterThan(150)
      t.edit()!.setText(text)
      // The page is 600 pt wide: 25% = 150.
      expect(width(t)).toBe(150)
      expect(t.edit()!.draft.lines.length).toBeGreaterThan(1)
      t.edit()!.commit()
      const a = t.store.all()[0] as FreeTextAnnotation
      expect(a.rect[2] - a.rect[0]).toBe(150)
      expect(a.lines.length).toBeGreaterThan(1)
    })

    it('stops at the page edge when that comes first', () => {
      const t = setup()
      t.click([550, 500])
      t.edit()!.setText('the quick brown fox jumps over the lazy dog')
      expect(width(t)).toBe(50)
    })

    it('a dragged box keeps its width', () => {
      const t = setup()
      t.drag([100, 500], [200, 500])
      t.edit()!.setText('the quick brown fox jumps over the lazy dog')
      expect(width(t)).toBe(100)
    })

    it('an existing box keeps its width', () => {
      const t = setup([box()])
      t.click([150, 490])
      t.edit()!.setText('x')
      expect(width(t)).toBe(200)
    })
  })

  it('pressing an existing box does not start a new one', () => {
    const t = setup([box()])
    t.handler.onPointerDown!(ev([150, 490]))
    expect(t.edit()).toBeNull()
    t.handler.onPointerUp!(ev([150, 490]))
    expect(t.edit()!.draft.id).toBe('box')
  })
})

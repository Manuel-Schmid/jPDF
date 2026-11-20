import { describe, expect, it, vi } from 'vitest'
import { pageFlatten, pageMenuItems } from '../../src/app/pageMenu'
import { History } from '../../src/core/session/history.svelte'
import type { ZOrder } from '../../src/core/session/commands'
import type { Annotation } from '../../src/core/session/model'
import { AnnotationStore } from '../../src/core/session/store.svelte'
import { actionIcons } from '../../src/ui/actionIcons'
import type { MenuItem } from '../../src/ui/ContextMenu.svelte'
import { toasts } from '../../src/ui/toasts.svelte'
import { rightClickErases } from '../../src/tools/rightClick'

describe('rightClickErases', () => {
  it('erases with the drawing tools: pen, text box, shape, freehand marker, eraser', () => {
    expect(rightClickErases('pen', {})).toBe(true)
    expect(rightClickErases('text', {})).toBe(true)
    expect(rightClickErases('shape', {})).toBe(true)
    expect(rightClickErases('eraser', {})).toBe(true)
    expect(rightClickErases('marker', { mode: 'freehand' })).toBe(true)
  })

  it('opens the page menu instead with select, lasso and the text-selection marker', () => {
    expect(rightClickErases('select', {})).toBe(false)
    expect(rightClickErases('lasso', {})).toBe(false)
    expect(rightClickErases('marker', { mode: 'text' })).toBe(false)
    expect(rightClickErases('marker', undefined)).toBe(false)
  })

  it('opens the page menu for unknown or no tool', () => {
    expect(rightClickErases('future', {})).toBe(false)
    expect(rightClickErases(null, null)).toBe(false)
  })
})

function actions(canDelete = true) {
  return {
    duplicatePage: vi.fn(),
    deletePage: vi.fn(),
    insertBlankPage: vi.fn(async () => {}),
    rotatePage: vi.fn(async () => {}),
    canDeletePage: () => canDelete,
  }
}

const item = (items: MenuItem[], label: string) => items.find((i) => i.label === label)!

describe('pageMenuItems', () => {
  it('lists the page actions for the page that was right-clicked (1-based)', () => {
    expect(pageMenuItems(3, actions()).map((i) => i.label)).toEqual([
      'Insert image',
      'Insert empty page after page 3',
      'Duplicate page 3',
      'Rotate right',
      'Rotate left',
      'Delete page 3',
    ])
  })

  it('marks delete as dangerous', () => {
    expect(item(pageMenuItems(1, actions()), 'Delete page 1').danger).toBe(true)
  })

  it('runs the page operation on the clicked page (0-based)', () => {
    const a = actions()
    const items = pageMenuItems(3, a)
    item(items, 'Duplicate page 3').run()
    item(items, 'Delete page 3').run()
    item(items, 'Insert empty page after page 3').run()
    item(items, 'Rotate right').run()
    item(items, 'Rotate left').run()
    expect(a.duplicatePage).toHaveBeenCalledWith(2)
    expect(a.deletePage).toHaveBeenCalledWith(2)
    expect(a.insertBlankPage).toHaveBeenCalledWith(2)
    expect(a.rotatePage.mock.calls).toEqual([[2, 90], [2, -90]])
  })

  it('disables delete when only one page is left', () => {
    expect(item(pageMenuItems(1, actions(false)), 'Delete page 1').disabled).toBe(true)
    expect(item(pageMenuItems(1, actions(true)), 'Delete page 1').disabled).toBeFalsy()
  })

  it('reports a failed page operation with a toast', async () => {
    const a = actions()
    a.rotatePage.mockRejectedValue(new Error('boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    item(pageMenuItems(1, a), 'Rotate right').run()
    await vi.waitFor(() => expect(toasts.items.at(-1)?.message).toBe('Could not rotate the page'))
    err.mockRestore()
  })

  it('Insert image is disabled without a clipboard image', () => {
    expect(item(pageMenuItems(2, actions()), 'Insert image').disabled).toBe(true)
    const insert = vi.fn()
    const i = item(pageMenuItems(2, actions(), { image: null, insert }), 'Insert image')
    expect(i.disabled).toBe(true)
  })

  it('Insert image is enabled with a clipboard image and inserts that image', () => {
    const image = { width: 1, height: 1, rgba: new Uint8Array(4) }
    const insert = vi.fn(async () => {})
    const a = actions()
    const i = item(pageMenuItems(2, a, { image, insert }), 'Insert image')
    expect(i.disabled).toBe(false)
    i.run()
    expect(insert).toHaveBeenCalledWith(image)
    expect(Object.values(a).filter((f) => typeof f === 'function' && 'mock' in f && f.mock.calls.length)).toEqual([])
  })

  it('reports a failed insert with a toast', async () => {
    const insert = vi.fn(async () => {
      throw new Error('boom')
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    item(pageMenuItems(1, actions(), { image: { width: 1, height: 1, rgba: new Uint8Array(4) }, insert }), 'Insert image').run()
    await vi.waitFor(() => expect(toasts.items.at(-1)?.message).toBe('Could not insert the image'))
    err.mockRestore()
  })
})

describe('pageMenuItems flatten and icons', () => {
  const flatten = (selected: number, onPage: number) => ({
    selected,
    onPage,
    flattenSelection: vi.fn(),
    flattenPage: vi.fn(),
  })

  it('offers flattening before delete; "Flatten selection" only with a selection on the page', () => {
    expect(pageMenuItems(2, actions(), undefined, flatten(0, 3)).map((i) => i.label).slice(-2)).toEqual([
      'Flatten all annotations on page 2',
      'Delete page 2',
    ])
    expect(pageMenuItems(2, actions(), undefined, flatten(2, 3)).map((i) => i.label).slice(-3)).toEqual([
      'Flatten selection',
      'Flatten all annotations on page 2',
      'Delete page 2',
    ])
  })

  it('runs the flatten actions; "Flatten all" is disabled on a page without annotations', () => {
    const f = flatten(1, 2)
    const items = pageMenuItems(1, actions(), undefined, f)
    item(items, 'Flatten selection').run()
    item(items, 'Flatten all annotations on page 1').run()
    expect(f.flattenSelection).toHaveBeenCalledOnce()
    expect(f.flattenPage).toHaveBeenCalledOnce()
    expect(item(pageMenuItems(1, actions(), undefined, flatten(0, 0)), 'Flatten all annotations on page 1').disabled).toBe(true)
  })

  it('gives every item its action icon, the same one wherever the action appears', () => {
    const items = pageMenuItems(3, actions(), undefined, flatten(1, 1))
    expect(items.every((i) => i.icon)).toBe(true)
    expect(item(items, 'Insert image').icon).toBe(actionIcons.insertImage)
    expect(item(items, 'Insert empty page after page 3').icon).toBe(actionIcons.insertPage)
    expect(item(items, 'Duplicate page 3').icon).toBe(actionIcons.duplicate)
    expect(item(items, 'Rotate right').icon).toBe(actionIcons.rotateRight)
    expect(item(items, 'Rotate left').icon).toBe(actionIcons.rotateLeft)
    expect(item(items, 'Flatten selection').icon).toBe(actionIcons.flatten)
    expect(item(items, 'Flatten all annotations on page 3').icon).toBe(actionIcons.flatten)
    expect(item(items, 'Delete page 3').icon).toBe(actionIcons.delete)
  })
})

describe('pageFlatten', () => {
  const ink = (id: string, page: number, flattened = false): Annotation => ({
    id, page, sourceRef: null, modifiedAt: 't', author: 'A', kind: 'ink', strokes: [[[0, 0], [1, 1]]],
    color: [1, 0, 0], width: 1, opacity: 1, blend: 'normal', role: 'pen', ...(flattened ? { flattened: true as const } : {}),
  })

  function session() {
    const store = new AnnotationStore()
    store.load([ink('a', 0), ink('b', 0), ink('done', 0, true), ink('other', 1)])
    return { store, history: new History(store) }
  }

  it('counts the selected and editable annotations of the page only', () => {
    const f = pageFlatten(session(), ['a', 'other', 'done'], 1)
    expect(f.selected).toBe(1)
    expect(f.onPage).toBe(2)
  })

  it('flattens the selection on the page, or all of its annotations, one undo step each', () => {
    const s = session()
    pageFlatten(s, ['a', 'other'], 1).flattenSelection()
    expect(s.store.all().filter((a) => a.flattened).map((a) => a.id)).toEqual(['a', 'done'])
    pageFlatten(s, [], 1).flattenPage()
    expect(s.store.byPage(0).every((a) => a.flattened)).toBe(true)
    expect(s.store.get('other')!.flattened).toBeUndefined()
    s.history.undo()
    s.history.undo()
    expect(s.store.all().filter((a) => a.flattened).map((a) => a.id)).toEqual(['done'])
  })
})

describe('pageMenuItems for a right-clicked selection', () => {
  const selection = (count: number, canRestack = (_how: ZOrder) => true) => ({
    count, duplicate: vi.fn(), restack: vi.fn(), canRestack, flatten: vi.fn(), delete: vi.fn(),
  })
  const flatten = { selected: 1, onPage: 2, flattenSelection: vi.fn(), flattenPage: vi.fn() }

  it('puts the selection actions first, then a divider and the page actions', () => {
    const items = pageMenuItems(2, actions(), undefined, flatten, selection(1))
    expect(items.map((i) => i.label)).toEqual([
      'Duplicate',
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
      'Flatten',
      'Delete',
      'Insert image',
      'Insert empty page after page 2',
      'Duplicate page 2',
      'Rotate right',
      'Rotate left',
      'Flatten all annotations on page 2',
      'Delete page 2',
    ])
    expect(items.filter((i) => i.separatorBefore).map((i) => i.label)).toEqual(['Bring to front', 'Flatten', 'Insert image'])
    expect(item(items, 'Delete').danger).toBe(true)
    expect(item(items, 'Duplicate').icon).toBe(actionIcons.duplicate)
    expect(item(items, 'Flatten').icon).toBe(actionIcons.flatten)
    expect(item(items, 'Delete').icon).toBe(actionIcons.delete)
  })

  it('names the count for a group and runs the selection actions', () => {
    const s = selection(3)
    const items = pageMenuItems(1, actions(), undefined, undefined, s)
    item(items, 'Duplicate 3 annotations').run()
    item(items, 'Flatten 3 annotations').run()
    item(items, 'Delete 3 annotations').run()
    expect([s.duplicate, s.flatten, s.delete].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('restacks the selection; an order change that would move nothing is disabled', () => {
    const s = selection(2, (how) => how !== 'front')
    const items = pageMenuItems(1, actions(), undefined, undefined, s)
    expect(item(items, 'Bring to front').disabled).toBe(true)
    expect(item(items, 'Send to back').disabled).toBe(false)
    expect(item(items, 'Bring to front').icon).toBe(actionIcons.bringToFront)
    expect(item(items, 'Send to back').icon).toBe(actionIcons.sendToBack)
    item(items, 'Bring forward').run()
    item(items, 'Send to back').run()
    expect(s.restack.mock.calls).toEqual([['forward'], ['back']])
  })

  it('has no divider without a selection', () => {
    expect(pageMenuItems(1, actions()).some((i) => i.separatorBefore)).toBe(false)
  })
})

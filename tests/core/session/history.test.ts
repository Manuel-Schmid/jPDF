import { describe, expect, it } from 'vitest'
import { addAnnotations, deleteAnnotations, updateAnnotation } from '../../../src/core/session/commands'
import { History } from '../../../src/core/session/history.svelte'
import type { Annotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'

function hl(id: string, opacity = 0.4): Annotation {
  return {
    id, page: 0, sourceRef: null, modifiedAt: '2026-01-01T00:00:00Z', author: 'a',
    kind: 'highlight', quads: [[0, 1, 1, 1, 0, 0, 1, 0]], color: [1, 1, 0], opacity,
  }
}
function setup(limit?: number) {
  const store = new AnnotationStore()
  return { store, h: new History(store, limit) }
}
const ids = (s: AnnotationStore) => s.all().map((a) => a.id)

describe('History', () => {
  it('execute/undo/redo round trip restores store state', () => {
    const { store, h } = setup()
    const a = hl('a'), b = hl('b')
    h.execute(addAnnotations([a, b]))
    expect(ids(store)).toEqual(['a', 'b'])
    h.execute(updateAnnotation(a, { ...a, opacity: 0.9 }))
    expect(store.get('a')).toMatchObject({ opacity: 0.9 })
    h.execute(deleteAnnotations([b]))
    expect(ids(store)).toEqual(['a'])

    expect(h.undo()).toBe(true)
    expect(ids(store)).toEqual(['a', 'b'])
    expect(h.undo()).toBe(true)
    expect(store.get('a')).toBe(a)
    expect(h.undo()).toBe(true)
    expect(ids(store)).toEqual([])
    expect(h.undo()).toBe(false)

    expect(h.redo()).toBe(true); expect(h.redo()).toBe(true); expect(h.redo()).toBe(true)
    expect(ids(store)).toEqual(['a'])
    expect(store.get('a')).toMatchObject({ opacity: 0.9 })
    expect(h.redo()).toBe(false)
  })

  it('undo of delete restores exact z-order (middle and non-adjacent)', () => {
    const { store, h } = setup()
    const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => hl(id))
    h.execute(addAnnotations(all))
    h.execute(deleteAnnotations([all[2]]))
    expect(ids(store)).toEqual(['a', 'b', 'd', 'e', 'f'])
    h.undo()
    expect(store.byPage(0).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    // Non-adjacent, given out of order.
    h.execute(deleteAnnotations([all[4], all[0], all[2]]))
    expect(ids(store)).toEqual(['b', 'd', 'f'])
    h.undo()
    expect(store.byPage(0).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(ids(store)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    h.redo()
    expect(ids(store)).toEqual(['b', 'd', 'f'])
    h.undo()
    expect(ids(store)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('canUndo/canRedo/version track position', () => {
    const { h } = setup()
    expect([h.canUndo, h.canRedo, h.version]).toEqual([false, false, 0])
    h.execute(addAnnotations([hl('a')]))
    expect([h.canUndo, h.canRedo, h.version]).toEqual([true, false, 1])
    h.undo()
    expect([h.canUndo, h.canRedo, h.version]).toEqual([false, true, 2])
    h.redo()
    expect(h.version).toBe(3)
  })

  it('execute after undo clears redo stack', () => {
    const { store, h } = setup()
    h.execute(addAnnotations([hl('a')]))
    h.undo()
    expect(h.canRedo).toBe(true)
    h.execute(addAnnotations([hl('b')]))
    expect(h.canRedo).toBe(false)
    expect(h.redo()).toBe(false)
    expect(ids(store)).toEqual(['b'])
  })

  it('limit drops oldest', () => {
    const { store, h } = setup(2)
    h.execute(addAnnotations([hl('a')]))
    h.execute(addAnnotations([hl('b')]))
    h.execute(addAnnotations([hl('c')]))
    expect(h.undo()).toBe(true)
    expect(h.undo()).toBe(true)
    expect(h.undo()).toBe(false)
    expect(ids(store)).toEqual(['a'])
  })

  it('isDirty false after markClean, true after execute, false again after undo back to clean', () => {
    const { h } = setup()
    expect(h.isDirty).toBe(false)
    h.execute(addAnnotations([hl('a')]))
    expect(h.isDirty).toBe(true)
    h.markClean()
    expect(h.isDirty).toBe(false)
    h.execute(addAnnotations([hl('b')]))
    expect(h.isDirty).toBe(true)
    h.undo()
    expect(h.isDirty).toBe(false)
    h.undo()
    expect(h.isDirty).toBe(true)
    h.redo()
    expect(h.isDirty).toBe(false)
  })

  it('undo to clean then a different command is dirty', () => {
    const { h } = setup()
    h.execute(addAnnotations([hl('a')]))
    h.markClean()
    h.undo()
    h.execute(addAnnotations([hl('b')]))
    expect(h.isDirty).toBe(true)
    h.undo()
    expect(h.isDirty).toBe(true)
  })

  it('stays dirty when the clean state was dropped by the limit', () => {
    const { h } = setup(1)
    h.execute(addAnnotations([hl('a')]))
    h.markClean()
    h.execute(addAnnotations([hl('b')]))
    h.execute(addAnnotations([hl('c')]))
    h.undo()
    expect(h.isDirty).toBe(true)
  })

  it('markClean(stateId) marks an earlier position as the saved one', () => {
    const { h } = setup()
    h.execute(addAnnotations([hl('a')]))
    const saved = h.stateId
    h.execute(addAnnotations([hl('b')]))
    h.markClean(saved)
    expect(h.isDirty).toBe(true)
    h.undo()
    expect(h.isDirty).toBe(false)
    h.undo()
    expect(h.isDirty).toBe(true)
  })

  it('amend folds a change into the newest step: one undo, new state id, redo dropped', () => {
    const { store, h } = setup()
    const a = hl('a')
    h.execute(addAnnotations([a]))
    const a1 = { ...a, opacity: 0.5 }, a2 = { ...a, opacity: 0.6 }
    h.execute(updateAnnotation(a, a1))
    h.markClean()
    const saved = h.stateId
    h.amend(updateAnnotation(a1, a2), updateAnnotation(a, a2))
    expect(store.get('a')).toMatchObject({ opacity: 0.6 })
    expect(h.stateId).not.toBe(saved)
    expect(h.isDirty).toBe(true)
    expect(h.undo()).toBe(true)
    expect(store.get('a')).toBe(a)
    expect(h.redo()).toBe(true)
    expect(store.get('a')).toMatchObject({ opacity: 0.6 })
  })

  it('amend with nothing to undo executes the merged step', () => {
    const { store, h } = setup()
    const a = hl('a')
    h.amend(addAnnotations([hl('x')]), addAnnotations([a]))
    expect(ids(store)).toEqual(['a'])
    expect(h.undo()).toBe(true)
    expect(ids(store)).toEqual([])
  })
})

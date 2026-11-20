import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'

function hl(id: string, page = 0, sourceRef: string | null = null): Annotation {
  return {
    id, page, sourceRef, modifiedAt: '2026-01-01T00:00:00Z', author: 'a',
    kind: 'highlight', quads: [[0, 1, 1, 1, 0, 0, 1, 0]], color: [1, 1, 0], opacity: 0.4,
  }
}

describe('AnnotationStore', () => {
  it('add then byPage returns it', () => {
    const s = new AnnotationStore()
    const a = hl('a', 2)
    s.add(a)
    expect(s.byPage(2)).toEqual([a])
    expect(s.byPage(0)).toEqual([])
    expect(s.get('a')).toBe(a)
    expect(s.all()).toEqual([a])
  })

  it('keeps insertion order as z-order', () => {
    const s = new AnnotationStore()
    s.add(hl('a')); s.add(hl('b')); s.add(hl('c'))
    expect(s.byPage(0).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('update replaces object in place', () => {
    const s = new AnnotationStore()
    s.add(hl('a')); s.add(hl('b'))
    const next = { ...hl('a'), opacity: 0.9 }
    s.update('a', next)
    expect(s.get('a')).toBe(next)
    expect(s.byPage(0).map((x) => x.id)).toEqual(['a', 'b'])
    expect(s.byPage(0)[0]).toBe(next)
  })

  it('add with index inserts at that z-position', () => {
    const s = new AnnotationStore()
    s.add(hl('a')); s.add(hl('c'))
    s.add(hl('b'), 1)
    expect(s.byPage(0).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('all() order matches byPage, also after a cross-page update', () => {
    const s = new AnnotationStore()
    s.add(hl('a', 0)); s.add(hl('b', 1)); s.add(hl('c', 0))
    s.update('a', hl('a', 1))
    expect(s.all().map((x) => x.id)).toEqual(['c', 'b', 'a'])
    expect(s.byPage(1).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('update can move an annotation to another page', () => {
    const s = new AnnotationStore()
    s.add(hl('a', 0))
    s.update('a', hl('a', 1))
    expect(s.byPage(0)).toEqual([])
    expect(s.byPage(1).map((x) => x.id)).toEqual(['a'])
  })

  it('remove then deletedSourceRefs contains its sourceRef only if it had one', () => {
    const s = new AnnotationStore()
    s.load([hl('saved', 0, '12R'), hl('plain', 0)])
    s.add(hl('fresh'))
    s.remove('saved'); s.remove('plain'); s.remove('fresh')
    expect(s.deletedSourceRefs()).toEqual(['12R'])
    expect(s.all()).toEqual([])
  })

  it('markSaved assigns sourceRefs and clears changedSince', () => {
    const s = new AnnotationStore()
    s.add(hl('a'))
    expect(s.changedSince().map((x) => x.id)).toEqual(['a'])
    s.markSaved({ a: '7R' }, [])
    expect(s.get('a')?.sourceRef).toBe('7R')
    expect(s.byPage(0)[0].sourceRef).toBe('7R')
    expect(s.changedSince()).toEqual([])
    s.remove('a')
    expect(s.deletedSourceRefs()).toEqual(['7R'])
    s.markSaved({}, ['7R'])
    expect(s.deletedSourceRefs()).toEqual([])
  })

  it('load does not count as a change; update after load does', () => {
    const s = new AnnotationStore()
    s.load([hl('a', 0, '1R'), hl('b', 0, '2R')])
    expect(s.changedSince()).toEqual([])
    s.update('b', { ...hl('b', 0, '2R'), opacity: 0.1 })
    expect(s.changedSince().map((x) => x.id)).toEqual(['b'])
  })

  it('re-adding a removed saved annotation (undo of delete) removes it from deletedSourceRefs', () => {
    const s = new AnnotationStore()
    const a = hl('a', 0, '3R')
    s.load([a])
    s.remove('a')
    expect(s.deletedSourceRefs()).toEqual(['3R'])
    s.add(a)
    expect(s.deletedSourceRefs()).toEqual([])
  })

  it('a removed annotation is no longer in changedSince', () => {
    const s = new AnnotationStore()
    s.add(hl('a'))
    s.remove('a')
    expect(s.changedSince()).toEqual([])
  })

  it('owns sourceRef: add and update take the stored ref, not the incoming one', () => {
    const s = new AnnotationStore()
    s.add(hl('a'))
    s.markSaved({ a: '20R' }, [])
    s.update('a', { ...hl('a'), opacity: 0.9 })
    expect(s.get('a')?.sourceRef).toBe('20R')
    s.remove('a')
    s.add(hl('a', 0, '99R'))
    expect(s.get('a')?.sourceRef).toBe('20R')
    s.add(hl('b', 0, '5R'))
    expect(s.get('b')?.sourceRef).toBeNull()
  })

  it('markSaved drops the ref of deleted objects, also for a present annotation', () => {
    const s = new AnnotationStore()
    s.load([hl('a', 0, '10R'), hl('b', 0, '11R')])
    s.remove('a')
    s.markSaved({}, ['10R', '11R'])
    expect(s.get('b')?.sourceRef).toBeNull()
    expect(s.deletedSourceRefs()).toEqual([])
    s.add(hl('a', 0, '10R'))
    expect(s.get('a')?.sourceRef).toBeNull()
  })

  it('deletedRefs pairs each deleted sourceRef with its annotation id', () => {
    const s = new AnnotationStore()
    s.load([hl('a', 0, '7R'), hl('b', 0, '8R'), hl('c', 0)])
    s.remove('a')
    s.remove('c')
    expect(s.deletedRefs()).toEqual([{ id: 'a', sourceRef: '7R' }])
  })

  it('refs of annotations removed after a save stay in deletedSourceRefs', () => {
    const s = new AnnotationStore()
    s.add(hl('a'))
    s.remove('a')
    s.markSaved({ a: '20R' }, [])
    expect(s.deletedSourceRefs()).toEqual(['20R'])
  })
})

describe('AnnotationStore z-order', () => {
  const ids = (list: Annotation[]) => list.map((a) => a.id)

  it('reorder sets the page order and records it in pageOrders, without counting as an edit', () => {
    const s = new AnnotationStore()
    s.load([hl('a', 0, '5R'), hl('b', 0, '6R'), hl('c', 1, '7R')])
    s.reorder(0, ['b', 'a'])
    expect(ids(s.byPage(0))).toEqual(['b', 'a'])
    expect(ids(s.all())).toEqual(['b', 'a', 'c'])
    expect(s.changedSince()).toEqual([])
    expect(s.pageOrders()).toEqual([
      { page: 0, annotations: [{ id: 'b', sourceRef: '6R' }, { id: 'a', sourceRef: '5R' }] },
    ])
  })

  it('reorder to the current order records nothing; a wrong id list throws', () => {
    const s = new AnnotationStore()
    s.load([hl('a'), hl('b'), hl('c', 1)])
    s.reorder(0, ['a', 'b'])
    expect(s.pageOrders()).toEqual([])
    expect(() => s.reorder(0, ['a'])).toThrow()
    expect(() => s.reorder(0, ['a', 'a'])).toThrow()
    expect(() => s.reorder(0, ['a', 'c'])).toThrow()
  })

  it('an insert below the top counts as a reorder (the writer would append it)', () => {
    const s = new AnnotationStore()
    s.load([hl('a'), hl('b')])
    s.add(hl('c'))
    expect(s.pageOrders()).toEqual([])
    s.add(hl('d'), 0)
    expect(s.pageOrders().map((o) => o.page)).toEqual([0])
  })

  it('markSaved clears the written orders but keeps pages reordered again meanwhile', () => {
    const s = new AnnotationStore()
    s.load([hl('a'), hl('b'), hl('p', 1), hl('q', 1)])
    s.reorder(0, ['b', 'a'])
    s.reorder(1, ['q', 'p'])
    const written = s.pageOrders()
    s.reorder(1, ['p', 'q'])
    s.markSaved({}, [], written)
    expect(s.pageOrders().map((o) => o.page)).toEqual([1])
    s.markSaved({}, [], s.pageOrders())
    expect(s.pageOrders()).toEqual([])
  })

  it('page operations move recorded orders with their page; load forgets them', () => {
    const s = new AnnotationStore()
    s.load([hl('a'), hl('b')])
    s.reorder(0, ['b', 'a'])
    s.remapPages((p) => p + 2)
    expect(s.pageOrders().map((o) => o.page)).toEqual([2])
    s.load([hl('a')])
    expect(s.pageOrders()).toEqual([])
  })
})

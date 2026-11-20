import { describe, expect, it } from 'vitest'
import { compositeCommand, mergeAnnotations, reorderAnnotations, restack, restackedPages } from '../../../src/core/session/commands'
import type { Annotation, InkAnnotation } from '../../../src/core/session/model'
import { AnnotationStore } from '../../../src/core/session/store.svelte'

const ink = (id: string, page = 0): InkAnnotation => ({
  id, page, sourceRef: null, modifiedAt: '', author: '', kind: 'ink',
  strokes: [[[0, 0], [1, 1]]], color: [1, 0, 0], width: 2, opacity: 1, blend: 'normal', role: 'pen',
})

const ids = (list: Annotation[]) => list.map((a) => a.id)

describe('mergeAnnotations', () => {
  it('updates the survivor and removes the absorbed ones; undo restores them in order', () => {
    const store = new AnnotationStore()
    store.load([{ ...ink('a'), sourceRef: '5 0 R' }, ink('x'), { ...ink('b'), sourceRef: '7 0 R' }, ink('c')])
    const before = store.get('a')!
    const after = { ...ink('a'), strokes: [[[0, 0], [9, 9]]] } as InkAnnotation
    const cmd = mergeAnnotations(before, after, [store.get('b')!, store.get('c')!])
    cmd.do(store)
    expect(ids(store.byPage(0))).toEqual(['a', 'x'])
    expect(store.get('a')).toMatchObject({ strokes: [[[0, 0], [9, 9]]], sourceRef: '5 0 R' })
    expect(store.deletedSourceRefs()).toEqual(['7 0 R'])
    cmd.undo(store)
    expect(ids(store.byPage(0))).toEqual(['a', 'x', 'b', 'c'])
    expect(store.get('a')).toEqual(before)
    cmd.do(store)
    expect(ids(store.byPage(0))).toEqual(['a', 'x'])
  })
})

describe('compositeCommand', () => {
  it('runs its parts in order and undoes them in reverse', () => {
    const store = new AnnotationStore()
    const log: string[] = []
    const part = (n: string) => ({ label: n, do: () => void log.push(`do ${n}`), undo: () => void log.push(`undo ${n}`) })
    const cmd = compositeCommand('Both', [part('1'), part('2')])
    expect(cmd.label).toBe('Both')
    cmd.do(store)
    cmd.undo(store)
    expect(log).toEqual(['do 1', 'do 2', 'undo 2', 'undo 1'])
  })
})

describe('restack', () => {
  const moved = (...ids: string[]) => new Set(ids)
  const order = ['a', 'b', 'c', 'd', 'e']

  it('brings to front / sends to back, keeping each group in order', () => {
    expect(restack(order, moved('b', 'd'), 'front')).toEqual(['a', 'c', 'e', 'b', 'd'])
    expect(restack(order, moved('b', 'd'), 'back')).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('steps one place up or down; a block moves as a whole', () => {
    expect(restack(order, moved('b'), 'forward')).toEqual(['a', 'c', 'b', 'd', 'e'])
    expect(restack(order, moved('b', 'c'), 'forward')).toEqual(['a', 'd', 'b', 'c', 'e'])
    expect(restack(order, moved('b', 'd'), 'forward')).toEqual(['a', 'c', 'b', 'e', 'd'])
    expect(restack(order, moved('d'), 'backward')).toEqual(['a', 'b', 'd', 'c', 'e'])
    expect(restack(order, moved('c', 'd'), 'backward')).toEqual(['a', 'c', 'd', 'b', 'e'])
  })

  it('leaves what is already at the top (bottom) in place', () => {
    expect(restack(order, moved('d', 'e'), 'forward')).toEqual(order)
    expect(restack(order, moved('e'), 'front')).toEqual(order)
    expect(restack(order, moved('a', 'b'), 'backward')).toEqual(order)
  })
})

describe('reorderAnnotations', () => {
  it('restacks on every page of the selection as one undo step, labelled by the change', () => {
    const store = new AnnotationStore()
    store.load([ink('a'), ink('b'), ink('c'), ink('p', 1), ink('q', 1)])
    const cmd = reorderAnnotations([store.get('a')!, store.get('p')!], 'front')
    expect(cmd.label).toBe('Bring to front')
    cmd.do(store)
    expect(ids(store.byPage(0))).toEqual(['b', 'c', 'a'])
    expect(ids(store.byPage(1))).toEqual(['q', 'p'])
    cmd.undo(store)
    expect(ids(store.byPage(0))).toEqual(['a', 'b', 'c'])
    expect(ids(store.byPage(1))).toEqual(['p', 'q'])
  })

  it('restackedPages lists only pages whose order would change', () => {
    const store = new AnnotationStore()
    store.load([ink('a'), ink('b'), ink('p', 1), ink('q', 1)])
    expect(restackedPages(store, [store.get('b')!, store.get('p')!], 'front')).toEqual([
      { page: 1, before: ['p', 'q'], after: ['q', 'p'] },
    ])
    expect(restackedPages(store, [store.get('b')!], 'forward')).toEqual([])
  })
})

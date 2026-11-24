import { describe, expect, it } from 'vitest'
import {
  explanationSlots, hasAnyExplanation, setExplanations, type ExplanationHost, type PageExplanations,
} from '../../../src/core/session/explanations'
import { History } from '../../../src/core/session/history.svelte'
import type { Explanation } from '../../../src/core/session/model'
import {
  deletePage, deletePages, duplicatePage, duplicatePages, insertBlankPage, rotatePage, type PageHost,
} from '../../../src/core/session/pageCommands'
import { identityPages } from '../../../src/core/session/pages'
import { AnnotationStore } from '../../../src/core/session/store.svelte'

const ex = (text: string): Explanation => ({ text, model: 'm', createdAt: 't' })
const texts = (list: PageExplanations) => list.map((e) => e?.text ?? null)

function setup(slots: (string | null)[]) {
  const host: PageHost & ExplanationHost = {
    pages: identityPages(slots.length),
    explanations: slots.map((t) => (t === null ? null : ex(t))),
  }
  const history = new History(new AnnotationStore())
  return { host, history }
}

describe('explanation slots', () => {
  it('has one slot per page, empty where the file has none', () => {
    expect(explanationSlots([ex('a')], 3)).toEqual([ex('a'), null, null])
    expect(explanationSlots([ex('a'), null, ex('c')], 2)).toEqual([ex('a'), null])
    expect(hasAnyExplanation([null, null])).toBe(false)
    expect(hasAnyExplanation([null, ex('x')])).toBe(true)
  })
})

describe('setExplanations', () => {
  it('sets slots as one undo step and marks the history dirty', () => {
    const { host, history } = setup([null, 'b'])
    history.execute(setExplanations(host, new Map([[0, ex('a')], [1, null]])))
    expect(texts(host.explanations)).toEqual(['a', null])
    expect(history.isDirty).toBe(true)
    history.undo()
    expect(texts(host.explanations)).toEqual([null, 'b'])
    expect(history.isDirty).toBe(false)
    history.redo()
    expect(texts(host.explanations)).toEqual(['a', null])
  })

  it('extend adds to an executed step: undo removes the whole streamed run', () => {
    const { host, history } = setup([null, null, null])
    const cmd = setExplanations(host, new Map([[0, ex('one')]]), 'Generate explanations')
    history.execute(cmd)
    cmd.extend(1, ex('two'))
    cmd.extend(2, ex('three'))
    expect(texts(host.explanations)).toEqual(['one', 'two', 'three'])
    history.undo()
    expect(texts(host.explanations)).toEqual([null, null, null])
    history.redo()
    expect(texts(host.explanations)).toEqual(['one', 'two', 'three'])
  })

  it('replaces the list on every change (cheap change detection)', () => {
    const { host, history } = setup(['a'])
    const before = host.explanations
    history.execute(setExplanations(host, new Map([[0, ex('b')]])))
    expect(host.explanations).not.toBe(before)
    expect(texts(before)).toEqual(['a'])
  })
})

describe('explanations follow page operations', () => {
  it('duplicate copies the explanation to the copy; undo restores the slots', () => {
    const { host, history } = setup(['a', 'b'])
    history.execute(duplicatePage(host, 0))
    expect(texts(host.explanations!)).toEqual(['a', 'a', 'b'])
    history.undo()
    expect(texts(host.explanations!)).toEqual(['a', 'b'])
  })

  it('delete removes the page explanation and keeps the others on their pages', () => {
    const { host, history } = setup(['a', 'b', 'c'])
    history.execute(deletePage(host, 1)!)
    expect(texts(host.explanations!)).toEqual(['a', 'c'])
    history.undo()
    expect(texts(host.explanations!)).toEqual(['a', 'b', 'c'])
  })

  it('a new empty page has none', () => {
    const { host, history } = setup(['a', 'b'])
    history.execute(insertBlankPage(host, 0, { width: 100, height: 100, rotate: 0 }))
    expect(texts(host.explanations!)).toEqual(['a', null, 'b'])
  })

  it('rotation keeps the explanation', () => {
    const { host, history } = setup(['a'])
    const before = host.explanations
    history.execute(rotatePage(host, 0, 90, 0))
    expect(host.explanations).toBe(before)
  })

  it('several pages at once (Document Builder)', () => {
    const { host, history } = setup(['a', 'b', 'c', 'd'])
    history.execute(duplicatePages(host, [0, 2])!)
    expect(texts(host.explanations!)).toEqual(['a', 'b', 'c', 'a', 'c', 'd'])
    history.execute(deletePages(host, [1, 5])!)
    expect(texts(host.explanations!)).toEqual(['a', 'c', 'a', 'c'])
    history.undo()
    history.undo()
    expect(texts(host.explanations!)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('an explanation edited after a page operation stays put when that operation is undone and redone', () => {
    const { host, history } = setup(['a', 'b'])
    history.execute(duplicatePage(host, 0))
    history.execute(setExplanations(host, new Map([[2, ex('B edited')]])))
    history.undo()
    history.undo()
    history.redo()
    history.redo()
    expect(texts(host.explanations!)).toEqual(['a', 'a', 'B edited'])
  })

  it('hosts without explanation slots still work', () => {
    const host: PageHost = { pages: identityPages(2) }
    const history = new History(new AnnotationStore())
    history.execute(duplicatePage(host, 0))
    expect(host.pages).toHaveLength(3)
    expect(host.explanations).toBeUndefined()
  })
})

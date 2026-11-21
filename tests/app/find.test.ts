// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FindState, registerFindCommands } from '../../src/app/find.svelte'
import { CommandRegistry } from '../../src/core/registry/commands'
import { KeybindingRegistry } from '../../src/core/registry/keybindings'
import type { DocumentSession } from '../../src/core/session/session.svelte'
import { computeLayout } from '../../src/core/viewer/layout'
import type { PageEntry } from '../../src/core/session/pages'

const SIZE = { width: 600, height: 800 }

/** A fake document whose page `i` (1-based) has the given lines of text. */
function fakeDoc(pages: string[][]) {
  const getTextContent = vi.fn()
  const doc = {
    numPages: pages.length,
    destroyed: false,
    getPage: async (i: number) => ({
      rotate: 0,
      getTextContent: () => {
        getTextContent(i)
        return Promise.resolve({
          items: pages[i - 1].map((str, k) => ({
            str,
            transform: [10, 0, 0, 10, 50, 700 - 20 * k],
            width: str.length * 6,
            height: 10,
            fontName: 'F',
            hasEOL: true,
          })),
          styles: {},
        })
      },
      // Unrotated, y up: viewport y = (800 - y) * scale.
      getViewport: ({ scale }: { scale: number }) => ({
        convertToViewportPoint: (x: number, y: number) => [x * scale, (SIZE.height - y) * scale],
      }),
    }),
  }
  return { doc, getTextContent }
}

function fakeSession(texts: string[][], over: Record<string, unknown> = {}) {
  const { doc, getTextContent } = fakeDoc(texts)
  const pages: PageEntry[] = texts.map((_, source) => ({ kind: 'source', source, rotate: 0 }))
  const s = {
    doc,
    pages,
    currentPage: 1,
    scale: 1,
    scrollTop: 0,
    scrollLeft: 0,
    viewportW: 800,
    viewportH: 600,
    layout: computeLayout(pages.map(() => SIZE), 1),
    setScroll: vi.fn((top: number, left: number) => {
      s.scrollTop = top
      s.scrollLeft = left
    }),
    ...over,
  }
  return { session: s as unknown as DocumentSession, raw: s, getTextContent }
}

const stops: (() => void)[] = []
afterEach(() => stops.splice(0).forEach((d) => d()))

function start(session: DocumentSession | null) {
  const find = new FindState(() => session, 0)
  stops.push(find.start())
  return find
}

describe('FindState', () => {
  it('does not index anything until a search runs', async () => {
    const { session, getTextContent } = fakeSession([['hello']])
    const find = start(session)
    find.show()
    await new Promise((r) => setTimeout(r, 10))
    expect(getTextContent).not.toHaveBeenCalled()
    expect(find.open).toBe(true)
    expect(find.focusRequests).toBe(1)
  })

  it('finds hits case-insensitively on every page, in page order', async () => {
    const { session } = fakeSession([['Alpha beta'], ['no match'], ['BETA', 'alpha Beta']])
    const find = start(session)
    find.show()
    find.query = 'beta'
    await vi.waitFor(() => expect(find.hits).toHaveLength(3))
    expect(find.hits.map((h) => h.page)).toEqual([0, 2, 2])
    expect(find.index).toBe(0)
    expect(find.viewFor(session)?.byPage.get(2)).toHaveLength(2)
  })

  it('matches across line breaks', async () => {
    const { session } = fakeSession([['the quick', 'brown fox']])
    const find = start(session)
    find.show()
    find.query = 'Quick Brown'
    await vi.waitFor(() => expect(find.hits).toHaveLength(1))
    expect(find.hits[0].quads).toHaveLength(2)
  })

  it('starts at the current page and steps around with next / previous', async () => {
    const { session } = fakeSession([['x'], ['x'], ['x']], { currentPage: 2 })
    const find = start(session)
    find.show()
    find.query = 'x'
    await vi.waitFor(() => expect(find.hits).toHaveLength(3))
    expect(find.current?.page).toBe(1)
    find.next()
    expect(find.current?.page).toBe(2)
    find.next()
    expect(find.current?.page).toBe(0)
    find.previous()
    expect(find.current?.page).toBe(2)
  })

  it('scrolls a hit out of view into view', async () => {
    const { session, raw } = fakeSession([['x'], ['x'], ['x'], ['far']])
    const find = start(session)
    find.show()
    find.query = 'far'
    await vi.waitFor(() => expect(raw.setScroll).toHaveBeenCalled())
    // Page 4 starts at 16 + 3 * 816; the hit is 92..102 below its top.
    const hitTop = 16 + 3 * 816 + 92
    expect(raw.scrollTop).toBeCloseTo(hitTop - 600 / 3)
  })

  it('skips empty pages and searches again after a page edit', async () => {
    const { session, raw } = fakeSession([['one'], ['two']])
    const find = start(session)
    find.show()
    find.query = 'two'
    await vi.waitFor(() => expect(find.hits).toHaveLength(1))
    expect(find.hits[0].page).toBe(1)
    // The page list is not reactive in this fake: a new query re-runs the search.
    raw.pages = [{ kind: 'blank', width: 600, height: 800, rotate: 0 }, ...raw.pages]
    find.query = 'two '
    await vi.waitFor(() => expect(find.hits[0]?.page).toBe(2))
  })

  it('reports no hits, and clears everything on close', async () => {
    const { session } = fakeSession([['abc']])
    const find = start(session)
    find.show()
    find.query = 'zzz'
    await new Promise((r) => setTimeout(r, 20))
    expect(find.searching).toBe(false)
    expect(find.hits).toEqual([])
    expect(find.viewFor(session)).toBeNull()
    find.query = 'abc'
    await vi.waitFor(() => expect(find.hits).toHaveLength(1))
    find.close()
    expect(find.open).toBe(false)
    expect(find.query).toBe('')
    await vi.waitFor(() => expect(find.hits).toEqual([]))
  })

  it('does not show one tab’s hits in another', async () => {
    const { session } = fakeSession([['abc']])
    const other = fakeSession([['abc']]).session
    const find = start(session)
    find.show()
    find.query = 'abc'
    await vi.waitFor(() => expect(find.hits).toHaveLength(1))
    expect(find.viewFor(session)).not.toBeNull()
    expect(find.viewFor(other)).toBeNull()
  })
})

describe('view.find', () => {
  it('Ctrl+F shows the search field when a document is open', async () => {
    const cmds = new CommandRegistry()
    const kb = new KeybindingRegistry(cmds)
    const find = new FindState(() => null)
    let open = false
    const dispose = registerFindCommands(find, () => open, cmds, kb)
    const ctrlF = () => new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })
    expect(kb.handle(ctrlF())).toBe(false)
    open = true
    expect(kb.handle(ctrlF())).toBe(true)
    await vi.waitFor(() => expect(find.open).toBe(true))
    dispose()
    expect(kb.handle(ctrlF())).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { followLink, shownPageOf, type LinkEffects, type LinkSession } from '../../../src/core/viewer/followLink'
import type { PageLink } from '../../../src/core/viewer/links'
import type { PageEntry } from '../../../src/core/session/pages'

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(), message: vi.fn() }))

const src = (source: number, rotate = 0): PageEntry => ({ kind: 'source', source, rotate })

/** Pages 200 x 100 pt; destinations: "top" = XYZ on file page 1 at y 80, "gone" = file page 3. */
function setup(pages: PageEntry[] = [src(0), src(1), src(2)]) {
  const goToPage = vi.fn()
  const doc = {
    destroyed: false,
    getDestination: vi.fn(async (id: string) =>
      id === 'top' ? [{ num: 1, gen: 0 }, { name: 'XYZ' }, 0, 80, 0] : id === 'gone' ? [3, { name: 'Fit' }] : null,
    ),
    getPageIndex: vi.fn(async () => 1),
    getPage: vi.fn(async () => ({
      rotate: 0,
      getViewport: ({ scale }: { scale: number }) => ({
        viewBox: [0, 0, 200, 100],
        width: 200 * scale,
        height: 100 * scale,
        convertToViewportPoint: (x: number, y: number) => [x * scale, (100 - y) * scale],
      }),
    })),
  }
  const session = { doc, pages, scale: 2, goToPage } as unknown as LinkSession
  const effects: LinkEffects = { confirmUrl: vi.fn(async () => true), openUrl: vi.fn(async () => {}), report: vi.fn() }
  return { session, goToPage, effects }
}

const link = (target: PageLink['target']): PageLink => ({ rect: [0, 0, 1, 1], target })

describe('followLink', () => {
  it('opens a web link only once confirmed', async () => {
    const t = setup()
    await followLink(t.session, link({ kind: 'url', url: 'https://example.com/' }), 0, t.effects)
    expect(t.effects.confirmUrl).toHaveBeenCalledWith('https://example.com/')
    expect(t.effects.openUrl).toHaveBeenCalledWith('https://example.com/')
    vi.mocked(t.effects.openUrl).mockClear()
    vi.mocked(t.effects.confirmUrl).mockResolvedValueOnce(false)
    await followLink(t.session, link({ kind: 'url', url: 'https://example.com/' }), 0, t.effects)
    expect(t.effects.openUrl).not.toHaveBeenCalled()
  })

  it('reports a link the system could not open', async () => {
    const t = setup()
    vi.mocked(t.effects.openUrl).mockRejectedValueOnce(new Error('no'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await followLink(t.session, link({ kind: 'url', url: 'https://example.com/' }), 0, t.effects)
    expect(t.effects.report).toHaveBeenCalled()
  })

  it('scrolls to the destination point on its shown page', async () => {
    const t = setup([src(2), src(1), src(0)])
    await followLink(t.session, link({ kind: 'dest', dest: 'top' }), 0, t.effects)
    // File page 1 is shown second; y 80 is 20 pt below the top edge, at scale 2.
    expect(t.goToPage).toHaveBeenCalledWith(2, 40)
  })

  it('goes to the page top for a destination without a point, and nowhere for a deleted page', async () => {
    const t = setup([src(0), src(1), src(2), src(3)])
    await followLink(t.session, link({ kind: 'dest', dest: 'gone' }), 0, t.effects)
    expect(t.goToPage).toHaveBeenCalledWith(4)
    const u = setup([src(0), src(1)])
    await followLink(u.session, link({ kind: 'dest', dest: 'gone' }), 0, u.effects)
    await followLink(u.session, link({ kind: 'dest', dest: 'unknown' }), 0, u.effects)
    expect(u.goToPage).not.toHaveBeenCalled()
  })

  it('turns pages for named actions, relative to the link page', async () => {
    const t = setup()
    await followLink(t.session, link({ kind: 'named', action: 'NextPage' }), 1, t.effects)
    await followLink(t.session, link({ kind: 'named', action: 'PrevPage' }), 1, t.effects)
    await followLink(t.session, link({ kind: 'named', action: 'LastPage' }), 0, t.effects)
    await followLink(t.session, link({ kind: 'named', action: 'FirstPage' }), 2, t.effects)
    // No page after the last.
    await followLink(t.session, link({ kind: 'named', action: 'NextPage' }), 2, t.effects)
    expect(t.goToPage.mock.calls).toEqual([[3], [1], [3], [1]])
  })
})

describe('shownPageOf', () => {
  it('finds the first copy of a file page', () => {
    expect(shownPageOf([src(1), { kind: 'blank', width: 1, height: 1, rotate: 0 }, src(0), src(0)], 0)).toBe(2)
    expect(shownPageOf([src(1)], 0)).toBe(-1)
  })
})

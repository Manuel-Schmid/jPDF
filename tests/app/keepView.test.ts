import { describe, expect, it, vi } from 'vitest'
import { rememberView, restoreView } from '../../src/app/keepView'
import type { DocumentSession } from '../../src/core/session/session.svelte'
import type { ReopenAt } from '../../src/core/settings/preferences'
import { findView, withView, type DocumentView, type RememberedView } from '../../src/core/settings/viewMemory'

function store(reopenAt: ReopenAt = 'last', views: RememberedView[] = []) {
  const data = { preferences: { theme: 'dark', toolbarPosition: 'right', reopenAt }, views }
  return {
    data,
    rememberView: vi.fn((v: RememberedView) => (data.views = withView(data.views, v))),
    viewFor: (path: string) => findView(data.views, path),
  } as never as Parameters<typeof rememberView>[0] & { data: typeof data; rememberView: ReturnType<typeof vi.fn> }
}

function session(path: string, view: DocumentView | null = null) {
  return { path, initialView: null, currentView: () => view } as unknown as DocumentSession
}

const shown: DocumentView = { page: 4, offset: 0.5, scale: 1.75 }

describe('rememberView / restoreView', () => {
  it('records the view of a closing document under its path', () => {
    const st = store()
    rememberView(st, session('C:\\a.pdf', shown))
    expect(st.data.views).toEqual([{ path: 'C:\\a.pdf', ...shown }])
  })

  it('records nothing for a tab never shown, or when files reopen at the first page', () => {
    const st = store()
    rememberView(st, session('C:\\a.pdf', null))
    const off = store('start')
    rememberView(off, session('C:\\a.pdf', shown))
    expect(st.rememberView).not.toHaveBeenCalled()
    expect(off.rememberView).not.toHaveBeenCalled()
  })

  it('hands a remembered view to the reopened document (paths compare case-insensitively)', () => {
    const s = session('c:\\A.PDF')
    restoreView(store('last', [{ path: 'C:\\a.pdf', ...shown }]), s)
    expect(s.initialView).toEqual(shown)
  })

  it('leaves a document without a remembered view, or with reopening at the first page, at its default', () => {
    const unknown = session('C:\\b.pdf')
    restoreView(store('last', [{ path: 'C:\\a.pdf', ...shown }]), unknown)
    const off = session('C:\\a.pdf')
    restoreView(store('start', [{ path: 'C:\\a.pdf', ...shown }]), off)
    expect(unknown.initialView).toBeNull()
    expect(off.initialView).toBeNull()
  })
})

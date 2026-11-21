import { describe, expect, it, vi } from 'vitest'
import { TabsStore } from '../../src/app/tabs.svelte'
import type { DocumentSession } from '../../src/core/session/session.svelte'

let n = 0
function fake(path: string): DocumentSession {
  return { id: `s${++n}`, path, dispose: vi.fn(async () => {}) } as unknown as DocumentSession
}

describe('TabsStore', () => {
  it('add activates new session', () => {
    const t = new TabsStore()
    const a = fake('C:\\a.pdf')
    const b = fake('C:\\b.pdf')
    t.add(a)
    expect(t.activeId).toBe(a.id)
    t.add(b)
    expect(t.activeId).toBe(b.id)
    expect(t.active?.id).toBe(b.id)
    expect(t.sessions).toHaveLength(2)
  })

  it('add same path twice activates existing, keeps one tab', () => {
    const t = new TabsStore()
    const a = fake('C:\\a.pdf')
    const b = fake('C:\\b.pdf')
    const dup = fake('c:\\A.PDF')
    t.add(a)
    t.add(b)
    t.add(dup)
    expect(t.sessions).toHaveLength(2)
    expect(t.activeId).toBe(a.id)
  })

  it('add disposes a rejected duplicate session', () => {
    const t = new TabsStore()
    const a = fake('C:\\a.pdf')
    const dup = fake('c:\\A.PDF')
    t.add(a)
    t.add(dup)
    expect(dup.dispose).toHaveBeenCalledOnce()
    expect(a.dispose).not.toHaveBeenCalled()
  })

  it('findByPath matches case-insensitively', () => {
    const t = new TabsStore()
    const a = fake('C:\\docs\\a.pdf')
    t.add(a)
    expect(t.findByPath('c:\\DOCS\\A.PDF')?.id).toBe(a.id)
    expect(t.findByPath('C:\\other.pdf')).toBeUndefined()
  })

  it('close active activates right neighbour, else left', async () => {
    const t = new TabsStore()
    const [a, b, c] = [fake('a'), fake('b'), fake('c')]
    t.add(a)
    t.add(b)
    t.add(c)
    t.activeId = b.id
    await t.close(b.id)
    expect(t.activeId).toBe(c.id)
    await t.close(c.id)
    expect(t.activeId).toBe(a.id)
  })

  it('close inactive keeps the active tab', async () => {
    const t = new TabsStore()
    const [a, b] = [fake('a'), fake('b')]
    t.add(a)
    t.add(b)
    await t.close(a.id)
    expect(t.activeId).toBe(b.id)
  })

  it('close last leaves activeId null and calls dispose', async () => {
    const t = new TabsStore()
    const a = fake('a')
    t.add(a)
    await t.close(a.id)
    expect(t.activeId).toBeNull()
    expect(t.active).toBeNull()
    expect(a.dispose).toHaveBeenCalledOnce()
  })

  it('close asks the close guard and keeps the tab when it refuses', async () => {
    const guard = vi.fn(async () => false)
    const t = new TabsStore(guard)
    const a = fake('a')
    t.add(a)
    expect(await t.close(a.id)).toBe(false)
    expect(guard).toHaveBeenCalledWith(t.sessions[0])
    expect(t.sessions).toHaveLength(1)
    expect(t.activeId).toBe(a.id)
    expect(a.dispose).not.toHaveBeenCalled()
    guard.mockResolvedValueOnce(true)
    expect(await t.close(a.id)).toBe(true)
    expect(t.sessions).toHaveLength(0)
  })

  it('close runs onClose for a closing tab before disposing it, never for one that stays', async () => {
    const guard = vi.fn(async () => false)
    const onClose = vi.fn((s: DocumentSession) => expect(s.dispose).not.toHaveBeenCalled())
    const t = new TabsStore(guard, onClose)
    const a = fake('a')
    t.add(a)
    await t.close(a.id)
    expect(onClose).not.toHaveBeenCalled()
    guard.mockResolvedValueOnce(true)
    await t.close(a.id)
    expect(onClose).toHaveBeenCalledExactlyOnceWith(a)
    expect(a.dispose).toHaveBeenCalled()
  })

  it('next/prev wrap around', () => {
    const t = new TabsStore()
    const [a, b, c] = [fake('a'), fake('b'), fake('c')]
    t.add(a)
    t.add(b)
    t.add(c)
    t.next()
    expect(t.activeId).toBe(a.id)
    t.prev()
    expect(t.activeId).toBe(c.id)
    t.prev()
    expect(t.activeId).toBe(b.id)
  })

  it('next/prev do nothing without tabs', () => {
    const t = new TabsStore()
    t.next()
    t.prev()
    expect(t.activeId).toBeNull()
  })
})

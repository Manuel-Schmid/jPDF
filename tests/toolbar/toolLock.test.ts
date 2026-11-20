import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eraserTool } from '../../src/tools/eraser'
import { lassoTool } from '../../src/tools/lasso'
import { markerTool } from '../../src/tools/marker'
import { penTool } from '../../src/tools/pen'
import { selectTool } from '../../src/tools/select'
import { shapeTool } from '../../src/tools/shape'
import { textTool } from '../../src/tools/text'
import { strikeoutTool, underlineTool } from '../../src/tools/textline'
import { activateSelectTool, afterToolUse, isLockable, isLocked } from '../../src/toolbar/toolLock'
import { fakeSetup, fakeTool } from './fakeTools'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** Toolbar: select, an unlocked pen (p1) and a locked one (p2). */
function setup() {
  const s = fakeSetup([
    { instanceId: 'p1', type: 'pen', settings: {} },
    { instanceId: 's1', type: 'select', settings: {} },
    { instanceId: 'p2', type: 'pen', settings: {}, locked: true },
  ])
  s.registry.register(fakeTool('select', { allowMultipleInstances: false }))
  const pen = s.registry.get('pen')
  pen.defaultLocked = false
  const active = () => {
    const instance = s.store.data.toolbar.find((i) => i.instanceId === s.store.data.activeInstanceId)!
    return { def: s.registry.get(instance.type), instance }
  }
  return { ...s, pen, active }
}

describe('tool lock', () => {
  it('drawing tools are locked by default, text boxes unlocked; select and lasso have no lock', () => {
    for (const t of [penTool, markerTool, shapeTool, eraserTool, underlineTool, strikeoutTool]) {
      expect(t.defaultLocked, t.type).toBe(true)
    }
    expect(textTool.defaultLocked).toBe(false)
    expect(isLockable(selectTool)).toBe(false)
    expect(isLockable(lassoTool)).toBe(false)
  })

  it('an instance uses its own lock, else the tool default; tools without a lock stay', () => {
    const { pen, store } = setup()
    const [p1, , p2] = store.data.toolbar
    expect(isLocked(pen, p1)).toBe(false)
    expect(isLocked(pen, p2)).toBe(true)
    expect(isLocked(fakeTool('select'), p1)).toBe(true)
  })

  it('after a use, an unlocked tool hands over to the select tool, a locked one stays', () => {
    const s = setup()
    afterToolUse(s.active(), s.store)
    expect(s.store.data.activeInstanceId).toBe('s1')
    s.store.setActive('p2')
    afterToolUse(s.active(), s.store)
    expect(s.store.data.activeInstanceId).toBe('p2')
  })

  it('activating the select tool keeps an active select instance and does nothing without one', () => {
    const s = setup()
    activateSelectTool(s.store)
    expect(s.store.data.activeInstanceId).toBe('s1')
    // A toolbar without a Select tool (it can no longer be removed; an older file may lack it).
    s.store.data.toolbar = s.store.data.toolbar.filter((i) => i.instanceId !== 's1')
    s.store.setActive('p2')
    activateSelectTool(s.store)
    expect(s.store.data.activeInstanceId).toBe('p2')
  })
})

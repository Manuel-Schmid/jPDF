<script lang="ts">
  import Lock from '@lucide/svelte/icons/lock'
  import LockOpen from '@lucide/svelte/icons/lock-open'
  import Plus from '@lucide/svelte/icons/plus'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import { actionIcons } from '../ui/actionIcons'
  import { toolRegistry, type ToolDefinition, type ToolRegistry } from '../core/registry/tools'
  import { SELECT_TOOL, settings, type SettingsStore } from '../core/settings/settings.svelte'
  import ContextMenu, { type MenuItem } from '../ui/ContextMenu.svelte'
  import Flyout from '../ui/Flyout.svelte'
  import { findTool } from './activeTool.svelte'
  import { DRAG_THRESHOLD, insertionIndex, reorderTarget } from './reorder'
  import { toolbarAxis, towardPage } from './placement'
  import { isLockable, isLocked } from './toolLock'
  import ToolButton from './ToolButton.svelte'
  import ToolPicker from './ToolPicker.svelte'

  let {
    registry = toolRegistry,
    store = settings,
  }: {
    registry?: ToolRegistry
    store?: SettingsStore
  } = $props()

  // Instances of unregistered tool types stay in the settings but are not shown.
  const visible = $derived(
    store.data.toolbar.flatMap((instance) => {
      const def = findTool(registry, instance.type)
      return def ? [{ instance, def }] : []
    }),
  )

  // Vertical at the left/right edge, horizontal at the top/bottom; popups
  // open toward the page area.
  const position = $derived(store.data.preferences.toolbarPosition)
  const vertical = $derived(toolbarAxis(position) === 'vertical')
  const side = $derived(towardPage(position))

  let flyout = $state<{ id: string; anchor: HTMLElement } | null>(null)
  let menu = $state<{ id: string; anchor: HTMLElement; x: number; y: number } | null>(null)
  let pickerOpen = $state(false)

  const flyoutEntry = $derived(flyout && visible.find((v) => v.instance.instanceId === flyout!.id))
  const menuEntry = $derived(menu && visible.find((v) => v.instance.instanceId === menu!.id))

  let list: HTMLDivElement
  let drag = $state<{
    id: string
    pointerId: number
    startX: number
    startY: number
    /** Offset along the toolbar's axis. */
    offset: number
    active: boolean
    slot: number
  } | null>(null)
  /** Drop indicator position along the axis, relative to the list's content. */
  let indicatorAt = $state<number | null>(null)
  /** Set when a drag ends, so the click that follows pointerup is ignored. */
  let suppressClick = false

  function buttons(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>('[data-instance]')]
  }

  function onClick(id: string, e: MouseEvent) {
    if (suppressClick) {
      suppressClick = false
      return
    }
    if (store.data.activeInstanceId === id) {
      flyout = flyout?.id === id ? null : { id, anchor: e.currentTarget as HTMLElement }
    } else {
      store.setActive(id)
      flyout = null
    }
  }

  function onContextMenu(id: string, e: MouseEvent) {
    e.preventDefault()
    flyout = null
    menu = { id, anchor: e.currentTarget as HTMLElement, x: e.clientX, y: e.clientY }
  }

  function menuItems(id: string, def: ToolDefinition, anchor: HTMLElement): MenuItem[] {
    const items: MenuItem[] = [{ label: 'Options', icon: SlidersHorizontal, run: () => (flyout = { id, anchor }) }]
    if (def.allowMultipleInstances) items.push({ label: 'Duplicate', icon: actionIcons.duplicate, run: () => store.duplicate(id) })
    // Escape and unlocked tools hand over to Select, so it stays in the toolbar.
    if (def.type === SELECT_TOOL) return items
    items.push({
      label: 'Remove',
      icon: actionIcons.delete,
      danger: true,
      run: () => {
        if (flyout?.id === id) flyout = null
        store.remove(id)
      },
    })
    return items
  }

  function onPointerDown(id: string, e: PointerEvent) {
    suppressClick = false
    if (e.button !== 0) return
    drag = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, offset: 0, active: false, slot: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.active) {
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return
      drag.active = true
      flyout = null
      menu = null
    }
    // Everything below runs along the toolbar's axis: y for a vertical strip, x for a horizontal one.
    const offset = vertical ? dy : dx
    const start = (r: DOMRect) => (vertical ? r.top : r.left)
    const end = (r: DOMRect) => (vertical ? r.bottom : r.right)
    drag.offset = offset
    const els = buttons()
    const rects = els.map((b) => b.getBoundingClientRect())
    const from = els.findIndex((b) => b.dataset.instance === drag!.id)
    // Centres as laid out (the dragged button's transform must not count).
    const centres = rects.map((r, i) => (start(r) + end(r)) / 2 - (i === from ? offset : 0))
    drag.slot = insertionIndex(centres, from, vertical ? e.clientY : e.clientX)
    const others = rects.filter((_, i) => i !== from)
    const listRect = list.getBoundingClientRect()
    const listStart = vertical ? listRect.top - list.scrollTop : listRect.left - list.scrollLeft
    const at = drag.slot < others.length ? start(others[drag.slot]) - 4 : (others.length ? end(others.at(-1)!) : 0) + 4
    indicatorAt = at - listStart
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    const d = drag
    drag = null
    indicatorAt = null
    if (!d.active) return
    suppressClick = true
    const to = reorderTarget(
      store.data.toolbar.map((i) => i.instanceId),
      visible.map((v) => v.instance.instanceId),
      d.id,
      d.slot,
    )
    if (to !== null) store.move(d.id, to)
  }

  /** A cancelled press or drag (system gesture, lost pointer) aborts without reordering. */
  function onPointerCancel(e: PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    drag = null
    indicatorAt = null
  }

  /** A horizontal strip scrolls sideways with the mouse wheel (it has no vertical overflow). */
  function onWheel(e: WheelEvent) {
    if (vertical || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    list.scrollLeft += e.deltaY
    e.preventDefault()
  }
  // Non-passive, so the wheel does not also scroll anything behind the strip.
  $effect(() => {
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => list.removeEventListener('wheel', onWheel)
  })

  function pick(type: string) {
    const inst = store.addInstance(type)
    store.setActive(inst.instanceId)
    pickerOpen = false
  }
</script>

<div
  class="toolbar"
  class:horizontal={!vertical}
  role="toolbar"
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
  aria-label="Tools"
  data-position={position}
>
  <div class="list" bind:this={list}>
    {#each visible as { instance, def } (instance.instanceId)}
      <ToolButton
        {def}
        {instance}
        active={store.data.activeInstanceId === instance.instanceId}
        dragOffset={drag?.active && drag.id === instance.instanceId ? drag.offset : null}
        {side}
        onclick={(e) => onClick(instance.instanceId, e)}
        oncontextmenu={(e) => onContextMenu(instance.instanceId, e)}
        onpointerdown={(e) => onPointerDown(instance.instanceId, e)}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerCancel}
      />
    {/each}
    {#if indicatorAt !== null}
      <div class="drop-indicator" style:top={vertical ? `${indicatorAt}px` : undefined} style:left={vertical ? undefined : `${indicatorAt}px`}></div>
    {/if}
  </div>
  <div class="divider"></div>
  <button type="button" class="add" aria-label="Add tool" title="Add tool" onclick={() => (pickerOpen = true)}>
    <Plus size={20} />
  </button>
</div>

{#if flyout && flyoutEntry}
  {@const { def, instance } = flyoutEntry}
  {@const locked = isLocked(def, instance)}
  <Flyout anchor={flyout.anchor} {side} label="{def.displayName} options" title={def.displayName} onclose={() => (flyout = null)}>
    {#snippet actions()}
      {#if isLockable(def)}
        <button
          type="button"
          class="lock"
          class:locked
          aria-label="Lock tool"
          aria-pressed={locked}
          title={locked
            ? 'Locked: the tool stays active after each use. Click to unlock.'
            : 'Unlocked: switches back to Select after each use. Click to lock.'}
          onclick={() => store.setLocked(instance.instanceId, !locked)}
        >
          {#if locked}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
        </button>
      {/if}
    {/snippet}
    {#if def.Options}
      <def.Options
        settings={instance.settings}
        update={(patch: object) => store.updateSettings(instance.instanceId, patch)}
      />
    {:else}
      <p class="empty">No options</p>
    {/if}
  </Flyout>
{/if}

{#if menu && menuEntry}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menuItems(menu.id, menuEntry.def, menu.anchor)}
    onclose={() => (menu = null)}
  />
{/if}

{#if pickerOpen}
  <ToolPicker {registry} {store} onpick={pick} onclose={() => (pickerOpen = false)} />
{/if}

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    background: var(--bg-deep);
  }
  .list {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }
  /* Vertically centred while it fits; scrolls from the top when it doesn't. */
  .list::before,
  .list::after {
    content: '';
    margin: auto;
  }
  .drop-indicator {
    position: absolute;
    left: 10px;
    right: 10px;
    height: 2px;
    margin-top: -1px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .divider {
    flex: none;
    width: 24px;
    height: 1px;
    background: var(--border);
  }
  .add {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin: 6px 0 8px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .add:hover {
    background: var(--surface-hover);
    color: var(--accent);
  }
  /* Horizontal strip (top/bottom edge): the same parts, laid out in a row. */
  .toolbar.horizontal {
    flex-direction: row;
  }
  .horizontal .list {
    flex-direction: row;
    width: auto;
    min-width: 0;
    height: 100%;
    padding: 0 8px;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .horizontal .drop-indicator {
    left: auto;
    right: auto;
    top: 10px;
    bottom: 10px;
    width: 2px;
    height: auto;
    margin: 0 0 0 -1px;
  }
  .horizontal .divider {
    width: 1px;
    height: 24px;
  }
  .horizontal .add {
    margin: 0 8px 0 6px;
  }
  .lock {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .lock:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  .lock.locked {
    color: var(--accent);
  }
  .empty {
    margin: 0;
    color: var(--text-muted);
  }
</style>

<script lang="ts">
  import { tick } from 'svelte'
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
  import { DRAG_THRESHOLD, SLIDE_MS, followOffset, insertionIndex, reorderTarget, slotOffsets } from './reorder'
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
    active: boolean
    /** Visible index of the dragged button when the drag started. */
    from: number
    /** Insertion slot among the other visible buttons; the dragged button is shown there. */
    slot: number
    /** Leading edges and centres along the axis, measured once when the drag becomes active. */
    starts: number[]
    centres: number[]
    /** Where along the axis the button was grabbed, relative to its centre. */
    grab: number
    /** The dragged button's centre along the axis, following the pointer. */
    at: number
  } | null>(null)
  /**
   * Per-button offsets along the axis while dragging (empty otherwise), as in
   * the Windows taskbar: the dragged button tracks the pointer freely, and the
   * others snap (with a slide) one slot aside to open the gap it will drop into.
   */
  const offsets = $derived.by(() => {
    if (!drag?.active) return []
    const o = slotOffsets(drag.starts, drag.from, drag.slot)
    o[drag.from] = followOffset(drag.centres, drag.from, drag.at)
    return o
  })
  /**
   * Set briefly after a cancelled drag so the buttons slide back. A drop
   * clears the offsets without it (the neighbours already sit where the
   * reordered layout puts them) and only glides the dropped button into its gap.
   */
  let settling = $state(false)
  let settleTimer: ReturnType<typeof setTimeout> | undefined
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
    drag = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, from: 0, slot: 0, starts: [], centres: [], grab: 0, at: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) <= DRAG_THRESHOLD) return
      // Measured once: nothing is offset yet, so these are the laid-out positions.
      // Everything runs along the toolbar's axis: y for a vertical strip, x for a horizontal one.
      const els = buttons()
      const rects = els.map((b) => b.getBoundingClientRect())
      const from = els.findIndex((b) => b.dataset.instance === drag!.id)
      drag.starts = rects.map((r) => (vertical ? r.top : r.left))
      drag.centres = rects.map((r) => (vertical ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2))
      drag.from = from
      drag.slot = from
      drag.grab = (vertical ? drag.startY : drag.startX) - drag.centres[from]
      drag.active = true
      clearTimeout(settleTimer)
      settling = false
      flyout = null
      menu = null
    }
    // The button's centre follows the pointer; a neighbour makes room once the
    // button covers more than half of it (passes that neighbour's centre, as laid out).
    drag.at = (vertical ? e.clientY : e.clientX) - drag.grab
    drag.slot = insertionIndex(drag.centres, drag.from, drag.at)
  }

  /**
   * Glides the dropped button from where the pointer left it into its gap
   * (Web Animations: its transform is already cleared and the layout
   * reordered, so this plays only that last stretch). Skipped with reduced
   * motion or without the API (jsdom).
   */
  async function settleDropped(id: string, from: number) {
    if (!from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    await tick()
    // The toolbar may have unmounted meanwhile (bind:this is then null).
    const el = list && buttons().find((b) => b.dataset.instance === id)
    const axis = vertical ? 'Y' : 'X'
    el?.animate?.([{ transform: `translate${axis}(${from}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'ease-out' })
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    const d = drag
    // Where it is shown, relative to its gap (slot `d.slot` is laid out at centres[d.slot]).
    const held = d.active ? followOffset(d.centres, d.slot, d.at) : 0
    drag = null
    if (!d.active) return
    suppressClick = true
    void settleDropped(d.id, held)
    const to = reorderTarget(
      store.data.toolbar.map((i) => i.instanceId),
      visible.map((v) => v.instance.instanceId),
      d.id,
      d.slot,
    )
    if (to !== null) store.move(d.id, to)
  }

  /** Aborts a press or drag without reordering; an active drag slides back into place. */
  function cancelDrag() {
    if (drag?.active) {
      settling = true
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => (settling = false), SLIDE_MS)
    }
    drag = null
  }

  /** A cancelled press or drag (system gesture, lost pointer). */
  function onPointerCancel(e: PointerEvent) {
    if (!drag || drag.pointerId !== e.pointerId) return
    cancelDrag()
  }

  // Escape during a drag cancels it. Consumed (capture phase on window) so the
  // app's Escape does not also switch tools; with no drag it passes through.
  const dragging = $derived(!!drag?.active)
  $effect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelDrag()
      // The pointerup that ends this press must not count as a click either.
      suppressClick = true
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  $effect(() => () => clearTimeout(settleTimer))

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
    {#each visible as { instance, def }, i (instance.instanceId)}
      <ToolButton
        {def}
        {instance}
        active={store.data.activeInstanceId === instance.instanceId}
        offset={offsets[i] ?? 0}
        dragging={dragging && drag?.id === instance.instanceId}
        animated={settling || (dragging && drag?.id !== instance.instanceId)}
        {side}
        onclick={(e) => onClick(instance.instanceId, e)}
        oncontextmenu={(e) => onContextMenu(instance.instanceId, e)}
        onpointerdown={(e) => onPointerDown(instance.instanceId, e)}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerCancel}
      />
    {/each}
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

<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import Palette from '@lucide/svelte/icons/palette'
  import { actionIcons } from '../../ui/actionIcons'
  import type { PageViewport } from 'pdfjs-dist'
  import { cssColor } from '../../annotations/freetext/screen'
  import StyleCard from '../../tools/select/StyleCard.svelte'
  import { styleTypeOf, swatchColor } from '../../tools/select/styleTypes'
  import { dismissable } from '../../ui/dismissable'
  import { portal } from '../../ui/portal'
  import { BAR_GAP, BAR_H, barAbove, placeCard } from './cardPlacement'
  import { commands as defaultCommands, type CommandRegistry } from '../registry/commands'
  import type { Annotation, FreeTextAnnotation, Rect } from '../session/model'

  let {
    rect,
    vp,
    annotations,
    commands = defaultCommands,
    onstyle,
    onlive = () => {},
    relayout,
    onexplain,
  }: {
    /** The selection's box on the page (viewport px). */
    rect: Rect
    vp: PageViewport
    /** The selected annotations on this page, as stored. */
    annotations: readonly Annotation[]
    commands?: CommandRegistry
    /** Commits a style edit of the selection (one undo step); without it there is no Style button. */
    onstyle?(afters: Annotation[]): void
    /** The selection as styled while a control is dragged; null when that preview is over. */
    onlive?(list: Annotation[] | null): void
    /** Lays out a text box whose font size changes while dragging. */
    relayout?(a: FreeTextAnnotation): FreeTextAnnotation
    /** Explains the page content under the selection with AI (only while AI features are on). */
    onexplain?(): void
  } = $props()

  /** Approximate bar size (px), to keep it on the page. */
  const BAR_W = 260
  /** Room between the Style card and the edges of the viewer. */
  const MARGIN = 8

  // Above the selection; below it when there is no room above.
  const above = $derived(barAbove(rect))
  const top = $derived(above ? rect[1] - BAR_H - BAR_GAP : Math.min(rect[3] + BAR_GAP, vp.height - BAR_H))
  const left = $derived(Math.max(0, Math.min(rect[0], vp.width - BAR_W)))

  const count = $derived(annotations.length)
  const styleType = $derived(styleTypeOf(annotations))
  const swatch = $derived(annotations[0] ? swatchColor(annotations[0]) : null)

  const actions = [
    { id: 'edit.duplicate', label: 'Duplicate (Ctrl+D)', Icon: actionIcons.duplicate, danger: false },
    { id: 'edit.flatten', label: 'Flatten into the page (permanent once saved)', Icon: actionIcons.flatten, danger: false },
    { id: 'edit.delete', label: 'Delete (Del)', Icon: actionIcons.delete, danger: true },
  ]

  function run(e: MouseEvent, id: string) {
    e.stopPropagation()
    void commands.execute(id)
  }

  let bar: HTMLDivElement
  let styleButton = $state<HTMLButtonElement>()
  let card = $state<HTMLDivElement>()
  let open = $state(false)
  let cardPos = $state<{ left: number; top: number; maxHeight: number }>({ left: 0, top: 0, maxHeight: 0 })

  function close() {
    if (!open) return
    open = false
    onlive(null)
  }

  // The bar goes (selection dragged, cleared, edited as text): so does the card and its preview.
  onDestroy(close)

  // Another selection (or none left with a style): the card belongs to the old one.
  const selectionKey = $derived(annotations.map((a) => a.id).join(' '))
  $effect(() => {
    void selectionKey
    void styleType
    untrack(close)
  })

  /**
   * Places the card next to the selection inside the viewer (see placeCard);
   * closes it once the selection has scrolled out of view.
   */
  function place() {
    if (!card) return
    const page = bar.parentElement!.getBoundingClientRect()
    const viewer = bar.closest('.viewer')?.getBoundingClientRect() ?? {
      left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight,
    }
    const p = placeCard({
      bar: bar.getBoundingClientRect(),
      selection: { left: page.left + rect[0], top: page.top + rect[1], right: page.left + rect[2], bottom: page.top + rect[3] },
      // Its natural size: scrollHeight is not cut by the height cap.
      card: { width: card.offsetWidth, height: card.scrollHeight },
      barAbove: above,
      bounds: { left: viewer.left + MARGIN, top: viewer.top + MARGIN, right: viewer.right - MARGIN, bottom: viewer.bottom - MARGIN },
    })
    if (p) cardPos = p
    else close()
  }

  $effect(() => {
    if (!open || !card) return
    place()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    ro?.observe(card)
    // The page scrolls under a fixed card: follow it.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      ro?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  })

  // The bar moves with the selection (e.g. a text box growing): so does the card.
  $effect(() => {
    void top
    void left
    if (open) untrack(place)
  })
</script>

<!-- A sibling of the overlay, above the text layer: its presses never reach the
     tool or the text layer, and data-page-ui keeps the page's own listeners off them. -->
<div
  class="selection-bar"
  data-page-ui
  role="toolbar"
  aria-label="Selection actions"
  tabindex="-1"
  bind:this={bar}
  style:left="{left}px"
  style:top="{top}px"
  onpointerdown={(e) => e.stopPropagation()}
>
  {#if count > 1}<span class="count">{count} selected</span>{/if}
  {#if styleType && onstyle}
    <button
      type="button"
      class="style"
      class:open
      bind:this={styleButton}
      title="Style"
      aria-label="Style"
      aria-expanded={open}
      aria-haspopup="dialog"
      onclick={(e) => {
        e.stopPropagation()
        if (open) close()
        else open = true
      }}
    >
      {#if swatch}
        <span class="swatch" style:background={cssColor(swatch)}></span>
      {:else}
        <Palette size={16} />
      {/if}
      <span>Style</span>
    </button>
    <span class="divider"></span>
  {/if}
  {#if onexplain}
    {@const Explain = actionIcons.generateExplanation}
    <button
      type="button"
      class="action"
      title="Explain this with AI (added to the page's explanation)"
      aria-label="Explain this"
      onclick={(e) => {
        e.stopPropagation()
        onexplain()
      }}
    >
      <Explain size={16} />
    </button>
    <span class="divider"></span>
  {/if}
  {#each actions as a (a.id)}
    <button type="button" class="action" class:danger={a.danger} title={a.label} aria-label={a.label} onclick={(e) => run(e, a.id)}>
      <a.Icon size={16} />
    </button>
  {/each}
  {#if open && onstyle}
    <!-- Moved to the document body (the page clips and contains it), placed in viewer coordinates. -->
    <div
      class="style-card"
      role="dialog"
      aria-label="Style"
      bind:this={card}
      style:left="{cardPos.left}px"
      style:top="{cardPos.top}px"
      style:max-height="{cardPos.maxHeight}px"
      use:portal
      use:dismissable={{ onclose: close, ignore: [styleButton] }}
    >
      <StyleCard {annotations} {relayout} {onlive} oncommit={onstyle} />
    </div>
  {/if}
</div>

<style>
  .selection-bar {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 34px;
    padding: 0 4px;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-soft);
    font: var(--font-size-base) var(--font-ui);
    color: var(--text);
    white-space: nowrap;
    user-select: none;
  }
  .count {
    margin: 0 6px;
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font: inherit;
    cursor: pointer;
    transition: background var(--transition);
  }
  .action {
    width: 28px;
  }
  .style {
    gap: 6px;
    padding: 0 8px 0 6px;
  }
  button:hover,
  .style.open {
    background: var(--surface-hover);
  }
  button:focus-visible {
    outline: 1px solid var(--accent);
  }
  button.danger:hover {
    color: var(--danger);
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.6);
  }
  .divider {
    width: 1px;
    height: 18px;
    margin: 0 3px;
    background: var(--border);
  }
  .style-card {
    position: fixed;
    z-index: 20;
    width: 256px;
    overflow-y: auto;
    padding: 12px;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-soft);
    font: var(--font-size-base) var(--font-ui);
    color: var(--text);
    user-select: none;
    cursor: default;
  }
</style>

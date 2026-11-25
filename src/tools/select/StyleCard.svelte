<script lang="ts">
  import { untrack } from 'svelte'
  import type { Annotation, FreeTextAnnotation } from '../../core/session/model'
  import MarkerControls from '../marker/MarkerControls.svelte'
  import PenControls from '../pen/PenControls.svelte'
  import LineControls from '../shape/LineControls.svelte'
  import ShapeControls from '../shape/ShapeControls.svelte'
  import { selectionMemory, type StyleMemory } from '../shape/settings'
  import TextControls from '../text/TextControls.svelte'
  import TextLineControls from '../textline/TextLineControls.svelte'
  import {
    applyStyle, styleTypeOf, styleValue, type LineStyle, type MarkerStyle, type PenStyle, type ShapeKindStyle,
    type TextLineStyle, type TextStyle,
  } from './styleTypes'

  // Style of the selected annotations, with the same controls the tool that
  // makes them shows for new ones. The controls show the first annotation's
  // values; a change applies only the changed fields to every annotation, so
  // a group keeps what differs between its members. Drags (sliders, custom
  // colours) are previewed through `onlive` (null: preview over) and each
  // committed change is reported once through `oncommit` (one undo step).
  let {
    annotations,
    relayout,
    onlive,
    oncommit,
  }: {
    /** The selected annotations: one style type (see styleTypeOf). */
    annotations: readonly Annotation[]
    /** Lays out a text box whose font size (or weight) changes (lines and height). */
    relayout?(a: FreeTextAnnotation): FreeTextAnnotation
    onlive(list: Annotation[] | null): void
    oncommit(list: Annotation[]): void
  } = $props()

  /** Fields changed but not yet in `annotations` (a drag, or a commit on its way to the store). */
  let live = $state<Record<string, unknown> | null>(null)

  // New annotations (another selection, or the committed change landed): the
  // preview is over; the controls show the annotations as they are. The same
  // annotations in a new array (the selection redrawn) are not new.
  let seen: readonly Annotation[] = untrack(() => annotations)
  $effect(() => {
    const now = annotations
    untrack(() => {
      const same = now.length === seen.length && now.every((a, i) => a === seen[i])
      seen = now
      if (same || live === null) return
      live = null
      onlive(null)
    })
  })

  const type = $derived(styleTypeOf(annotations))
  const first = $derived(annotations[0])
  const value = $derived.by(() => {
    const v = styleValue(live ? applyStyle(first, live) : first) as unknown as Record<string, unknown>
    // A thickness only when every member has one (text highlights have none).
    if (type === 'marker' && !annotations.every((a) => a.kind === 'ink')) delete v.width
    return v
  })

  function styled(patch: Record<string, unknown>): Annotation[] {
    return annotations.map((a) => {
      const next = applyStyle(a, patch)
      return relayout && next.kind === 'freetext' && ('fontSize' in patch || 'bold' in patch) ? relayout(next) : next
    })
  }

  function change(patch: object) {
    live = { ...live, ...patch }
    onlive(styled(live))
  }

  function commit(patch: object, memory?: StyleMemory) {
    if (memory && first) selectionMemory.set(first.id, memory)
    const list = annotations.map((a) => applyStyle(a, patch as Record<string, unknown>))
    // Keep showing the change until the store has it.
    change(patch)
    oncommit(list)
  }
</script>

<div class="style-card-controls">
  {#if type === 'text'}
    <TextControls value={value as unknown as TextStyle} onchange={change} oncommit={commit} />
  {:else if type === 'pen'}
    <PenControls value={value as unknown as PenStyle} onchange={change} oncommit={commit} />
  {:else if type === 'marker'}
    <MarkerControls value={value as unknown as MarkerStyle} onchange={change} oncommit={commit} />
  {:else if type === 'textline'}
    <TextLineControls value={value as unknown as TextLineStyle} onchange={change} oncommit={commit} />
  {:else if type === 'shape'}
    <ShapeControls
      value={value as unknown as ShapeKindStyle}
      memory={selectionMemory.get(first.id)}
      onchange={change}
      oncommit={commit}
    />
  {:else if type === 'line'}
    <LineControls value={value as unknown as LineStyle} onchange={change} oncommit={commit} />
  {/if}
</div>

<style>
  .style-card-controls {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
</style>

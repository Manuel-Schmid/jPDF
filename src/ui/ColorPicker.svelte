<script lang="ts">
  import { onDestroy } from 'svelte'
  import Palette from '@lucide/svelte/icons/palette'
  import Pipette from '@lucide/svelte/icons/pipette'
  import type { RGB } from '../core/session/model'
  import { cancelPick, pickColor } from '../core/viewer/eyedropper.svelte'
  import { rgbToHex } from './color'
  import CustomColorEditor from './CustomColorEditor.svelte'

  let {
    value,
    presets,
    onchange,
    oncommit,
    label = 'Colour',
  }: {
    value: RGB
    presets: RGB[]
    /** Every colour picked, including each step while the custom picker is open. */
    onchange(v: RGB): void
    /** The final colour: a preset click, or the custom picker's committed value. */
    oncommit?(v: RGB): void
    label?: string
  } = $props()

  const current = $derived(rgbToHex(value))
  const isCustom = $derived(!presets.some((p) => rgbToHex(p) === current))

  function pick(p: RGB) {
    onchange(p)
    oncommit?.(p)
  }

  /** The custom colour panel (native colour input and eyedropper) is open. */
  let open = $state(false)
  /** This picker's eyedropper pick is in progress. */
  let picking = $state(false)
  let destroyed = false

  /** Starts an eyedropper pick, or cancels the one in progress; a picked colour applies like a preset. */
  async function togglePick() {
    if (picking) {
      cancelPick()
      return
    }
    picking = true
    const c = await pickColor()
    picking = false
    if (c && !destroyed) pick(c)
  }

  onDestroy(() => {
    destroyed = true
    if (picking) cancelPick()
  })
</script>

<div class="picker" role="radiogroup" aria-label={label}>
  {#each presets as p, i (i)}
    {@const hex = rgbToHex(p)}
    <button
      type="button"
      class="swatch"
      role="radio"
      aria-checked={hex === current}
      aria-label={hex}
      title={hex}
      style:--swatch={hex}
      onclick={() => pick(p)}
    ></button>
  {/each}
  <button
    type="button"
    class="swatch custom"
    class:checked={isCustom}
    aria-label="Custom colours"
    aria-expanded={open}
    title="Custom colours"
    style:--swatch={isCustom ? current : 'transparent'}
    onclick={() => (open = !open)}
  >
    {#if isCustom}
      <!-- Still marks the swatch as the way to custom colours once it shows one. -->
      <span class="badge"><Palette size={9} strokeWidth={2.5} /></span>
    {:else}
      <Palette size={13} />
    {/if}
  </button>
  {#if open}
    <CustomColorEditor {value} {onchange} {oncommit}>
      <button
        type="button"
        class="dropper"
        data-eyedropper-ignore
        aria-pressed={picking}
        aria-label="Pick a colour from the page"
        title="Pick a colour from the page (Esc cancels)"
        onclick={togglePick}
      >
        <Pipette size={14} />
      </button>
    </CustomColorEditor>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    cursor: pointer;
    /* Hairline ring keeps dark colours visible on the dark surface. */
    box-shadow: inset 0 0 0 1px var(--surface-hover);
    transition: transform var(--transition), box-shadow var(--transition);
  }
  .swatch:hover {
    transform: scale(1.1);
  }
  .swatch[aria-checked='true'],
  .swatch.checked {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }
  .badge {
    position: absolute;
    right: -5px;
    bottom: -5px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--surface);
    color: var(--text-strong);
    box-shadow: 0 0 0 1px var(--border);
  }
  .custom:not(.checked) {
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--text-muted);
  }
  .dropper {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: auto;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .dropper:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .dropper:hover {
    background: var(--surface-hover);
  }
  .dropper[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Palette from '@lucide/svelte/icons/palette'
  import Pipette from '@lucide/svelte/icons/pipette'
  import type { RGB } from '../core/session/model'
  import { cancelPick, pickColor } from '../core/viewer/eyedropper.svelte'
  import { hexToRgb, parseHex, rgbToHex } from './color'

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

  function onCustom(e: Event) {
    const rgb = hexToRgb((e.currentTarget as HTMLInputElement).value)
    if (rgb) onchange(rgb)
  }

  function onCustomCommit(e: Event) {
    closeNative()
    const rgb = hexToRgb((e.currentTarget as HTMLInputElement).value)
    if (rgb) oncommit?.(rgb)
  }

  function pick(p: RGB) {
    onchange(p)
    oncommit?.(p)
  }

  /** The hex field's text while it is being edited; null shows the current colour. */
  let draft = $state<string | null>(null)
  const draftValid = $derived(draft === null || parseHex(draft) !== null)

  /** Each valid code typed or pasted applies at once, like a step of the native picker. */
  function onHexInput(e: Event) {
    draft = (e.currentTarget as HTMLInputElement).value
    const rgb = parseHex(draft)
    if (rgb) onchange(rgb)
  }

  /** Enter or leaving the field: a valid code is committed; anything else goes back to the current colour. */
  function onHexCommit() {
    const rgb = draft === null ? null : parseHex(draft)
    draft = null
    if (rgb) oncommit?.(rgb)
  }

  function onHexKey(e: KeyboardEvent) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
  }

  /**
   * The system colour dialog is open (from the well). Its own clicks never
   * reach the page, so it counts as closed when it commits (change) or the
   * window gets focus back (not on the input's blur: the window loses focus
   * to the dialog as it opens).
   */
  let nativeOpen = $state(false)
  /** When it last closed: a click on the well that closed it must not reopen it. */
  let nativeClosedAt = -Infinity
  /** Clicking the well again closes the dialog instead of reopening it (like a dropdown). */
  const REOPEN_GUARD_MS = 400

  function closeNative() {
    if (!nativeOpen) return
    nativeOpen = false
    nativeClosedAt = performance.now()
  }

  function onWellClick(e: MouseEvent) {
    if (nativeOpen || performance.now() - nativeClosedAt < REOPEN_GUARD_MS) {
      e.preventDefault()
      nativeOpen = false
      nativeClosedAt = -Infinity
      return
    }
    nativeOpen = true
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

<svelte:window onfocus={closeNative} />

<div class="picker" role="radiogroup" aria-label={label}>
  {#each presets as p (rgbToHex(p))}
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
    <div class="custom-panel">
      <label class="well" class:open={nativeOpen} title="Choose a colour">
        <span class="well-swatch" style:--swatch={current}></span>
        <span class="chevron"><ChevronDown size={12} /></span>
        <input
          type="color"
          aria-label="Custom colour"
          value={current}
          oninput={onCustom}
          onchange={onCustomCommit}
          onclick={onWellClick}
        />
      </label>
      <input
        class="hex"
        type="text"
        aria-label="Hex code"
        title="Hex code: type or paste one (e.g. #ffeb3b)"
        spellcheck="false"
        autocomplete="off"
        maxlength="9"
        aria-invalid={!draftValid}
        value={draft ?? current}
        oninput={onHexInput}
        onchange={onHexCommit}
        onblur={onHexCommit}
        onkeydown={onHexKey}
      />
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
    </div>
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
  .custom-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }
  /* Looks like a dropdown (swatch + chevron in a field) so it reads as clickable. */
  .well {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 6px 0 4px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    transition: border-color var(--transition), background var(--transition);
  }
  .well:hover {
    border-color: var(--text-muted);
    background: var(--surface-hover);
  }
  .chevron {
    display: grid;
    transition: transform var(--transition);
  }
  .well.open .chevron {
    transform: rotate(180deg);
  }
  .well-swatch {
    width: 28px;
    height: 18px;
    border-radius: 3px;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px var(--surface-hover);
  }
  .well:focus-within,
  .dropper:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .well input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: none;
    padding: 0;
  }
  .hex {
    box-sizing: border-box;
    width: 84px;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .hex:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hex[aria-invalid='true'] {
    border-color: var(--danger);
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
  .dropper:hover {
    background: var(--surface-hover);
  }
  .dropper[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>

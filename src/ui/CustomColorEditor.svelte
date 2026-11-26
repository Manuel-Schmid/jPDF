<script lang="ts">
  import type { Snippet } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import type { RGB } from '../core/session/model'
  import { hexToRgb, parseHex, rgbToHex } from './color'

  // Custom colour editor: a dropdown-style colour well (the system colour
  // dialog) and an editable hex field, with room for more controls after
  // them (the tool options add the eyedropper). Used by ColorPicker and by
  // Settings → Colours.
  let {
    value,
    onchange,
    oncommit,
    label = 'Custom colour',
    children,
  }: {
    value: RGB
    /** Every colour picked, including each step while the colour dialog is open or a valid code is typed. */
    onchange(v: RGB): void
    /** The final colour: the dialog's committed value, or a typed code on Enter or leaving the field. */
    oncommit?(v: RGB): void
    /** Accessible name of the colour well. */
    label?: string
    /** Controls after the hex field. */
    children?: Snippet
  } = $props()

  const current = $derived(rgbToHex(value))

  function onCustom(e: Event) {
    const rgb = hexToRgb((e.currentTarget as HTMLInputElement).value)
    if (rgb) onchange(rgb)
  }

  function onCustomCommit(e: Event) {
    closeNative()
    const rgb = hexToRgb((e.currentTarget as HTMLInputElement).value)
    if (rgb) oncommit?.(rgb)
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
</script>

<svelte:window onfocus={closeNative} />

<div class="custom-panel">
  <label class="well" class:open={nativeOpen} title="Choose a colour">
    <span class="well-swatch" style:--swatch={current}></span>
    <span class="chevron"><ChevronDown size={12} /></span>
    <input
      type="color"
      aria-label={label}
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
  {@render children?.()}
</div>

<style>
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
  .well:focus-within {
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
</style>

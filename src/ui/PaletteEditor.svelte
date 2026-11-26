<script lang="ts">
  import type { RGB } from '../core/session/model'
  import { rgbToHex } from './color'
  import CustomColorEditor from './CustomColorEditor.svelte'

  // One palette in Settings → Colours: its swatches in a row, with Reset.
  // Clicking a swatch selects it and opens the custom colour editor (colour
  // well and hex field) under the row; each change applies at once. Clicking
  // the selected swatch again closes the editor.
  let {
    id,
    label,
    hint,
    colors,
    defaults,
    onset,
    onreset,
  }: {
    /** Prefix of element ids (label association). */
    id: string
    label: string
    /** Which tools use the palette. */
    hint: string
    colors: RGB[]
    /** The built-in colours: Reset is disabled while the palette has them. */
    defaults: RGB[]
    onset(index: number, color: RGB): void
    onreset(): void
  } = $props()

  /** The swatch being edited; null: none (editor closed). */
  let selected = $state<number | null>(null)

  const isDefault = $derived(colors.length === defaults.length && colors.every((c, i) => rgbToHex(c) === rgbToHex(defaults[i])))
</script>

<div class="palette">
  <div class="head">
    <div class="text">
      <span class="label" id="{id}-label">{label}</span>
      <span class="hint">{hint}</span>
    </div>
    <button type="button" class="button" disabled={isDefault} onclick={onreset}>Reset</button>
  </div>
  <div class="swatches" role="group" aria-labelledby="{id}-label">
    {#each colors as c, i (i)}
      {@const hex = rgbToHex(c)}
      <button
        type="button"
        class="swatch"
        aria-pressed={selected === i}
        aria-label="Colour {i + 1}: {hex}"
        title="Change {hex}"
        style:--swatch={hex}
        onclick={() => (selected = selected === i ? null : i)}
      ></button>
    {/each}
  </div>
  {#if selected !== null && colors[selected]}
    {@const index = selected}
    <div class="editor">
      <CustomColorEditor value={colors[index]} label="Colour {index + 1}" onchange={(c) => onset(index, c)} />
    </div>
  {/if}
</div>

<style>
  .palette {
    display: grid;
    gap: 12px;
    padding: 16px 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .text {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .label {
    color: var(--text-strong);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
    line-height: 1.4;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    /* Room for the selection ring. */
    padding: 4px;
  }
  .swatch {
    width: 32px;
    height: 32px;
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
    transform: scale(1.08);
  }
  .swatch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .swatch[aria-pressed='true'] {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }
  .editor {
    max-width: 260px;
  }
  .button {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-strong);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition);
  }
  .button:hover:not(:disabled) {
    border-color: var(--text-muted);
  }
  .button:disabled {
    background: transparent;
    color: var(--text-muted);
    cursor: default;
  }
</style>

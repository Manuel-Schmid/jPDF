<script lang="ts">
  import ColorPicker from '../../ui/ColorPicker.svelte'
  import Section from '../../ui/Section.svelte'
  import Segmented from '../../ui/Segmented.svelte'
  import Slider from '../../ui/Slider.svelte'
  import type { TextAlign } from '../../core/session/model'
  import { PEN_PRESETS } from '../pen/settings'
  import type { TextStyle } from '../select/styleTypes'
  import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND, FONT_SIZE_MAX, FONT_SIZE_MIN } from './settings'

  // Text box style controls: the text tool's options and a selected box's
  // Style card. `onchange` reports each step of a drag (slider, custom
  // colour), `oncommit` the final value; both with only the changed fields.
  // Bold and italic are two toggles (each its own button, both may be on).
  // Alignment, used less often, comes last in its own section.
  let {
    value,
    onchange,
    oncommit,
  }: {
    value: TextStyle
    onchange(patch: Partial<TextStyle>): void
    oncommit(patch: Partial<TextStyle>): void
  } = $props()

  const ALIGN_OPTIONS: { value: TextAlign; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Centre' },
    { value: 'right', label: 'Right' },
  ]
</script>

<ColorPicker
  label="Text colour"
  value={value.textColor}
  presets={PEN_PRESETS}
  onchange={(textColor) => onchange({ textColor })}
  oncommit={(textColor) => oncommit({ textColor })}
/>
<Slider
  label="Font size"
  min={FONT_SIZE_MIN}
  max={FONT_SIZE_MAX}
  step={1}
  value={value.fontSize}
  format={(v) => `${v} pt`}
  onchange={(fontSize) => onchange({ fontSize })}
  oncommit={(fontSize) => oncommit({ fontSize })}
/>
<Section title="Font style">
  <div class="font-style" role="group" aria-label="Font style">
    <button
      type="button"
      class="bold"
      aria-pressed={!!value.bold}
      aria-label="Bold"
      title="Bold (Ctrl+B)"
      onclick={() => oncommit({ bold: !value.bold })}>B</button
    >
    <button
      type="button"
      class="italic"
      aria-pressed={!!value.italic}
      aria-label="Italic"
      title="Italic (Ctrl+I)"
      onclick={() => oncommit({ italic: !value.italic })}>I</button
    >
  </div>
</Section>
<Section title="Background">
  <Segmented
    label="Background"
    options={[
      { value: 'none', label: 'Transparent' },
      { value: 'color', label: 'Colour' },
    ]}
    value={value.background ? 'color' : 'none'}
    onchange={(v) => oncommit({ background: v === 'color' ? (value.background ?? DEFAULT_BACKGROUND) : null })}
  />
  {#if value.background}
    {@const bg = value.background}
    <ColorPicker
      label="Background colour"
      value={bg.color}
      presets={BACKGROUND_PRESETS}
      onchange={(color) => onchange({ background: { ...bg, color } })}
      oncommit={(color) => oncommit({ background: { ...bg, color } })}
    />
    <Slider
      label="Background opacity"
      min={0}
      max={100}
      step={5}
      value={Math.round(bg.opacity * 100)}
      format={(v) => `${v}%`}
      onchange={(v) => onchange({ background: { ...bg, opacity: v / 100 } })}
      oncommit={(v) => oncommit({ background: { ...bg, opacity: v / 100 } })}
    />
  {/if}
</Section>
<Section title="Alignment">
  <Segmented label="Alignment" options={ALIGN_OPTIONS} value={value.align} onchange={(align) => oncommit({ align })} />
</Section>

<style>
  /* Two toggles in the look of a Segmented control. */
  .font-style {
    display: flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-sm);
    background: var(--bg-deep);
  }
  button {
    flex: 1;
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font-family: Arial, Helvetica, sans-serif;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  button:hover {
    color: var(--text-strong);
  }
  button[aria-pressed='true'] {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  .bold {
    font-weight: bold;
  }
  .italic {
    font-style: italic;
  }
</style>

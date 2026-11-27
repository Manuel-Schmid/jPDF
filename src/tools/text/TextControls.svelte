<script lang="ts">
  import { withShortcut } from '../../core/registry/shortcuts'
  import ColorPicker from '../../ui/ColorPicker.svelte'
  import Section from '../../ui/Section.svelte'
  import Segmented from '../../ui/Segmented.svelte'
  import Slider from '../../ui/Slider.svelte'
  import type { TextAlign } from '../../core/session/model'
  import { settings } from '../../core/settings/settings.svelte'
  import type { TextStyle } from '../select/styleTypes'
  import { DEFAULT_BACKGROUND, FONT_SIZE_MAX, FONT_SIZE_MIN } from './settings'

  // Text box style controls: the text tool's options and a selected box's
  // Style card. `onchange` reports each step of a drag (slider, custom
  // colour), `oncommit` the final value; both with only the changed fields.
  // Bold and italic are two toggles (both may be on) beside the font size.
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
  presets={settings.data.preferences.penPalette}
  onchange={(textColor) => onchange({ textColor })}
  oncommit={(textColor) => oncommit({ textColor })}
/>
<!-- Bold and italic sit beside the size slider: small toggles, no section of their own. -->
<div class="size-row">
  <div class="size">
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
  </div>
  <div class="font-style" role="group" aria-label="Font style">
    <button
      type="button"
      class="bold"
      aria-pressed={!!value.bold}
      aria-label="Bold"
      title={withShortcut('Bold', 'text.bold')}
      onclick={() => oncommit({ bold: !value.bold })}>B</button
    >
    <button
      type="button"
      class="italic"
      aria-pressed={!!value.italic}
      aria-label="Italic"
      title={withShortcut('Italic', 'text.italic')}
      onclick={() => oncommit({ italic: !value.italic })}>I</button
    >
  </div>
</div>
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
      presets={settings.data.preferences.penPalette}
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
  .size-row {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .size {
    flex: 1;
    min-width: 0;
  }
  /* Centred on the slider track (the range input is 16px high). */
  .font-style {
    display: flex;
    gap: 4px;
    margin-bottom: -4px;
  }
  button {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--bg-deep);
    color: var(--text);
    font-family: Arial, Helvetica, sans-serif;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    transition: background var(--transition), color var(--transition), box-shadow var(--transition);
  }
  button:hover {
    color: var(--text-strong);
    background: var(--surface-hover);
  }
  button[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--text-strong);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent);
  }
  .bold {
    font-weight: bold;
  }
  .italic {
    font-style: italic;
  }
</style>

<script lang="ts">
  import ColorPicker from '../../ui/ColorPicker.svelte'
  import Slider from '../../ui/Slider.svelte'
  import type { MarkerStyle } from '../select/styleTypes'
  import { settings } from '../../core/settings/settings.svelte'

  // Marker controls: the marker tool's options and the Style card of selected
  // highlights or marker strokes. The thickness slider shows when `value` has
  // a width (freehand strokes; text highlights have none).
  let {
    value,
    onchange,
    oncommit,
  }: {
    value: MarkerStyle
    onchange(patch: Partial<MarkerStyle>): void
    oncommit(patch: Partial<MarkerStyle>): void
  } = $props()
</script>

<ColorPicker
  value={value.color}
  presets={settings.data.preferences.markerPalette}
  onchange={(color) => onchange({ color })}
  oncommit={(color) => oncommit({ color })}
/>
<Slider
  label="Opacity"
  min={10}
  max={100}
  step={5}
  value={Math.round(value.opacity * 100)}
  format={(v) => `${v}%`}
  onchange={(v) => onchange({ opacity: v / 100 })}
  oncommit={(v) => oncommit({ opacity: v / 100 })}
/>
{#if value.width !== undefined}
  <Slider
    label="Thickness"
    min={4}
    max={40}
    step={1}
    value={value.width}
    format={(v) => `${v} pt`}
    onchange={(width) => onchange({ width })}
    oncommit={(width) => oncommit({ width })}
  />
{/if}

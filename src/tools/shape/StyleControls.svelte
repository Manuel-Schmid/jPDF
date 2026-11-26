<script lang="ts">
  import ColorPicker from '../../ui/ColorPicker.svelte'
  import Section from '../../ui/Section.svelte'
  import Segmented from '../../ui/Segmented.svelte'
  import Slider from '../../ui/Slider.svelte'
  import { settings } from '../../core/settings/settings.svelte'
  import { toggleBorder, toggleFill, type ShapeStyle, type StyleMemory } from './settings'

  // Border and fill controls of the shape tool's options and of a selected
  // shape. Every change reports the whole style: `onchange` for each step of a
  // drag (slider, custom colour), `oncommit` for the final value, with the
  // style memory (the border/fill last turned off, restored when turned on).
  // `strokeOnly` (lines): only the border's colour, width and opacity; the
  // border cannot be turned off and there is no fill.
  // Border (or line) and fill each sit under their own section title, which
  // stays visible while the part is turned off.
  let {
    style,
    memory = {},
    strokeOnly = false,
    onchange,
    oncommit,
  }: {
    style: ShapeStyle
    memory?: StyleMemory
    strokeOnly?: boolean
    onchange(s: ShapeStyle): void
    oncommit(s: ShapeStyle, memory: StyleMemory): void
  } = $props()

  const commit = (s: ShapeStyle) => oncommit(s, memory)

  function toggled(r: { style: ShapeStyle; memory: StyleMemory }) {
    oncommit(r.style, r.memory)
  }

  const pct = (v: number) => `${v}%`
  const pt = (v: number) => `${v} pt`
  const stroke = $derived(strokeOnly ? 'Line' : 'Border')
</script>

<Section title={stroke}>
  {#if !strokeOnly}
    <Segmented
      label="Border"
      options={[
        { value: 'none', label: 'None' },
        { value: 'border', label: 'Border' },
      ]}
      value={style.border ? 'border' : 'none'}
      onchange={(v) => toggled(toggleBorder(style, v === 'border', memory))}
    />
  {/if}
  {#if style.border}
    {@const b = style.border}
    <ColorPicker
      label={`${stroke} colour`}
      value={b.color}
      presets={settings.data.preferences.penPalette}
      onchange={(color) => onchange({ ...style, border: { ...b, color } })}
      oncommit={(color) => commit({ ...style, border: { ...b, color } })}
    />
    <Slider
      label={`${stroke} width`}
      min={0.5}
      max={20}
      step={0.5}
      value={b.width}
      format={pt}
      onchange={(width) => onchange({ ...style, border: { ...b, width } })}
      oncommit={(width) => commit({ ...style, border: { ...b, width } })}
    />
    <Slider
      label={`${stroke} opacity`}
      min={10}
      max={100}
      step={5}
      value={Math.round(b.opacity * 100)}
      format={pct}
      onchange={(v) => onchange({ ...style, border: { ...b, opacity: v / 100 } })}
      oncommit={(v) => commit({ ...style, border: { ...b, opacity: v / 100 } })}
    />
  {/if}
</Section>
{#if !strokeOnly}
<Section title="Fill">
  <Segmented
    label="Fill"
    options={[
      { value: 'none', label: 'None' },
      { value: 'fill', label: 'Fill' },
    ]}
    value={style.fill ? 'fill' : 'none'}
    onchange={(v) => toggled(toggleFill(style, v === 'fill', memory))}
  />
  {#if style.fill}
    {@const f = style.fill}
    <ColorPicker
      label="Fill colour"
      value={f.color}
      presets={settings.data.preferences.penPalette}
      onchange={(color) => onchange({ ...style, fill: { ...f, color } })}
      oncommit={(color) => commit({ ...style, fill: { ...f, color } })}
    />
    <Slider
      label="Fill opacity"
      min={0}
      max={100}
      step={5}
      value={Math.round(f.opacity * 100)}
      format={pct}
      onchange={(v) => onchange({ ...style, fill: { ...f, opacity: v / 100 } })}
      oncommit={(v) => commit({ ...style, fill: { ...f, opacity: v / 100 } })}
    />
  {/if}
</Section>
{/if}

<script lang="ts">
  import ColorPicker from '../../ui/ColorPicker.svelte'
  import type { TextLineStyle } from '../select/styleTypes'
  import { settings } from '../../core/settings/settings.svelte'

  // Underline / strike-out controls: the tools' options and the Style card.
  let {
    value,
    onchange,
    oncommit,
  }: {
    value: TextLineStyle
    onchange(patch: Partial<TextLineStyle>): void
    oncommit(patch: Partial<TextLineStyle>): void
  } = $props()
</script>

<ColorPicker
  value={value.color}
  presets={settings.data.preferences.penPalette}
  onchange={(color) => onchange({ color })}
  oncommit={(color) => oncommit({ color })}
/>

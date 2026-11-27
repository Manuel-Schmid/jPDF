<script lang="ts">
  import Segmented from '../../ui/Segmented.svelte'
  import type { EraserMode, EraserSettings } from './index'

  // Partial cuts pen and marker strokes; the right-button and pen erasers follow this too (eraserModeOf).
  let { settings, update }: { settings: EraserSettings; update(patch: Partial<EraserSettings>): void } = $props()
</script>

<div class="option">
  <span class="label" title="Partial erases only the part of a pen or marker stroke under the eraser; text markup and shapes are always erased whole">
    Erase
  </span>
  <Segmented
    label="Erase"
    options={[
      { value: 'stroke' as EraserMode, label: 'Whole stroke' },
      { value: 'partial' as EraserMode, label: 'Partial' },
    ]}
    value={settings.mode === 'partial' ? 'partial' : 'stroke'}
    onchange={(mode) => update({ mode })}
  />
</div>

<style>
  .option {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 12px;
  }
</style>

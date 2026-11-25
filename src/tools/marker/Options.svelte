<script lang="ts">
  import Segmented from '../../ui/Segmented.svelte'
  import HoldStraightOption from '../shared/HoldStraightOption.svelte'
  import MarkerControls from './MarkerControls.svelte'
  import type { MarkerSettings } from './settings'

  let { settings, update }: { settings: MarkerSettings; update(patch: Partial<MarkerSettings>): void } = $props()

  // Freehand strokes: freehand mode, and text mode with SmartMark™ (in blank space).
  const strokes = $derived(settings.mode === 'freehand' || settings.smartMark === true)
  // The thickness only applies to freehand strokes.
  const value = $derived({
    color: settings.color,
    opacity: settings.opacity,
    width: strokes ? settings.width : undefined,
  })
</script>

<div class="options">
  <Segmented
    label="Marker mode"
    options={[
      { value: 'text', label: 'Text' },
      { value: 'freehand', label: 'Freehand' },
    ]}
    value={settings.mode}
    onchange={(mode) => update({ mode })}
  />
  {#if settings.mode === 'text'}
    <div class="option">
      <span class="label" title="Highlight text where you press on it, draw freehand in blank space">SmartMark™</span>
      <Segmented
        label="SmartMark™"
        options={[
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ]}
        value={settings.smartMark === true ? 'on' : 'off'}
        onchange={(v) => update({ smartMark: v === 'on' })}
      />
    </div>
  {/if}
  <MarkerControls {value} onchange={update} oncommit={update} />
  {#if strokes}
    <HoldStraightOption value={settings.holdStraight !== false} onchange={(holdStraight) => update({ holdStraight })} />
  {/if}
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
</style>

<script lang="ts">
  import Segmented from '../../ui/Segmented.svelte'
  import HoldStraightOption from '../shared/HoldStraightOption.svelte'
  import MarkerControls from './MarkerControls.svelte'
  import type { MarkerSettings } from './settings'

  let { settings, update }: { settings: MarkerSettings; update(patch: Partial<MarkerSettings>): void } = $props()

  // Both modes draw freehand strokes (text mode in blank space), so both show the thickness.
  const value = $derived({ color: settings.color, opacity: settings.opacity, width: settings.width })
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
  <MarkerControls {value} onchange={update} oncommit={update} />
  <HoldStraightOption value={settings.holdStraight !== false} onchange={(holdStraight) => update({ holdStraight })} />
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
</style>

<script lang="ts">
  import HoldStraightOption from '../shared/HoldStraightOption.svelte'
  import PenControls from './PenControls.svelte'
  import type { PenSettings } from './settings'

  let { settings, update }: { settings: PenSettings; update(patch: Partial<PenSettings>): void } = $props()
</script>

<div class="options">
  <PenControls value={settings} onchange={update} oncommit={update} />
  <HoldStraightOption value={settings.holdStraight !== false} onchange={(holdStraight) => update({ holdStraight })} />
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
</style>

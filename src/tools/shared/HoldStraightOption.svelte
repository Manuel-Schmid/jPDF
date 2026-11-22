<script lang="ts">
  import Segmented from '../../ui/Segmented.svelte'

  // The pen's and freehand marker's "hold still to straighten" switch
  // (strokeCapture.ts); off keeps slow freehand drawing, e.g. on skewed scans.
  let { value, onchange }: { value: boolean; onchange(v: boolean): void } = $props()
</script>

<div class="option">
  <span class="label" title="Hold the pointer still mid-stroke to turn it into a straight line">Hold to straighten</span>
  <Segmented
    label="Hold to straighten"
    options={[
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ]}
    value={value ? 'on' : 'off'}
    onchange={(v) => onchange(v === 'on')}
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

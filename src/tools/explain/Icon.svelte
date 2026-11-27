<script lang="ts">
  // A scan frame (an area of the page) around a sparkle, the usual sign for
  // AI. The sparkle has the accent colour, like the Beta badge of Settings →
  // AI, so the tool reads as the AI one among the others. Lucide's geometry
  // (24×24, 2px round strokes), so it sits with the other tool icons.
  let { size }: { settings: unknown; size: number } = $props()
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  <path
    class="sparkle"
    d="M12 6.5c.4 2.6 1.9 4.1 4.5 4.5c.3.1.3.6 0 .7c-2.6.4-4.1 1.9-4.5 4.5c-.1.3-.6.3-.7 0c-.4-2.6-1.9-4.1-4.5-4.5c-.3-.1-.3-.6 0-.7c2.6-.4 4.1-1.9 4.5-4.5c.1-.3.6-.3.7 0z"
  />
</svg>

<style>
  .sparkle {
    fill: var(--accent);
    stroke: var(--accent);
    stroke-width: 1.25;
  }
</style>

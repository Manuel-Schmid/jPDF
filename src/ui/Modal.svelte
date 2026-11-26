<script lang="ts" module>
  /** Open modals, oldest first: only the last one reacts to Escape and outside clicks. */
  const stack: object[] = []
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import { dismissable } from './dismissable'
  import { portal } from './portal'

  // Centred dialog over a dimmed backdrop. Escape or a pointer-down on the
  // backdrop closes it; focus moves into the dialog, stays there (Tab wraps)
  // and returns to the previously focused element on close.
  //
  // Modals stack: each moves to the end of <body>, so the newest one (e.g. the
  // update prompt opened from Settings → Check now) paints in front whatever
  // the component order, and only the topmost one closes on Escape or a
  // pointer-down outside. Otherwise a click on the top dialog would count as
  // "outside" for the one below and close it, and Escape would close both.
  //
  // `maxWidth` widens the card for a dialog that needs the room (Settings);
  // every other modal keeps the 640px default. It still shrinks to the window.
  let {
    label,
    onclose,
    children,
    maxWidth = 640,
  }: {
    label: string
    onclose(): void
    children: Snippet
    maxWidth?: number
  } = $props()

  let card: HTMLDivElement
  const token = {}
  stack.push(token)
  $effect(() => () => {
    stack.splice(stack.indexOf(token), 1)
  })

  function close() {
    if (stack.at(-1) === token) onclose()
  }

  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

  function focusables(): HTMLElement[] {
    return [...card.querySelectorAll<HTMLElement>(FOCUSABLE)]
  }

  $effect(() => {
    const previous = document.activeElement as HTMLElement | null
    ;(focusables()[0] ?? card).focus()
    return () => previous?.focus?.()
  })

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return
    const f = focusables()
    if (f.length === 0) return
    const first = f[0]
    const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
</script>

<div class="backdrop" use:portal>
  <div
    class="card"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    style:--card-max-width="{maxWidth}px"
    bind:this={card}
    onkeydown={onKeydown}
    use:dismissable={{ onclose: close }}
  >
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--backdrop);
    animation: fade 150ms ease-out;
  }
  .card {
    max-width: min(var(--card-max-width, 640px), 100%);
    max-height: 100%;
    overflow: auto;
    padding: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-soft);
    animation: rise 150ms ease-out;
  }
  .card:focus {
    outline: none;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
</style>

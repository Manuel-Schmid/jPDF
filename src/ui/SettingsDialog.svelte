<script lang="ts" module>
  /** The Updates section's link to the updater: the running version and "Check now". */
  export interface UpdateControls {
    /** The running version; null until known. */
    version: string | null
    checking: boolean
    check(): void
  }

  export type SettingsCategory = 'appearance' | 'files' | 'toolbar' | 'ai' | 'updates'

  // The category shown last, so reopening the dialog in the same session lands
  // where the user was. Not saved: a fresh start opens on Appearance.
  let lastCategory: SettingsCategory = 'appearance'
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import FolderOpen from '@lucide/svelte/icons/folder-open'
  import Palette from '@lucide/svelte/icons/palette'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Wrench from '@lucide/svelte/icons/wrench'
  import X from '@lucide/svelte/icons/x'
  import type { Component } from 'svelte'
  import type { PageColors, ReopenAt, Theme, ToolbarPosition } from '../core/settings/preferences'
  import type { SettingsStore } from '../core/settings/settings.svelte'
  import { TOOL_PRESETS, matchesPreset, type ToolPreset } from '../core/settings/toolPresets'
  import { toasts } from './toasts.svelte'
  import Modal from './Modal.svelte'
  import Segmented from './Segmented.svelte'
  import type { PenButtonAction } from '../tools/rightClick'

  // App-wide preferences, grouped into categories (a list on the left, one
  // panel on the right). Each change applies at once and is saved by the store
  // (debounced); there is no OK/Cancel.
  let {
    store,
    onclose,
    updates,
    category = $bindable(lastCategory),
  }: { store: SettingsStore; onclose(): void; updates?: UpdateControls; category?: SettingsCategory } = $props()

  $effect(() => {
    lastCategory = category
  })

  const categories: { id: SettingsCategory; label: string; icon: Component<{ size?: number }> }[] = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'files', label: 'Files', icon: FolderOpen },
    { id: 'toolbar', label: 'Toolbar', icon: Wrench },
    { id: 'ai', label: 'AI (Beta)', icon: Sparkles },
    { id: 'updates', label: 'Updates', icon: RefreshCw },
  ]

  const updateModes: { value: 'auto' | 'manual'; label: string }[] = [
    { value: 'auto', label: 'Automatically' },
    { value: 'manual', label: 'When I ask' },
  ]

  const themes: { value: Theme; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ]

  const pageColorOptions: { value: PageColors; label: string }[] = [
    { value: 'original', label: 'Original' },
    { value: 'dark', label: 'Dark' },
    { value: 'theme', label: 'Match theme' },
  ]

  const toolbarPositions: { value: ToolbarPosition; label: string }[] = [
    { value: 'right', label: 'Right' },
    { value: 'left', label: 'Left' },
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
  ]

  const reopenOptions: { value: ReopenAt; label: string }[] = [
    { value: 'last', label: 'Where I left off' },
    { value: 'start', label: 'First page' },
  ]

  const fingerDrawOptions: { value: 'off' | 'on'; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ]

  // Pen buttons: hold the button to erase or lasso with any tool. The side
  // button's Auto acts like the right mouse button; the eraser end has no
  // Auto of its own (it erases).
  const penEraserButtonOptions: { value: PenButtonAction; label: string }[] = [
    { value: 'eraser', label: 'Eraser' },
    { value: 'lasso', label: 'Lasso' },
    { value: 'none', label: 'Nothing' },
  ]
  const penSideButtonOptions: { value: PenButtonAction; label: string }[] = [{ value: 'auto', label: 'Auto' }, ...penEraserButtonOptions]
  const penEraserButton = $derived(store.data.preferences.penEraserButton === 'auto' ? 'eraser' : store.data.preferences.penEraserButton)

  /** The preset the toolbar is exactly (unchanged since it was applied), if any. */
  const current = $derived(TOOL_PRESETS.find((p) => matchesPreset(store.data.toolbar, p))?.id)

  // Replaces the toolbar at once; the toast's Undo puts the old one back, so
  // a customised toolbar is never lost to a stray click.
  function apply(preset: ToolPreset) {
    if (preset.id === current) return
    const previous = store.applyPreset(preset)
    toasts.show(`Toolbar set to “${preset.name}”`, 'info', {
      label: 'Undo',
      run: () => store.restoreToolbar(previous),
    })
  }

  // Vertical tab list: Up/Down (and Home/End) move between categories and
  // show them, as Windows settings lists do.
  function onTabKeydown(e: KeyboardEvent) {
    const i = categories.findIndex((c) => c.id === category)
    const next =
      e.key === 'ArrowDown' ? (i + 1) % categories.length
      : e.key === 'ArrowUp' ? (i - 1 + categories.length) % categories.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? categories.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    category = categories[next].id
    const list = e.currentTarget as HTMLElement
    queueMicrotask(() => list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
  }
</script>

<!-- 800 × 550: wider than other modals (640px), room for the bigger text. -->
<Modal label="Settings" {onclose} maxWidth={800}>
  <div class="settings">
    <nav aria-label="Settings categories">
      <h2>Settings</h2>
      <div class="tabs" role="tablist" aria-orientation="vertical" tabindex="-1" onkeydown={onTabKeydown}>
        {#each categories as c (c.id)}
          <button
            type="button"
            role="tab"
            id="settings-tab-{c.id}"
            aria-selected={c.id === category}
            aria-controls="settings-panel"
            tabindex={c.id === category ? 0 : -1}
            onclick={() => (category = c.id)}
          >
            <c.icon size={18} />
            {c.label}
          </button>
        {/each}
      </div>
    </nav>

    <div class="panel" role="tabpanel" id="settings-panel" aria-labelledby="settings-tab-{category}">
      <header>
        <h3>{categories.find((c) => c.id === category)?.label}</h3>
        <button type="button" class="close" aria-label="Close" title="Close" onclick={onclose}>
          <X size={18} />
        </button>
      </header>

      {#if category === 'appearance'}
        <div class="row">
          <div class="text">
            <span class="label">Theme</span>
            <span class="hint">System follows the Windows setting.</span>
          </div>
          <Segmented
            label="Theme"
            options={themes}
            value={store.data.preferences.theme}
            onchange={(v) => store.setPreference('theme', v)}
          />
        </div>
        <div class="row">
          <div class="text">
            <span class="label">Page colours</span>
            <span class="hint">Inverts pages for night reading. The PDF isn't changed.</span>
          </div>
          <Segmented
            label="Page colours"
            options={pageColorOptions}
            value={store.data.preferences.pageColors}
            onchange={(v) => store.setPreference('pageColors', v)}
          />
        </div>
        <div class="row">
          <div class="text">
            <span class="label">Toolbar position</span>
            <span class="hint">Where the tools sit around the page.</span>
          </div>
          <Segmented
            label="Toolbar position"
            options={toolbarPositions}
            value={store.data.preferences.toolbarPosition}
            onchange={(v) => store.setPreference('toolbarPosition', v)}
          />
        </div>
      {:else if category === 'files'}
        <div class="row">
          <div class="text">
            <span class="label">Reopen files</span>
            <span class="hint">The page a file opens on.</span>
          </div>
          <Segmented
            label="Reopen files"
            options={reopenOptions}
            value={store.data.preferences.reopenAt}
            onchange={(v) => store.setPreference('reopenAt', v)}
          />
        </div>
        <div class="row">
          <div class="text">
            <span class="label">Recent files</span>
            <span class="hint">
              {store.data.recent.length === 0
                ? 'The start page lists no files.'
                : `${store.data.recent.length} ${store.data.recent.length === 1 ? 'file' : 'files'} on the start page.`}
            </span>
          </div>
          <button
            type="button"
            class="button"
            disabled={store.data.recent.length === 0}
            onclick={() => store.clearRecentFiles()}
          >
            Clear list
          </button>
        </div>
      {:else if category === 'toolbar'}
        <div class="row">
          <div class="text">
            <span class="label">Draw with finger</span>
            <span class="hint">Use one finger like a pen on a touchscreen. Two fingers still scroll and zoom.</span>
          </div>
          <Segmented
            label="Draw with finger"
            options={fingerDrawOptions}
            value={store.data.preferences.drawWithFinger ? 'on' : 'off'}
            onchange={(v) => store.setPreference('drawWithFinger', v === 'on')}
          />
        </div>
        <div class="row">
          <div class="text">
            <span class="label">Pen side button</span>
            <span class="hint">Hold it to erase or lasso with any tool. Auto works like the right mouse button.</span>
          </div>
          <Segmented
            label="Pen side button"
            options={penSideButtonOptions}
            value={store.data.preferences.penSideButton}
            onchange={(v) => store.setPreference('penSideButton', v)}
          />
        </div>
        <div class="row">
          <div class="text">
            <span class="label">Pen eraser button</span>
            <span class="hint">The eraser end, or a second button your pen reports as one.</span>
          </div>
          <Segmented
            label="Pen eraser button"
            options={penEraserButtonOptions}
            value={penEraserButton}
            onchange={(v) => store.setPreference('penEraserButton', v)}
          />
        </div>
        <div class="text intro">
          <span class="label" id="presets-label">Tool presets</span>
          <span class="hint">Applying a preset replaces your toolbar. The notification lets you undo it.</span>
        </div>
        <div class="presets" role="group" aria-labelledby="presets-label">
          {#each TOOL_PRESETS as p (p.id)}
            <button type="button" class="preset" aria-pressed={p.id === current} onclick={() => apply(p)}>
              <span class="mark" aria-hidden="true">
                {#if p.id === current}<Check size={16} />{/if}
              </span>
              <span class="name">{p.name}</span>
              <span class="count">{p.toolbar.length} tools</span>
              <span class="description">{p.description}</span>
            </button>
          {/each}
        </div>
      {:else if category === 'ai'}
        <!-- Loaded on first visit only: the AI code and the CLI lookups stay out of startup. -->
        {#await import('../ai/AiSettingsPanel.svelte') then { default: AiSettingsPanel }}
          <AiSettingsPanel {store} />
        {/await}
      {:else}
        <div class="row">
          <div class="text">
            <span class="label">Version</span>
            <span class="hint">{updates?.version ? `JuliePDF ${updates.version}` : 'JuliePDF'}</span>
          </div>
          {#if updates}
            <button type="button" class="button" disabled={updates.checking} onclick={() => updates.check()}>
              {updates.checking ? 'Checking…' : 'Check now'}
            </button>
          {/if}
        </div>
        <div class="row">
          <div class="text">
            <span class="label">Check for updates</span>
            <span class="hint">New versions come from GitHub and install only when you agree.</span>
          </div>
          <Segmented
            label="Check for updates"
            options={updateModes}
            value={store.data.preferences.checkUpdates ? 'auto' : 'manual'}
            onchange={(v) => store.setPreference('checkUpdates', v === 'auto')}
          />
        </div>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .settings {
    display: grid;
    grid-template-columns: 168px 1fr;
    /* Fill the Modal card edge to edge (over its 20px padding); the panels pad
       themselves. */
    margin: -20px;
    width: 800px;
    max-width: calc(100% + 40px);
    /* Fixed height: switching categories never resizes the dialog. */
    height: 550px;
    max-height: calc(100% + 40px);
    font-size: var(--font-size-dialog);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 10px;
    background: var(--bg-deep);
    border-right: 1px solid var(--border);
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }
  h2 {
    margin: 0;
    padding: 0 12px;
    font-size: var(--font-size-dialog);
    font-weight: 600;
    color: var(--text-strong);
  }
  .tabs {
    display: grid;
    gap: 2px;
  }
  .tabs:focus {
    outline: none;
  }
  [role='tab'] {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  [role='tab']:hover {
    color: var(--text-strong);
  }
  [role='tab'][aria-selected='true'] {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  /* A short accent bar marks the open category, as in Windows settings. */
  [role='tab'][aria-selected='true']::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 18px 24px 24px;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 -10px 6px 0;
  }
  h3 {
    margin: 0;
    font-size: var(--font-size-dialog-title);
    font-weight: 600;
    color: var(--text-strong);
  }
  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    cursor: pointer;
    transition: background var(--transition);
  }
  .close:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }
  /* One setting: label and hint on the left, its control on the right. */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 16px 0;
  }
  .row + .row,
  .row + .intro {
    border-top: 1px solid var(--border);
  }
  .row > :global(:last-child) {
    flex-shrink: 0;
  }
  /* The hint wraps instead of an option label. */
  .row :global([role='radio']) {
    white-space: nowrap;
  }
  .text {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .intro {
    padding: 16px 0 10px;
  }
  .label {
    color: var(--text-strong);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
    line-height: 1.4;
  }
  .button {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-strong);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition);
  }
  .button:hover:not(:disabled) {
    border-color: var(--text-muted);
  }
  .button:disabled {
    background: transparent;
    color: var(--text-muted);
    cursor: default;
  }
  .presets {
    display: grid;
    gap: 2px;
  }
  .preset {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    gap: 2px 12px;
    align-items: center;
    padding: 10px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition);
  }
  .preset:hover {
    background: var(--surface-hover);
  }
  .preset[aria-pressed='true'] {
    background: var(--surface-hover);
    cursor: default;
  }
  .mark {
    grid-row: 1 / span 2;
    display: grid;
    place-items: center;
    color: var(--accent);
  }
  .name {
    color: var(--text-strong);
  }
  .description {
    grid-column: 2 / span 2;
    font-size: var(--font-size-dialog-hint);
    line-height: 1.4;
  }
  .count {
    color: var(--text-muted);
    font-size: var(--font-size-dialog-hint);
    white-space: nowrap;
  }
</style>

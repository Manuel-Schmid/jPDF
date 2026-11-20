<script lang="ts">
  import { onMount } from 'svelte'
  import { initFileOpening, openFiles, pickAndOpen } from './app/fileOpening'
  import { guardPageZoom } from './app/pageZoomGuard'
  import ConfirmClose from './app/ConfirmClose.svelte'
  import { confirmCloseAll, registerSaveCommands } from './app/saveFlow'
  import { commands } from './core/registry/commands'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { DocumentSession } from './core/session/session.svelte'
  import { tabs } from './app/tabs.svelte'
  import EmptyState from './app/EmptyState.svelte'
  import StatusBar from './app/StatusBar.svelte'
  import TitleBar from './app/TitleBar.svelte'
  import { keybindings } from './core/registry/keybindings'
  import Viewer from './core/viewer/Viewer.svelte'
  import { registerEditCommands } from './core/session/editCommands'
  import { registerViewCommands } from './core/viewer/viewCommands'
  import { ToolRouter } from './core/viewer/toolRouting.svelte'
  import { settings } from './core/settings/settings.svelte'
  import { createThemeSync } from './theme/theme'
  import SettingsDialog from './ui/SettingsDialog.svelte'
  import { fullscreen, registerFullscreenCommands } from './app/fullscreen.svelte'
  import Toolbar from './toolbar/Toolbar.svelte'
  import { activeTool } from './toolbar/activeTool.svelte'
  import { registerToolShortcuts } from './toolbar/toolShortcuts'
  import { activateSelectTool, afterToolUse } from './toolbar/toolLock'
  import { editAnnotations, registerSelectionCommands } from './tools/select/commands'
  import { createEraserHandler } from './tools/eraser'
  import type { Annotation } from './core/session/model'
  import Toast from './ui/Toast.svelte'
  import ContextMenu from './ui/ContextMenu.svelte'
  import { rightClickErases } from './tools/rightClick'
  import { pageFlatten, pageMenuItems, type PageMenuPaste, type PageMenuSelection } from './app/pageMenu'
  import { insertImage } from './app/insertImage'
  import { readClipboardImage, type ClipboardImage } from './core/ipc/clipboard'
  import type { PageMenuPoint } from './core/viewer/viewerMath'
  import DocumentBuilder from './builder/DocumentBuilder.svelte'
  import MergePage from './builder/merge/MergePage.svelte'
  import { MergeFiles } from './builder/merge/mergeFiles.svelte'

  // Hold the right mouse button to erase with the drawing tools; the others
  // (select, lasso, text-selection marker) open the page menu on right-click.
  // Unlocked tools hand over to the select tool after each use.
  const router = new ToolRouter(
    () => activeTool.current,
    () => tabs.active,
    {
      create: createEraserHandler,
      enabledFor: (a) => rightClickErases(a?.def.type, a?.instance.settings),
    },
    {
      afterUse: () => afterToolUse(activeTool.current, settings),
      exit: () => activateSelectTool(settings),
    },
  )

  /** Open page context menu: position (client), 1-based page number and the point clicked on the page. */
  let pageMenu = $state<{ x: number; y: number; page: number; at: PageMenuPoint | null } | null>(null)
  /** The clipboard image read when the page menu opened (enables "Insert image"). */
  let menuImage = $state.raw<ClipboardImage | null>(null)
  let menuToken = 0
  function openPageMenu(page: number, x: number, y: number, at?: PageMenuPoint) {
    pageMenu = { x, y, page: page + 1, at: at ?? null }
    menuImage = null
    const token = ++menuToken
    if (!at) return
    void readClipboardImage().then((img) => {
      if (token === menuToken && pageMenu) menuImage = img
    })
  }
  function closePageMenu() {
    pageMenu = null
    menuImage = null
    menuToken++
  }

  /**
   * The selection actions of the page menu, when the right-click was on the
   * selection (the tool selected what was under the pointer): the selection
   * commands, which act on the active session.
   */
  function menuSelection(session: DocumentSession, page: number, at: PageMenuPoint | null): PageMenuSelection | undefined {
    if (!at?.onSelection) return undefined
    const count = pageFlatten(session, router.stateOf(session).selection, page).selected
    if (count === 0) return undefined
    return {
      count,
      duplicate: () => commands.execute('edit.duplicate'),
      flatten: () => commands.execute('edit.flatten'),
      delete: () => commands.execute('edit.delete'),
    }
  }

  /** "Insert image" of the page menu: the image read at menu open (captured; closing the menu clears it). */
  function menuPaste(session: DocumentSession, page: number, at: PageMenuPoint | null): PageMenuPaste {
    const image = at ? menuImage : null
    return { image, insert: (img) => (at ? pasteImage(session, page, at, img) : undefined) }
  }

  /** "Insert image": pastes `img` where the page was right-clicked; selected if the select tool is active. */
  async function pasteImage(session: DocumentSession, page: number, at: PageMenuPoint, img: ClipboardImage) {
    const a = await insertImage(session, page - 1, at.pdf, at.vp, img, settings.data.author)
    if (activeTool.current?.def.type === 'select' && tabs.active === session) {
      router.stateOf(session).selection = [a.id]
    }
  }
  /** The Document Builder replaces the viewer and toolbar while open (for the active tab). */
  let builderOpen = $state(false)
  $effect(() => {
    if (!tabs.active) builderOpen = false
  })

  function toggleBuilder() {
    if (builderOpen) return closeBuilder()
    tabs.active?.commitPendingEdit()
    closePageMenu()
    builderOpen = true
  }

  /** Back to the viewer, at `page` (1-based) if given. */
  function closeBuilder(page?: number) {
    builderOpen = false
    if (page !== undefined) tabs.active?.goToPage(page)
  }

  /** The merge page opened from the start screen (no document open); null when not shown. */
  let startMerge = $state.raw<MergeFiles | null>(null)
  function openStartMerge() {
    startMerge = new MergeFiles()
  }
  function closeStartMerge() {
    startMerge?.dispose()
    startMerge = null
  }
  // A document opened meanwhile (Ctrl+O) takes over the window.
  $effect(() => {
    if (tabs.active && startMerge) closeStartMerge()
  })

  /** A merge wrote `path`: open it in a tab (the builder or merge page closes). */
  function onMerged(path: string) {
    closeBuilder()
    closeStartMerge()
    void openFiles([path])
  }

  /** The toolbar shows once the persisted layout is loaded (no flash of defaults). */
  let settingsLoaded = $state(false)
  /** The settings dialog (gear button in the status bar, Ctrl+,). */
  let settingsOpen = $state(false)

  // Dark until the stored theme is loaded (the default); a change applies at once.
  const themeSync = createThemeSync(document.documentElement, () => settings.data.preferences.theme)
  $effect(() => themeSync.apply())

  /** A style edit from the selection bar's Style card, on the active tab. */
  function editStyle(afters: Annotation[]) {
    if (tabs.active) void editAnnotations(tabs.active, afters)
  }

  function closeActive() {
    if (tabs.activeId) return tabs.close(tabs.activeId)
  }

  $effect(() => {
    const title = tabs.active ? `${tabs.active.fileName} — JuliePDF` : 'JuliePDF'
    getCurrentWindow().setTitle(title).catch(console.error)
  })

  function onKeydown(e: KeyboardEvent) {
    handleKey(e)
    // Escape always ends in the select tool, after the active tool and the
    // Escape commands had their turn (a polyline is dropped, the selection
    // cleared). Popups and the text editor consume their Escape before it
    // gets here (as do the builder's); the editor hands over itself (TextEdit.escape).
    if (e.key === 'Escape') {
      activateSelectTool(settings)
    }
  }

  function handleKey(e: KeyboardEvent) {
    const t = e.target
    const editable = t instanceof HTMLElement && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    // The active tool first (e.g. Enter finishes a polyline, Escape drops it).
    if (!editable && !e.defaultPrevented && router.handler?.onKeyDown?.(e)) {
      e.preventDefault()
      return
    }
    if (keybindings.handle(e)) e.preventDefault()
  }

  /** Window close: Save / Don't save / Cancel for each dirty tab, then flush settings. */
  function guardWindowClose(): () => void {
    const win = getCurrentWindow()
    let closing = false
    let disposed = false
    let unlisten: (() => void) | null = null
    void win
      .onCloseRequested(async (e) => {
        e.preventDefault()
        if (closing) return
        closing = true
        try {
          if (!(await confirmCloseAll(tabs.sessions))) return
          await settings.flush()
          await win.destroy()
        } finally {
          closing = false
        }
      })
      .then((un) => (disposed ? un() : (unlisten = un)))
    return () => {
      disposed = true
      unlisten?.()
    }
  }

  onMount(() => {
    void settings.load().finally(() => (settingsLoaded = true))
    const disposeCloseGuard = guardWindowClose()
    const stopRouter = router.start()
    // Tool modules register at import time (before App mounts).
    const disposeToolShortcuts = registerToolShortcuts()
    const disposePageZoomGuard = guardPageZoom(window)
    const disposeOpening = initFileOpening(async (path) => {
      const existing = tabs.findByPath(path)
      if (existing) tabs.activeId = existing.id
      else tabs.add(await DocumentSession.open(path))
    })
    const disposeCommand = commands.register({
      id: 'file.open',
      title: 'Open PDF…',
      run: pickAndOpen,
    })
    const disposeKey = keybindings.bind('Ctrl+O', 'file.open')
    const disposeSettings = [
      commands.register({
        id: 'app.settings',
        title: 'Settings',
        run: () => {
          closePageMenu()
          settingsOpen = true
        },
      }),
      keybindings.bind('Ctrl+,', 'app.settings'),
    ]
    const tabCommands = [
      { id: 'tab.close', title: 'Close tab', chord: 'Ctrl+W', run: () => closeActive() },
      { id: 'tab.next', title: 'Next tab', chord: 'Ctrl+Tab', run: () => tabs.next() },
      { id: 'tab.prev', title: 'Previous tab', chord: 'Ctrl+Shift+Tab', run: () => tabs.prev() },
    ]
    const disposeTabs = tabCommands.flatMap((c) => [
      commands.register({
        id: c.id,
        title: c.title,
        run: c.run,
        enabled: () => tabs.active !== null,
      }),
      keybindings.bind(c.chord, c.id),
    ])
    const disposeView = registerViewCommands(() => tabs.active)
    const disposeEdit = registerEditCommands(() => tabs.active)
    const disposeSave = registerSaveCommands(() => tabs.active)
    const disposeSelection = registerSelectionCommands(() =>
      tabs.active ? { session: tabs.active, state: router.stateOf(tabs.active) } : null,
    )
    // After the selection commands: Escape deselects before it leaves fullscreen.
    const disposeFullscreen = registerFullscreenCommands()
    fullscreen.anchor = () => tabs.active?.anchorView() ?? null
    const stopFullscreenSync = fullscreen.start()
    return () => {
      stopFullscreenSync()
      fullscreen.anchor = null
      disposeFullscreen()
      disposeSelection()
      disposeSave()
      disposeCloseGuard()
      disposeToolShortcuts()
      stopRouter()
      disposeEdit()
      disposeView()
      disposeTabs.forEach((d) => d())
      disposeKey()
      disposeSettings.forEach((d) => d())
      themeSync.dispose()
      disposeCommand()
      disposeOpening()
      disposePageZoomGuard()
    }
  })
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet mergeTitle()}
  <h1 class="merge-title">Merge PDFs</h1>
{/snippet}

<div class="shell" class:fullscreen={fullscreen.active} class:building={(builderOpen && tabs.active) || (startMerge && !tabs.active)}>
  <div class="titlebar-region"><TitleBar /></div>
  <main class="viewer-region">
    {#if tabs.active && builderOpen}
      {#key tabs.active.id}
        <DocumentBuilder session={tabs.active} onclose={closeBuilder} onmerged={onMerged} />
      {/key}
    {:else if tabs.active}
      {#key tabs.active.id}
        <Viewer
          session={tabs.active}
          tool={router.handler}
          eraser={router.eraser}
          cursor={router.cursor}
          toolPreview={router.stateOf(tabs.active).preview}
          toolPagePreviews={router.stateOf(tabs.active).pagePreviews}
          toolLasso={router.stateOf(tabs.active).lasso}
          toolHidden={router.stateOf(tabs.active).hidden}
          toolTextEdit={router.stateOf(tabs.active).textEdit}
          toolSelection={router.stateOf(tabs.active).selection}
          crossDrag={router.stateOf(tabs.active).crossDrag}
          frames={router.stateOf(tabs.active).frames}
          onpagemenu={openPageMenu}
          onstyle={editStyle}
        />
      {/key}
    {:else if startMerge}
      <MergePage files={startMerge} heading={mergeTitle} onclose={closeStartMerge} onmerged={onMerged} />
    {:else}
      <EmptyState onOpen={pickAndOpen} onMerge={openStartMerge} />
    {/if}
  </main>
  <aside class="toolbar-region">
    {#if settingsLoaded}<Toolbar />{/if}
  </aside>
  <div class="statusbar-region">
    <StatusBar session={tabs.active} {builderOpen} ontogglebuilder={toggleBuilder} />
  </div>
</div>
<ConfirmClose />
{#if settingsOpen}
  <SettingsDialog store={settings} onclose={() => (settingsOpen = false)} />
{/if}
<Toast />
{#if pageMenu && tabs.active}
  <ContextMenu
    x={pageMenu.x}
    y={pageMenu.y}
    items={pageMenuItems(
      pageMenu.page,
      tabs.active,
      menuPaste(tabs.active, pageMenu.page, pageMenu.at),
      pageFlatten(tabs.active, router.stateOf(tabs.active).selection, pageMenu.page),
      menuSelection(tabs.active, pageMenu.page, pageMenu.at),
    )}
    onclose={closePageMenu}
  />
{/if}

<style>
  .shell {
    display: grid;
    grid-template-rows: var(--titlebar-h) 1fr var(--statusbar-h);
    grid-template-columns: 1fr var(--toolstrip-w);
    height: 100vh;
    background: var(--bg);
  }
  /* Fullscreen: only the viewer remains (the chrome stays mounted, just hidden). */
  .shell.fullscreen {
    grid-template-rows: 1fr;
    grid-template-columns: 1fr;
  }
  .shell.fullscreen .titlebar-region,
  .shell.fullscreen .toolbar-region,
  .shell.fullscreen .statusbar-region {
    display: none;
  }
  .titlebar-region {
    grid-column: 1 / -1;
  }
  /* Document Builder: it takes the viewer's and the toolbar's place. */
  .shell.building .viewer-region {
    grid-column: 1 / -1;
  }
  .shell.building .toolbar-region {
    display: none;
  }
  .merge-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }
  .viewer-region {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .toolbar-region {
    min-height: 0;
    background: var(--bg-deep);
    border-left: 1px solid var(--border);
  }
  .statusbar-region {
    grid-column: 1 / -1;
  }
</style>

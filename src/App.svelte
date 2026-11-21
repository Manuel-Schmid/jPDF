<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { initFileOpening, openFiles, openRecentFile, pickAndOpen } from './app/fileOpening'
  import { guardPageZoom } from './app/pageZoomGuard'
  import { guardBrowserBehavior } from './app/browserGuard'
  import ConfirmClose from './app/ConfirmClose.svelte'
  import RestorePrompt, { askToRestore } from './app/RestorePrompt.svelte'
  import { recovery, restoreRecovered, trackPointerDown } from './app/recovery.svelte'
  import { deleteRecovery, fileStamp, listRecovery, readRecoveryImage } from './core/ipc/api'
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
  import { find, registerFindCommands } from './app/find.svelte'
  import { ToolRouter } from './core/viewer/toolRouting.svelte'
  import { settings } from './core/settings/settings.svelte'
  import { createThemeSync } from './theme/theme'
  import SettingsDialog from './ui/SettingsDialog.svelte'
  import { fullscreen, registerFullscreenCommands } from './app/fullscreen.svelte'
  import { rememberWindowState } from './app/windowState'
  import { rememberView, restoreAfterResize, restoreView } from './app/keepView'
  import type { ToolbarPosition } from './core/settings/preferences'
  import { shellLayout } from './toolbar/placement'
  import Toolbar from './toolbar/Toolbar.svelte'
  import { activeTool } from './toolbar/activeTool.svelte'
  import { registerToolShortcuts } from './toolbar/toolShortcuts'
  import { activateSelectTool, afterToolUse } from './toolbar/toolLock'
  import { editAnnotations, registerSelectionCommands, Z_ORDER_COMMANDS } from './tools/select/commands'
  import type { ZOrder } from './core/session/commands'
  import { createEraserHandler } from './tools/eraser'
  import type { Annotation, Point } from './core/session/model'
  import Toast from './ui/Toast.svelte'
  import ContextMenu from './ui/ContextMenu.svelte'
  import { rightClickErases } from './tools/rightClick'
  import { pageFlatten, pageMenuItems, type PageMenuPaste, type PageMenuSelection } from './app/pageMenu'
  import { insertImage } from './app/insertImage'
  import { readClipboardImage, readClipboardText, writeClipboardText, type ClipboardImage } from './core/ipc/clipboard'
  import { registerClipboardCommands, spotAt, type ClipboardTarget } from './tools/select/clipboard'
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
      restack: (how) => commands.execute(zOrderCommand(how)),
      canRestack: (how) => commands.canExecute(zOrderCommand(how)),
      flatten: () => commands.execute('edit.flatten'),
      delete: () => commands.execute('edit.delete'),
    }
  }

  /** The selection command that restacks `how`. */
  function zOrderCommand(how: ZOrder): string {
    return Z_ORDER_COMMANDS.find((c) => c.how === how)!.id
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
  /** The pointer's last client position in the window (null once it left): where Ctrl+V pastes. Not reactive. */
  let pointerClient: Point | null = null
  function trackPointer(): () => void {
    const move = (e: PointerEvent) => (pointerClient = [e.clientX, e.clientY])
    const leave = () => (pointerClient = null)
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
    }
  }

  /** Copy / cut / paste on the active tab: pastes land on the page under the pointer, else the visible page. */
  function clipboardTarget(session: DocumentSession): ClipboardTarget {
    const state = router.stateOf(session)
    return {
      session,
      state,
      pasteSpot: () => spotAt(state.frames, pointerClient, session.currentPage - 1),
      select: (ids) => {
        if (activeTool.current?.def.type === 'select') state.selection = ids
      },
      pasteImage: (spot, img) => {
        const at = spot.at ?? spot.vp.convertToPdfPoint(spot.vp.width / 2, spot.vp.height / 2)
        return pasteImage(session, spot.page + 1, { pdf: [at[0], at[1]], vp: spot.vp }, img)
      },
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

  /** Where the toolbar sits (Settings → Toolbar position); the shell grid follows. */
  const toolbarPosition = $derived(settings.data.preferences.toolbarPosition)
  const building = $derived(!!((builderOpen && tabs.active) || (startMerge && !tabs.active)))
  const layout = $derived(shellLayout(toolbarPosition, { fullscreen: fullscreen.active, building }))

  // Moving the toolbar resizes the page area once, like resizing the window:
  // keep the current page and zoom in place across it. Runs before the DOM
  // update, so the anchor is taken at the old size.
  let shownPosition: ToolbarPosition | undefined
  $effect.pre(() => {
    const position = toolbarPosition
    if (shownPosition !== undefined && position !== shownPosition) {
      const anchor = untrack(() => tabs.active?.anchorView())
      if (anchor) void restoreAfterResize(anchor)
    }
    shownPosition = position
  })

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

  /** Window close: Save / Don't save / Cancel for each dirty tab, then save the window state and flush settings. */
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
          // Every tab was saved or its changes discarded: no snapshot is needed.
          await recovery.forgetAll()
          for (const s of tabs.sessions) rememberView(settings, s)
          await rememberWindowState(settings)
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
    // A file opened at launch waits for the settings: they hold its remembered view.
    const settingsReady = settings.load().finally(() => (settingsLoaded = true))
    const disposeCloseGuard = guardWindowClose()
    const stopRouter = router.start()
    // Tool modules register at import time (before App mounts).
    const disposeToolShortcuts = registerToolShortcuts()
    const disposePageZoomGuard = guardPageZoom(window)
    const disposeBrowserGuard = guardBrowserBehavior(window)
    const openTab = async (path: string) => {
      const existing = tabs.findByPath(path)
      if (existing) tabs.activeId = existing.id
      else {
        const [s] = await Promise.all([DocumentSession.open(path), settingsReady])
        restoreView(settings, s)
        tabs.add(s)
      }
      // After the load, which would replace the list.
      await settingsReady
      settings.addRecentFile(path)
      return tabs.findByPath(path)
    }
    const disposeOpening = initFileOpening(async (path) => void (await openTab(path)))
    // Crash recovery: snapshots of dirty tabs (written off the drawing path),
    // and the snapshots a crashed run left, offered back.
    const pointer = trackPointerDown(window)
    recovery.busy = pointer.down
    const stopRecovery = recovery.watch(() => tabs.sessions)
    void restoreRecovered({
      list: listRecovery,
      stamp: fileStamp,
      readImage: readRecoveryImage,
      remove: deleteRecovery,
      ask: askToRestore,
      open: async (path) => {
        const s = await openTab(path)
        if (!s) throw new Error(`Could not open ${path}`)
        return s
      },
      flush: (s) => recovery.flush(s),
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
    const stopFind = find.start()
    const disposeFind = registerFindCommands(find, () => tabs.active !== null)
    const disposeEdit = registerEditCommands(() => tabs.active)
    const disposeSave = registerSaveCommands(() => tabs.active)
    const disposeSelection = registerSelectionCommands(() =>
      tabs.active ? { session: tabs.active, state: router.stateOf(tabs.active) } : null,
    )
    const stopPointer = trackPointer()
    const disposeClipboard = registerClipboardCommands(() => (tabs.active ? clipboardTarget(tabs.active) : null), {
      writeText: writeClipboardText,
      readText: readClipboardText,
      readImage: readClipboardImage,
    })
    // After the selection commands: Escape deselects before it leaves fullscreen.
    const disposeFullscreen = registerFullscreenCommands()
    fullscreen.anchor = () => tabs.active?.anchorView() ?? null
    const stopFullscreenSync = fullscreen.start()
    return () => {
      stopFullscreenSync()
      fullscreen.anchor = null
      disposeFullscreen()
      disposeClipboard()
      stopPointer()
      disposeSelection()
      disposeSave()
      disposeCloseGuard()
      disposeToolShortcuts()
      stopRouter()
      disposeEdit()
      disposeView()
      disposeFind()
      stopFind()
      disposeTabs.forEach((d) => d())
      disposeKey()
      disposeSettings.forEach((d) => d())
      themeSync.dispose()
      disposeCommand()
      disposeOpening()
      stopRecovery()
      pointer.dispose()
      disposePageZoomGuard()
      disposeBrowserGuard()
    }
  })
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet mergeTitle()}
  <h1 class="merge-title">Merge PDFs</h1>
{/snippet}

<div
  class="shell"
  class:fullscreen={fullscreen.active}
  class:building
  data-toolbar={toolbarPosition}
  style:grid-template-areas={layout.areas}
  style:grid-template-rows={layout.rows}
  style:grid-template-columns={layout.columns}
>
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
          penEraser={router.penEraser}
          cursor={router.cursor}
          toolPreview={router.stateOf(tabs.active).preview}
          toolPagePreviews={router.stateOf(tabs.active).pagePreviews}
          toolLasso={router.stateOf(tabs.active).lasso}
          toolHidden={router.stateOf(tabs.active).hidden}
          toolTextEdit={router.stateOf(tabs.active).textEdit}
          toolSelection={router.stateOf(tabs.active).selection}
          crossDrag={router.stateOf(tabs.active).crossDrag}
          toolHint={router.stateOf(tabs.active).hint}
          frames={router.stateOf(tabs.active).frames}
          onpagemenu={openPageMenu}
          onstyle={editStyle}
          search={find.viewFor(tabs.active)}
        />
      {/key}
    {:else if startMerge}
      <MergePage files={startMerge} heading={mergeTitle} onclose={closeStartMerge} onmerged={onMerged} />
    {:else}
      <EmptyState
        onOpen={pickAndOpen}
        onMerge={openStartMerge}
        recent={settings.data.recent}
        onOpenRecent={(path) => void openRecentFile(path, (p) => settings.removeRecentFile(p))}
        onRemoveRecent={(path) => settings.removeRecentFile(path)}
      />
    {/if}
  </main>
  <aside class="toolbar-region">
    {#if settingsLoaded}<Toolbar />{/if}
  </aside>
  <div class="statusbar-region">
    <StatusBar session={tabs.active} {builderOpen} ontogglebuilder={toggleBuilder} />
  </div>
  <!-- Inside the shell (it is fixed-positioned) so it can sit above a bottom toolbar. -->
  <Toast />
</div>
<ConfirmClose />
<RestorePrompt />
{#if settingsOpen}
  <SettingsDialog store={settings} onclose={() => (settingsOpen = false)} />
{/if}
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
  /* The grid's areas and tracks come from shellLayout (toolbar position, fullscreen, builder). */
  .shell {
    display: grid;
    height: 100vh;
    background: var(--bg);
  }
  /* Toasts stay clear of a toolbar at the bottom edge. */
  .shell[data-toolbar='bottom']:not(.fullscreen, .building) {
    --toast-lift: var(--toolstrip-w);
  }
  /* Fullscreen: only the viewer remains (the chrome stays mounted, just hidden). */
  .shell.fullscreen .titlebar-region,
  .shell.fullscreen .toolbar-region,
  .shell.fullscreen .statusbar-region {
    display: none;
  }
  .titlebar-region {
    grid-area: title;
  }
  /* Document Builder: it takes the viewer's and the toolbar's place. */
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
    grid-area: viewer;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .toolbar-region {
    grid-area: tools;
    min-width: 0;
    min-height: 0;
    background: var(--bg-deep);
  }
  /* A border on the side facing the page area. */
  .shell[data-toolbar='right'] .toolbar-region {
    border-left: 1px solid var(--border);
  }
  .shell[data-toolbar='left'] .toolbar-region {
    border-right: 1px solid var(--border);
  }
  .shell[data-toolbar='top'] .toolbar-region {
    border-bottom: 1px solid var(--border);
  }
  .shell[data-toolbar='bottom'] .toolbar-region {
    border-top: 1px solid var(--border);
  }
  .statusbar-region {
    grid-area: status;
  }
</style>

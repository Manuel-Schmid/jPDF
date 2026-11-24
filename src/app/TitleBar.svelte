<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { find } from './find.svelte'
  import Logo from './Logo.svelte'
  import SearchBox from './SearchBox.svelte'
  import { tabs } from './tabs.svelte'
  import TabBar from './TabBar.svelte'
  import WindowControls from './WindowControls.svelte'
</script>

<header class="titlebar">
  <div class="logo-slot"><Logo size="sm" /></div>
  <TabBar />
  <div
    class="drag"
    data-tauri-drag-region
    role="presentation"
    ondblclick={() => getCurrentWindow().toggleMaximize()}
  ></div>
  <div class="end">
    {#if tabs.active}<SearchBox {find} />{/if}
    <WindowControls />
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    height: 100%;
    background: var(--bg-deep);
    border-bottom: 1px solid var(--border);
    user-select: none;
  }
  .logo-slot {
    flex: none;
    padding: 0 12px;
    display: flex;
    align-items: center;
  }
  /* Grows into the free space but never below 48px, so the window can
     always be moved and double-clicked however many tabs are open. */
  .drag {
    flex: 1 0 48px;
    height: 100%;
  }
  /* The search box and window controls never shrink; the tabs give way. */
  .end {
    display: flex;
    align-items: center;
    flex: none;
    height: 100%;
  }
</style>

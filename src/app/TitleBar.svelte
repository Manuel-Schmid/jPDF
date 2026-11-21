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
  {#if tabs.active}<SearchBox {find} />{/if}
  <WindowControls />
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
    padding: 0 12px;
    display: flex;
    align-items: center;
  }
  .drag {
    flex: 1;
    height: 100%;
  }
</style>

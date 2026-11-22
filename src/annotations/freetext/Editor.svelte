<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { PageViewport } from 'pdfjs-dist'
  import type { TextEdit } from '../../core/registry/tools'
  import { PLACEHOLDER, TEXT_PADDING } from '../../core/geometry/textLayout'
  import { rotateScreenPoint } from '../../core/geometry/rotation'
  import { cssColor, editorInsets, FREETEXT_FONT, screenBox } from './screen'

  let { edit, vp }: { edit: TextEdit; vp: PageViewport } = $props()

  let el: HTMLTextAreaElement
  const a = $derived(edit.draft)
  const box = $derived(screenBox(a.rect, vp))
  const s = $derived(vp.scale)
  const insets = $derived(editorInsets(a.fontSize, s))
  const turn = $derived(a.rotation ?? 0)
  /**
   * The box's top-left corner on screen, turned with a turned box: the
   * textarea hangs from it and turns around it, so it grows downwards along
   * the box's own side while typing, as the committed box does.
   */
  const corner = $derived(
    rotateScreenPoint([box.left, box.top], [box.left + box.width / 2, box.top + box.height / 2], turn),
  )
  // Starts at the box top even when the textarea is lifted above it.
  const background = $derived.by(() => {
    if (!a.background) return 'transparent'
    const fill = `rgba(${a.background.color.map((v) => Math.round(v * 255)).join(',')},${a.background.opacity})`
    const off = insets.offsetTop
    return off > 0 ? `linear-gradient(transparent ${off}px, ${fill} ${off}px)` : fill
  })

  /** Grows the textarea with its content (never below one line). */
  function grow() {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  function onInput() {
    edit.setText(el.value)
    grow()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Escape also ends in the select tool, as it does outside the editor.
      if (edit.escape) edit.escape()
      else edit.commit()
      return
    }
    // Text editing chords stay in the textarea (native undo, select all);
    // other chords (Ctrl+S, …) reach the app, which commits first.
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y' || k === 'a')) e.stopPropagation()
  }

  onMount(() => {
    el.value = a.text
    grow()
  })

  // The box may widen (or narrow) while typing: re-fit the height to the new wrapping.
  $effect(() => {
    void box.width
    grow()
  })

  // Focused once the box is placed (right away when not sizing): while its
  // width is being dragged out, the pointer still belongs to the page.
  $effect(() => {
    if (edit.sizing || document.activeElement === el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  })

  // Scrolled out of the virtualised page range: keep what was typed.
  onDestroy(() => edit.commit())
</script>

<textarea
  bind:this={el}
  class="freetext-editor"
  class:sizing={edit.sizing}
  aria-label="Text box"
  placeholder={PLACEHOLDER}
  spellcheck="false"
  rows="1"
  style:left="{corner[0]}px"
  style:top="{corner[1] - insets.offsetTop}px"
  style:transform={turn ? `rotate(${-turn}deg)` : undefined}
  style:transform-origin={turn ? `0 ${insets.offsetTop}px` : undefined}
  style:width="{box.width}px"
  style:min-height="{insets.minHeight}px"
  style:padding="{insets.paddingTop}px {TEXT_PADDING * s}px {insets.paddingBottom}px"
  style:font-family={FREETEXT_FONT}
  style:font-size="{a.fontSize * s}px"
  style:color={cssColor(a.textColor)}
  style:text-align={a.align}
  style:background
  oninput={onInput}
  onkeydown={onKeydown}
  onblur={() => edit.commit()}
></textarea>

<style>
  .freetext-editor {
    position: absolute;
    box-sizing: border-box;
    margin: 0;
    border: none;
    outline: 1px dashed var(--page-accent);
    resize: none;
    overflow: hidden;
    line-height: 1.2;
    /* Break like wrapText: at spaces (hanging), after hyphens, long words anywhere. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    hyphens: manual;
    /* Typing, not drawing: no tool gestures from inside the box. */
    touch-action: auto;
    pointer-events: auto;
  }
  .freetext-editor.sizing {
    pointer-events: none;
  }
  /* Grey on both light and dark pages, whatever the text colour. */
  .freetext-editor::placeholder {
    color: rgba(128, 128, 128, 0.75);
    opacity: 1;
  }
</style>

import type { ScreenRect } from '../../core/geometry/quads'
import { autoScrollArmed, autoScrollSpeed } from '../../core/viewer/autoScroll'
import type { TextLayerPage } from '../../core/viewer/textLayers'
import {
  caretOffset,
  focusLine,
  groupLines,
  nearestSpan,
  spanAt,
  type LineSpan,
  type LocalPoint,
  type TextLine,
} from './textLines'

/**
 * Dragging out a text selection for the text markup tools, instead of the
 * browser's native selection: a press near text (not only on a glyph)
 * starts at the nearest character, and a drag that strays a little
 * above/below the line keeps selecting that line (see focusLine).
 */

/** How far (px) above/below a text span a press still starts a selection. */
export const START_TOLERANCE_PX = 8
/** Beside the text (before the first glyph, after the last) a press reaches further (px). */
export const START_TOLERANCE_X_PX = 12
/** How far above/below its line the pointer may stray: half the line height, at least this (px). */
const BAND_MIN_PX = 4
const BAND_RATIO = 0.5

/** A text layer's lines (spans → text nodes) in its page-local frame, and its zoom. */
interface LayerIndex {
  lines: TextLine<Text>[]
  /** Screen px per local unit (PDF point), for tolerances given in px. */
  pxPerUnit: number
}

/**
 * Indexes per rendered text layer: keyed by the layer's content element,
 * which is replaced when the layer re-renders (zoom), so a stale index is
 * never used. Local coordinates are not affected by scrolling.
 */
const indexes = new WeakMap<Element, LayerIndex>()

function toLocal(info: TextLayerPage, clientX: number, clientY: number): LocalPoint {
  const [x, y] = info.toPdf(clientX, clientY)
  return { x, y: -y }
}

function localBox(info: TextLayerPage, r: ScreenRect): ScreenRect {
  // Page rotations are multiples of 90°, so opposite corners give the box.
  const a = toLocal(info, r.left, r.top)
  const b = toLocal(info, r.right, r.bottom)
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  }
}

/** One layout read per span, once per rendered layer (cached until it re-renders). */
function indexOf(el: Element, info: TextLayerPage): LayerIndex {
  const key = el.firstElementChild ?? el
  const cached = indexes.get(key)
  if (cached) return cached
  const spans: LineSpan<Text>[] = []
  for (const span of el.querySelectorAll('span')) {
    const text = span.firstChild
    if (!(text instanceof Text) || span.childElementCount > 0 || text.data.trim() === '') continue
    const r = span.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    spans.push({ box: localBox(info, r), item: text })
  }
  const host = el.getBoundingClientRect()
  const page = localBox(info, host)
  const area = (page.right - page.left) * (page.bottom - page.top)
  const pxPerUnit = area > 0 ? Math.sqrt((host.width * host.height) / area) : 1
  const index = { lines: groupLines(spans), pxPerUnit }
  indexes.set(key, index)
  return index
}

interface Caret {
  node: Text
  offset: number
}

/** Centre x (local) of character i of `node`. */
function charCentre(info: TextLayerPage, node: Text, i: number): number {
  const range = document.createRange()
  range.setStart(node, i)
  range.setEnd(node, i + 1)
  const r = range.getBoundingClientRect()
  const b = localBox(info, r)
  return (b.left + b.right) / 2
}

/** The caret on `line` nearest to x: at a span's edge, or between its characters. */
function caretOnLine(info: TextLayerPage, line: TextLine<Text>, x: number): Caret {
  const { span, edge } = spanAt(line, x)
  const node = span.item
  if (edge === 'start') return { node, offset: 0 }
  if (edge === 'end') return { node, offset: node.length }
  return { node, offset: caretOffset(node.length, (i) => charCentre(info, node, i), x) }
}

/** A text layer the drag is on: its element, page mapping, index and focus line. */
interface DragLayer {
  el: Element
  info: TextLayerPage
  index: LayerIndex
  line: number
}

/** The nearest scrollable ancestor (the viewer), which a drag at its edge scrolls. */
function scrollerOf(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight)
      return p
  }
  return null
}

/** A text selection being dragged out; `end` applies the final position and stops it. */
export interface TextDrag {
  end(clientX?: number, clientY?: number): void
}

/**
 * Starts a drag for a press at the pointer of `e` in text layer `el`, if it
 * is within reach of text (START_TOLERANCE_X_PX beside it, START_TOLERANCE_PX
 * above/below): the press is taken over (no native selection, which would
 * start only on a glyph and jump between lines), the selection collapses to
 * the nearest character, and pointer moves extend it, at most once per frame. Near the scroller's top/bottom edge it scrolls.
 * `layers` are the mounted text layers, where the drag may continue.
 */
export function startTextDrag(
  e: PointerEvent,
  el: Element,
  info: TextLayerPage,
  layers: () => Iterable<[Element, TextLayerPage]>,
): TextDrag | null {
  const index = indexOf(el, info)
  const p = toLocal(info, e.clientX, e.clientY)
  const hit = nearestSpan(index.lines, p, {
    x: START_TOLERANCE_X_PX / index.pxPerUnit,
    y: START_TOLERANCE_PX / index.pxPerUnit,
  })
  const sel = window.getSelection()
  if (!hit || !sel) return null
  e.preventDefault()
  const anchor = caretOnLine(info, index.lines[hit.line], p.x)
  let focus: DragLayer = { el, info, index, line: hit.line }
  let last: Caret = anchor
  sel.setBaseAndExtent(anchor.node, anchor.offset, anchor.node, anchor.offset)

  let pointer = { x: e.clientX, y: e.clientY }
  let dirty = false
  let armed = false
  const startY = e.clientY
  const scroller = scrollerOf(el)

  /** The layer under the pointer (mounted pages only), else the one it was on. */
  function layerAt(x: number, y: number): DragLayer {
    for (const [l, i] of layers()) {
      if (l === focus.el) continue
      const r = l.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const idx = indexOf(l, i)
        if (idx.lines.length === 0) break
        // Entering from above or below: start on its nearest line.
        return { el: l, info: i, index: idx, line: -1 }
      }
    }
    return focus
  }

  function apply() {
    dirty = false
    if (!anchor.node.isConnected) return
    focus = layerAt(pointer.x, pointer.y)
    const { info: fi, index: fx } = focus
    const q = toLocal(fi, pointer.x, pointer.y)
    const band = { ratio: BAND_RATIO, min: BAND_MIN_PX / fx.pxPerUnit }
    focus.line = focusLine(fx.lines, focus.line, q, band)
    const caret = caretOnLine(fi, fx.lines[focus.line], q.x)
    if (caret.node === last.node && caret.offset === last.offset) return
    last = caret
    sel!.setBaseAndExtent(anchor.node, anchor.offset, caret.node, caret.offset)
  }

  let frame = requestAnimationFrame(function step() {
    if (scroller) {
      const r = scroller.getBoundingClientRect()
      armed ||= autoScrollArmed(startY, pointer.y, r.top, r.bottom)
      const speed = armed ? autoScrollSpeed(pointer.y, r.top, r.bottom) : 0
      if (speed !== 0) {
        scroller.scrollTop += speed
        dirty = true
      }
    }
    if (dirty) apply()
    frame = requestAnimationFrame(step)
  })
  const onMove = (m: PointerEvent) => {
    if (m.pointerId !== e.pointerId) return
    pointer = { x: m.clientX, y: m.clientY }
    dirty = true
  }
  // A wheel scroll during the drag moves the text under a still pointer.
  const onScroll = () => {
    dirty = true
  }
  // Cancelling pointerdown alone may still let the press's mousedown start a
  // native selection (or drag the selected text away): the drag owns it.
  const block = (ev: Event) => ev.preventDefault()
  const BLOCKED = ['mousedown', 'selectstart', 'dragstart'] as const
  window.addEventListener('pointermove', onMove, true)
  for (const t of BLOCKED) window.addEventListener(t, block, true)
  scroller?.addEventListener('scroll', onScroll)

  return {
    end(x, y) {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove, true)
      for (const t of BLOCKED) window.removeEventListener(t, block, true)
      scroller?.removeEventListener('scroll', onScroll)
      if (x !== undefined && y !== undefined) {
        pointer = { x, y }
        dirty = true
      }
      if (dirty) apply()
    },
  }
}

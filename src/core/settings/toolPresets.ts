import type { RGB } from '../session/model'

/** One toolbar slot of a preset: a saved `ToolInstance` without its id. */
export interface PresetTool {
  type: string
  settings: unknown
  locked?: boolean
}

/**
 * A ready-made toolbar, picked in the settings dialog. A preset has the same
 * shape as the saved toolbar in settings.json (minus the instance ids, which
 * are made fresh when it is applied), so a future preset file (#25) can use
 * this shape as it is.
 */
export interface ToolPreset {
  id: string
  name: string
  description: string
  toolbar: PresetTool[]
}

const BLACK: RGB = [0, 0, 0]
const WHITE: RGB = [1, 1, 1]
const RED: RGB = [0.898, 0.224, 0.208] // #E53935, the pen's red
const BLUE: RGB = [0.118, 0.533, 0.898] // #1E88E5, the pen's blue

// Highlighter colours: bright, so the text stays readable under them.
const HL_YELLOW: RGB = [1, 0.922, 0.231] // #FFEB3B
const HL_GREEN: RGB = [0.463, 1, 0.012] // #76FF03
const HL_CYAN: RGB = [0.094, 1, 1] // #18FFFF
const HL_BLUE: RGB = [0.251, 0.769, 1] // #40C4FF
const HL_PINK: RGB = [1, 0.251, 0.506] // #FF4081

/** Small text: smaller than the text tool's default 12 pt, for notes in margins. */
const SMALL_TEXT = 10

const select: PresetTool = { type: 'select', settings: {} }
const lasso: PresetTool = { type: 'lasso', settings: {} }
const eraser: PresetTool = { type: 'eraser', settings: {} }

const marker = (color: RGB): PresetTool => ({ type: 'marker', settings: { mode: 'text', color, opacity: 1, width: 12 } })
const pen = (color: RGB, width = 1.5): PresetTool => ({ type: 'pen', settings: { color, width, opacity: 1 } })
const text = (textColor: RGB, fontSize: number, background: RGB | null = null): PresetTool => ({
  type: 'text',
  settings: { textColor, fontSize, background: background && { color: background, opacity: 1 }, align: 'left' },
})
const outlined = (shape: 'rect' | 'circle' | 'line' | 'arrow', color: RGB): PresetTool => ({
  type: 'shape',
  settings: { shape, border: { color, width: 2, opacity: 1 }, fill: null },
})
/** A borderless opaque rectangle: covers (whites out) part of a page. */
const filledRect = (color: RGB): PresetTool => ({
  type: 'shape',
  settings: { shape: 'rect', border: null, fill: { color, opacity: 1 } },
})

/**
 * The built-in presets, in the order the settings dialog lists them. Every
 * preset keeps a Select tool (the toolbar must have one); a test checks that
 * each slot's settings fit its tool.
 */
export const TOOL_PRESETS: readonly ToolPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'The toolbar of a fresh install',
    toolbar: [select, lasso, eraser, marker(HL_YELLOW), pen(RED), outlined('rect', RED), text(BLACK, 12)],
  },
  {
    id: 'lecture-notes',
    name: 'Taking lecture notes',
    description: 'Notes, pens, highlighters and white-out',
    toolbar: [
      select,
      text(BLUE, SMALL_TEXT),
      text(BLACK, SMALL_TEXT, WHITE),
      pen(BLACK),
      pen(RED),
      marker(HL_CYAN),
      marker(HL_BLUE),
      marker(HL_GREEN),
      marker(HL_PINK),
      marker(HL_YELLOW),
      outlined('rect', RED),
      filledRect(WHITE),
    ],
  },
  {
    id: 'proofreading',
    name: 'Proofreading',
    description: 'Strike out, underline, red corrections and comments',
    toolbar: [
      select,
      { type: 'strikeout', settings: { color: RED } },
      { type: 'underline', settings: { color: BLUE } },
      marker(HL_YELLOW),
      text(RED, SMALL_TEXT),
      pen(RED),
      outlined('rect', RED),
      eraser,
    ],
  },
  {
    id: 'sketching',
    name: 'Sketching and diagrams',
    description: 'Pens in three colours, shapes, arrows and labels',
    toolbar: [
      select,
      lasso,
      pen(BLACK),
      pen(RED),
      pen(BLUE),
      outlined('rect', BLACK),
      outlined('circle', BLACK),
      outlined('arrow', RED),
      text(BLACK, 12),
      eraser,
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Highlighter, pen and text only',
    toolbar: [select, marker(HL_YELLOW), pen(BLACK), text(BLACK, 12), eraser],
  },
]

/** A deep copy of a preset slot's settings, so instances never share (and mutate) the preset's objects. */
export function presetSettings(t: PresetTool): unknown {
  return JSON.parse(JSON.stringify(t.settings))
}

/**
 * Whether a toolbar is exactly the preset: the same tools in the same order
 * with the same settings and locks (ids ignored). The dialog marks such a
 * preset as the current one; any later change to the toolbar unmarks it.
 */
export function matchesPreset(
  toolbar: readonly { type: string; settings: unknown; locked?: boolean }[],
  preset: ToolPreset,
): boolean {
  return toolbar.length === preset.toolbar.length && toolbar.every((t, i) => {
    const p = preset.toolbar[i]
    return t.type === p.type && t.locked === p.locked && sameValue(t.settings, p.settings)
  })
}

/** Structural equality of JSON values (object key order does not matter). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

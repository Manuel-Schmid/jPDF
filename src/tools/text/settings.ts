import type { RGB, TextAlign } from '../../core/session/model'

/** Font size range of text boxes, in pt. Small enough for dense forms and footnotes. */
export const FONT_SIZE_MIN = 6
export const FONT_SIZE_MAX = 72

export interface TextSettings {
  textColor: RGB
  fontSize: number
  background: { color: RGB; opacity: number } | null
  /** Absent in settings saved before alignment existed: left. */
  align?: TextAlign
  /** Absent in settings saved before bold and italic existed: regular. */
  bold?: boolean
  italic?: boolean
}

/** Background colour picked when switching from Transparent to Colour. */
export const DEFAULT_BACKGROUND: { color: RGB; opacity: number } = { color: [1, 1, 1], opacity: 1 }

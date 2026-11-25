import type { Annotation, RGB, ShapeAnnotation, TextAlign } from '../../core/session/model'

/**
 * Which set of style controls edits a selection: the same controls the tool
 * that makes those annotations shows for new ones. Pen strokes and marker
 * strokes have different controls (and presets), so they are different types
 * even though both are ink; marker strokes and text highlights share theirs.
 */
export type StyleType = 'text' | 'pen' | 'marker' | 'textline' | 'shape' | 'line'

/** Style of a text box (the text tool's settings). */
export interface TextStyle {
  textColor: RGB
  fontSize: number
  background: { color: RGB; opacity: number } | null
  align: TextAlign
  /** Absent: regular. */
  bold?: boolean
  italic?: boolean
}
export interface PenStyle {
  color: RGB
  width: number
  opacity: number
}
/** `width` only for marker strokes (text highlights have no thickness). */
export interface MarkerStyle {
  color: RGB
  opacity: number
  width?: number
}
export interface TextLineStyle {
  color: RGB
}
export interface ShapeKindStyle {
  shape: ShapeAnnotation['shape']
  border: ShapeAnnotation['border']
  fill: ShapeAnnotation['fill']
}
export interface LineStyle {
  arrow: boolean
  border: { color: RGB; width: number; opacity: number }
}
export type StyleValue = TextStyle | PenStyle | MarkerStyle | TextLineStyle | ShapeKindStyle | LineStyle

/** Style fields each kind takes, in the order styleValue reports them. Geometry is never among them. */
const FIELDS: Record<Annotation['kind'], readonly string[]> = {
  freetext: ['textColor', 'fontSize', 'background', 'align', 'bold', 'italic'],
  ink: ['color', 'width', 'opacity'],
  highlight: ['color', 'opacity'],
  underline: ['color'],
  strikeout: ['color'],
  shape: ['shape', 'border', 'fill'],
  line: ['arrow', 'border'],
  image: [],
}

function typeOf(a: Annotation): StyleType | null {
  switch (a.kind) {
    case 'freetext':
      return 'text'
    case 'ink':
      return a.role === 'marker' ? 'marker' : 'pen'
    case 'highlight':
      return 'marker'
    case 'underline':
    case 'strikeout':
      return 'textline'
    case 'shape':
      return 'shape'
    case 'line':
      return 'line'
    default:
      return null
  }
}

/** The style type all of `list` share; null when empty, mixed or without style (images). */
export function styleTypeOf(list: readonly Annotation[]): StyleType | null {
  const types = new Set(list.map(typeOf))
  if (types.size !== 1) return null
  return [...types][0]
}

/** A plain copy: values may be reactive proxies, and annotations must not share them. */
const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** The style controls' values for `a` (its style fields, copied). */
export function styleValue(a: Annotation): StyleValue {
  const rec = a as unknown as Record<string, unknown>
  return Object.fromEntries(FIELDS[a.kind].map((k) => [k, copy(rec[k])])) as unknown as StyleValue
}

/**
 * `a` with the fields of `patch` its kind has (copied); other fields of the
 * patch are left out, so one patch can be applied to every annotation of a
 * group (e.g. a marker's thickness to marker strokes, not to highlights).
 * Returns `a` itself when nothing applies.
 */
export function applyStyle(a: Annotation, patch: Partial<Record<string, unknown>>): Annotation {
  const keys = FIELDS[a.kind].filter((k) => k in patch)
  if (keys.length === 0) return a
  return { ...a, ...Object.fromEntries(keys.map((k) => [k, copy(patch[k])])) } as Annotation
}

/** The colour shown on the selection bar's Style button; null for kinds without one. */
export function swatchColor(a: Annotation): RGB | null {
  switch (a.kind) {
    case 'freetext':
      return a.textColor
    case 'ink':
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return a.color
    case 'shape':
      return a.border?.color ?? a.fill?.color ?? null
    case 'line':
      return a.border.color
    default:
      return null
  }
}

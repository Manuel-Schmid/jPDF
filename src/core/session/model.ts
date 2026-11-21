// Identical JSON shape to Rust AnnotationDto.
export type RGB = [number, number, number];           // 0..1
export type Point = [number, number];                 // PDF user space
export type Rect = [number, number, number, number];  // x1, y1, x2, y2 (PDF, y up)
export type Quad = [number, number, number, number, number, number, number, number]; // PDF QuadPoints order: TL, TR, BL, BR

/**
 * `flattened`: to be burned into the page content on the next save (drawn
 * there by its appearance, the annotation object removed). Until then it is
 * still shown but no longer editable, and undo brings it back. Absent when
 * not flattened (the reader never sets it).
 */
interface Base { id: string; page: number; sourceRef: string | null; modifiedAt: string; author: string; flattened?: true }
export interface HighlightAnnotation extends Base { kind: 'highlight'; quads: Quad[]; color: RGB; opacity: number }
/**
 * Underlined or struck-through text: `quads` are the text's line boxes (as for
 * highlights); the line is drawn inside each quad (see geometry/textLines.ts).
 * Saved as /Underline or /StrikeOut.
 */
export interface TextLineAnnotation extends Base { kind: 'underline' | 'strikeout'; quads: Quad[]; color: RGB }
/** Annotations made from selected text (their quads are the text's line boxes). */
export type TextMarkupAnnotation = HighlightAnnotation | TextLineAnnotation
/**
 * `pressure`: pen pressure (0..1) per point, one array per stroke, recorded
 * only for pen tool strokes drawn with a pen. Absent: every stroke has the
 * constant `width`. Present: each point's width follows its pressure (see
 * geometry/pressure.ts) and the strokes are drawn and saved as filled outlines.
 */
export interface InkAnnotation extends Base { kind: 'ink'; strokes: Point[][]; color: RGB; width: number; opacity: number; blend: 'normal' | 'multiply'; role: 'pen' | 'marker'; pressure?: number[][] }
/** Horizontal alignment of a text box's lines; saved as /Q (0, 1, 2). */
export type TextAlign = 'left' | 'center' | 'right'
export interface FreeTextAnnotation extends Base { kind: 'freetext'; rect: Rect; text: string; lines: string[]; fontSize: number; textColor: RGB; background: { color: RGB; opacity: number } | null; align: TextAlign }
/**
 * Rectangle or circle. `rect` is the geometric outline (centre of the border
 * stroke, x1 < x2, y1 < y2), for circles the circle's bounding box (an
 * ellipse once resized). At least one of border and fill is set.
 */
export interface ShapeAnnotation extends Base {
  kind: 'shape'
  shape: 'rect' | 'circle'
  rect: Rect
  border: { color: RGB; width: number; opacity: number } | null
  fill: { color: RGB; opacity: number } | null
}
/**
 * A straight line (two points), a polyline (more) or either with an arrowhead
 * at its last point. `points` are the centre line of the stroke. Saved as
 * /Line (two points) or /PolyLine, the arrowhead as line ending /OpenArrow.
 */
export interface LineAnnotation extends Base {
  kind: 'line'
  points: Point[]
  arrow: boolean
  border: { color: RGB; width: number; opacity: number }
}
/**
 * A pasted image, drawn upright on screen and stretched to fill `rect`
 * (x1 < x2, y1 < y2). `image` is the PNG (base64, no `data:` prefix) and its
 * pixel size. Saved as a /Stamp annotation.
 */
export interface ImageAnnotation extends Base {
  kind: 'image'
  rect: Rect
  image: { width: number; height: number; png: string }
}
export type Annotation = HighlightAnnotation | TextLineAnnotation | InkAnnotation | FreeTextAnnotation | ShapeAnnotation | LineAnnotation | ImageAnnotation;

/** Whether tools may select, move, merge or erase `a` (a flattened annotation is page content to be). */
export function isEditable(a: Annotation): boolean {
  return !a.flattened
}

/** `page` is 0-based here (session.currentPage / goToPage are 1-based). */
export function newId(): string {
  return crypto.randomUUID()
}

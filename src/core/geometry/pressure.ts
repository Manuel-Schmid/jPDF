import type { InkAnnotation, Point } from '../session/model'

/*
 * Pressure-sensitive strokes. A PDF /Ink annotation has one line width, so a
 * stroke whose width varies is drawn (and saved, see appearance.rs, which
 * mirrors this file) as a filled outline around the same midpoint-quadratic
 * centre line as `smoothPath`: the left edge forward, a round cap, the right
 * edge back, a round cap. Every outline runs the same way round, so the
 * outlines of one annotation are filled together with the nonzero rule
 * (overlaps are not darkened twice).
 */

/** Width factor at pressure 0 and its growth up to pressure 1: medium pressure (0.5) draws the set width. */
const MIN_FACTOR = 0.4
const FACTOR_RANGE = 1.2

/** Stroke width (pt) at `pressure` (0..1, clamped) for the set `width`. */
export function pressureWidth(width: number, pressure: number): number {
  const p = Math.min(1, Math.max(0, pressure))
  return width * (MIN_FACTOR + FACTOR_RANGE * p)
}

/** Widest point of `a` (pt): its `width` without pressure. */
export function maxInkWidth(a: InkAnnotation): number {
  if (!a.pressure) return a.width
  let max = 0
  for (const ps of a.pressure) for (const p of ps) max = Math.max(max, pressureWidth(a.width, p))
  return max || a.width
}

/** Per-point widths of stroke `i` of `a` (the set width where its pressure is missing or does not match). */
export function strokeWidths(a: InkAnnotation, i: number): number[] {
  const s = a.strokes[i]
  const ps = a.pressure?.[i]
  if (!ps || ps.length !== s.length) return s.map(() => a.width)
  return ps.map((p) => pressureWidth(a.width, p))
}

/** Pressure smoothed by a 3-point moving average (pen pressure is noisy); keeps the ends. */
export function smoothPressure(ps: number[]): number[] {
  if (ps.length < 3) return ps.slice()
  return ps.map((p, i) => (i === 0 || i === ps.length - 1 ? p : (ps[i - 1] + p + ps[i + 1]) / 3))
}

/** One drawing operation of an outline, in PDF user space. */
export type OutlineOp = { op: 'M' | 'L'; p: Point } | { op: 'C'; c1: Point; c2: Point; p: Point } | { op: 'Z' }

/** Bézier factor of a quarter circle (as the Rust appearances). */
const KAPPA = 0.5523

const add = (a: Point, b: Point, k = 1): Point => [a[0] + b[0] * k, a[1] + b[1] * k]
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const neg = (v: Point): Point => [-v[0], -v[1]]
/** Left normal of a unit direction (PDF space, y up). */
const left = (t: Point): Point => [-t[1], t[0]]

function unit(v: Point): Point | null {
  const len = Math.hypot(v[0], v[1])
  return len > 1e-9 ? [v[0] / len, v[1] / len] : null
}

/** A piece of the centre line: a line (no `c`) or a quadratic, with the widths at its ends and control point. */
interface Piece {
  a: Point
  b: Point
  c?: Point
  wa: number
  wb: number
  wc: number
  /** Unit tangents at a and b. */
  ta: Point
  tb: Point
}

/** The centre line of `smoothPath` as pieces, zero-length ones dropped. */
function pieces(s: Point[], w: number[]): Piece[] {
  const n = s.length
  const out: Piece[] = []
  const push = (a: Point, b: Point, wa: number, wb: number, c?: Point, wc = (wa + wb) / 2) => {
    const chord = unit(sub(b, a))
    const ta = (c && unit(sub(c, a))) || chord
    const tb = (c && unit(sub(b, c))) || chord
    if (!ta || !tb) return
    out.push({ a, b, c, wa, wb, wc, ta, tb })
  }
  if (n === 2) {
    push(s[0], s[1], w[0], w[1])
    return out
  }
  let cur = s[0]
  let wcur = w[0]
  for (let i = 1; i < n - 1; i++) {
    const end = mid(s[i], s[i + 1])
    const wend = (w[i] + w[i + 1]) / 2
    push(cur, end, wcur, wend, s[i], w[i])
    cur = end
    wcur = wend
  }
  push(cur, s[n - 1], wcur, w[n - 1])
  return out
}

/** Quadratic a-c-b as a cubic's control points. */
function cubic(a: Point, c: Point, b: Point): [Point, Point] {
  return [add(a, sub(c, a), 2 / 3), add(b, sub(c, b), 2 / 3)]
}

/** Quarter circle around `c` (radius r) from c + r·u to c + r·v (v ⟂ u). */
function quarter(c: Point, r: number, u: Point, v: Point): OutlineOp {
  return { op: 'C', c1: add(add(c, u, r), v, KAPPA * r), c2: add(add(c, v, r), u, KAPPA * r), p: add(c, v, r) }
}

/** Full circle (clockwise, as the stroke outlines). */
function circle(c: Point, r: number): OutlineOp[] {
  const dirs: Point[] = [[1, 0], [0, -1], [-1, 0], [0, 1]]
  return [{ op: 'M', p: add(c, dirs[0], r) }, ...dirs.map((u, i) => quarter(c, r, u, dirs[(i + 1) % 4])), { op: 'Z' }]
}

/**
 * The offset of `piece` by half its width to the left (side 1) or right
 * (side -1). A quadratic's offset control point is where the offset control
 * legs meet (clamped at sharp turns).
 */
function offset(pc: Piece, side: 1 | -1): { a: Point; b: Point; c?: Point } {
  const na = left(pc.ta)
  const nb = left(pc.tb)
  const a = add(pc.a, na, (side * pc.wa) / 2)
  const b = add(pc.b, nb, (side * pc.wb) / 2)
  if (!pc.c) return { a, b }
  const nm = unit(add(na, nb)) ?? na
  const cosHalf = Math.max(0.25, nm[0] * na[0] + nm[1] * na[1])
  return { a, b, c: add(pc.c, nm, (side * pc.wc) / 2 / cosHalf) }
}

/** Outline of one stroke with per-point widths `w` (same length as `s`); empty for an empty stroke. */
export function strokeOutline(s: Point[], w: number[]): OutlineOp[] {
  if (s.length === 0) return []
  const ps = s.length === 1 ? [] : pieces(s, w)
  if (ps.length === 0) return circle(s[0], Math.max(...w.slice(0, s.length)) / 2)
  const ops: OutlineOp[] = []
  const lefts = ps.map((pc) => offset(pc, 1))
  const rights = ps.map((pc) => offset(pc, -1))
  const lineTo = (p: Point) => {
    const last = ops[ops.length - 1]
    if (last && last.op !== 'Z' && Math.hypot(last.p[0] - p[0], last.p[1] - p[1]) < 1e-9) return
    ops.push({ op: 'L', p })
  }
  ops.push({ op: 'M', p: lefts[0].a })
  for (const l of lefts) {
    lineTo(l.a)
    if (l.c) {
      const [c1, c2] = cubic(l.a, l.c, l.b)
      ops.push({ op: 'C', c1, c2, p: l.b })
    } else {
      lineTo(l.b)
    }
  }
  const last = ps[ps.length - 1]
  const nEnd = left(last.tb)
  lineTo(add(last.b, nEnd, last.wb / 2))
  ops.push(quarter(last.b, last.wb / 2, nEnd, last.tb), quarter(last.b, last.wb / 2, last.tb, neg(nEnd)))
  for (let i = rights.length - 1; i >= 0; i--) {
    const r = rights[i]
    lineTo(r.b)
    if (r.c) {
      const [c1, c2] = cubic(r.b, r.c, r.a)
      ops.push({ op: 'C', c1, c2, p: r.a })
    } else {
      lineTo(r.a)
    }
  }
  const first = ps[0]
  const nStart = left(first.ta)
  lineTo(add(first.a, nStart, -first.wa / 2))
  ops.push(
    quarter(first.a, first.wa / 2, neg(nStart), neg(first.ta)),
    quarter(first.a, first.wa / 2, neg(first.ta), nStart),
    { op: 'Z' },
  )
  return ops
}

/** Outlines of every stroke of `a` (PDF space); compute once per annotation, map per zoom with `outlinePath`. */
export function inkOutlines(a: InkAnnotation): OutlineOp[] {
  return a.strokes.flatMap((s, i) => strokeOutline(s, strokeWidths(a, i)))
}

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000)

/** SVG path data for `ops`, each point mapped by `toScreen` (an affine map, so curves map exactly). */
export function outlinePath(ops: OutlineOp[], toScreen: (p: Point) => Point): string {
  const pt = (p: Point) => {
    const [x, y] = toScreen(p)
    return `${fmt(x)} ${fmt(y)}`
  }
  return ops
    .map((o) => (o.op === 'Z' ? 'Z' : o.op === 'C' ? `C${pt(o.c1)} ${pt(o.c2)} ${pt(o.p)}` : `${o.op}${pt(o.p)}`))
    .join(' ')
}

/**
 * Ramer–Douglas–Peucker over position and width: a point is kept when it lies
 * further than `tolerance` from the chord, or its half width differs by more
 * than `tolerance` from the width interpolated along the chord, so a change of
 * pressure on a straight line survives. Returns the kept indices, in order.
 */
export function simplifyWithWidths(points: Point[], widths: number[], tolerance: number): number[] {
  const n = points.length
  if (n < 3) return points.map((_, i) => i)
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = keep[n - 1] = true
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    const a = points[lo]
    const b = points[hi]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    let max = -1
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i]
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
      const dist = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
      const dw = Math.abs(widths[i] - (widths[lo] + (widths[hi] - widths[lo]) * t)) / 2
      const d = Math.max(dist, dw)
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (idx >= 0 && max > tolerance) {
      keep[idx] = true
      stack.push([lo, idx], [idx, hi])
    }
  }
  const out: number[] = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

/** Indices `dedupe` keeps: points closer than `minDist` to the previously kept one are dropped; first and last always kept. */
export function dedupeIndices(points: Point[], minDist: number): number[] {
  if (points.length < 2) return points.map((_, i) => i)
  const out = [0]
  for (let i = 1; i < points.length - 1; i++) {
    const last = points[out[out.length - 1]]
    if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= minDist) out.push(i)
  }
  const end = points.length - 1
  const last = points[out[out.length - 1]]
  if (points[end][0] !== last[0] || points[end][1] !== last[1] || out.length === 1) out.push(end)
  return out
}

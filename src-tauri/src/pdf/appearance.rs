use super::dto::{Background, Fill, ShapeKind, Stroke, TextAlign};
use super::fmt::fmt_num;
use super::winansi::{encode_winansi, helvetica_width};

/// An appearance stream description, built independent of lopdf.
///
/// `content` uses absolute PDF user-space coordinates (no translation), so the
/// writer must set the form XObject `/BBox` = `bbox` with `/Matrix` = `matrix`
/// (identity when `None`) and the annotation `/Rect` = `rect()` (`bbox`
/// transformed by `matrix`, so the form maps onto `/Rect` without scaling).
/// The writer builds the `/ExtGState` resource `GS0` from `opacity` (`/CA`, `/ca`)
/// and `multiply` (`/BM /Multiply`), a further `/ExtGState` entry per
/// `gstates` item, and a Helvetica font resource if `uses_helvetica`.
///
/// With `group`, `content` only paints the form `/Fm0` (under `GS0`), and the
/// writer builds `/Fm0` from `group`: an isolated knockout transparency group
/// with the same box, drawing opaque paths. The opacity and blend mode then
/// apply once to the whole drawing, so overlapping strokes or quads of one
/// annotation are not darkened twice.
#[derive(Clone, Debug, PartialEq)]
pub struct Appearance {
    pub bbox: [f64; 4],
    pub content: Vec<u8>,
    pub opacity: f64,
    pub multiply: bool,
    pub uses_helvetica: bool,
    pub matrix: Option<[f64; 6]>,
    /// Extra named graphics states (shapes: separate fill and stroke opacity).
    pub gstates: Vec<NamedGState>,
    /// Content of the transparency group `/Fm0` that `content` paints.
    pub group: Option<Vec<u8>>,
    /// `content` paints the image XObject `/Im0`, which the writer supplies.
    pub image: bool,
}

/// Outer content of a grouped appearance: opacity and blend mode, then the group.
const PAINT_GROUP: &str = "q\n/GS0 gs\n/Fm0 Do\nQ\n";

/// An `/ExtGState` resource `name` setting `/ca` (fill) and/or `/CA` (stroke) opacity.
#[derive(Clone, Debug, PartialEq)]
pub struct NamedGState {
    pub name: &'static str,
    pub fill_opacity: Option<f64>,
    pub stroke_opacity: Option<f64>,
}

impl Appearance {
    /// Bounding box of `bbox` transformed by `matrix`: the annotation `/Rect`.
    pub fn rect(&self) -> [f64; 4] {
        match self.matrix {
            None => self.bbox,
            Some(m) => transformed_bounds(self.bbox, m),
        }
    }
}

fn transformed_bounds(b: [f64; 4], m: [f64; 6]) -> [f64; 4] {
    let (mut x1, mut y1, mut x2, mut y2) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for (x, y) in [(b[0], b[1]), (b[2], b[1]), (b[0], b[3]), (b[2], b[3])] {
        let tx = m[0] * x + m[2] * y + m[4];
        let ty = m[1] * x + m[3] * y + m[5];
        x1 = x1.min(tx);
        y1 = y1.min(ty);
        x2 = x2.max(tx);
        y2 = y2.max(ty);
    }
    [x1, y1, x2, y2]
}

fn mid(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}

fn pt(p: [f64; 2]) -> String {
    format!("{} {}", fmt_num(p[0]), fmt_num(p[1]))
}

/// Same midpoint-quadratic scheme as the TS `smoothPath`, with quadratics
/// converted to cubics.
fn stroke_path(s: &[[f64; 2]], out: &mut String) {
    let n = s.len();
    out.push_str(&format!("{} m\n", pt(s[0])));
    if n == 1 {
        out.push_str(&format!("{} l\n", pt(s[0])));
        return;
    }
    let mut cur = s[0];
    for i in 1..=n.saturating_sub(2) {
        let c = s[i];
        let end = mid(s[i], s[i + 1]);
        let c1 = [cur[0] + 2.0 / 3.0 * (c[0] - cur[0]), cur[1] + 2.0 / 3.0 * (c[1] - cur[1])];
        let c2 = [end[0] + 2.0 / 3.0 * (c[0] - end[0]), end[1] + 2.0 / 3.0 * (c[1] - end[1])];
        out.push_str(&format!("{} {} {} c\n", pt(c1), pt(c2), pt(end)));
        cur = end;
    }
    out.push_str(&format!("{} l\n", pt(s[n - 1])));
}

/// Callers (the writer) must skip ink annotations whose strokes are all empty:
/// they yield a zero bbox and no drawing operators.
pub fn ink_appearance(strokes: &[Vec<[f64; 2]>], color: [f64; 3], width: f64, opacity: f64, multiply: bool) -> Appearance {
    let (mut x1, mut y1, mut x2, mut y2) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    let mut any = false;
    for p in strokes.iter().flatten() {
        any = true;
        x1 = x1.min(p[0]);
        y1 = y1.min(p[1]);
        x2 = x2.max(p[0]);
        y2 = y2.max(p[1]);
    }
    let pad = width / 2.0 + 1.0;
    let bbox = if any { [x1 - pad, y1 - pad, x2 + pad, y2 + pad] } else { [0.0; 4] };

    let mut c = format!(
        "q\n{} w\n1 J\n1 j\n{} {} {} RG\n",
        fmt_num(width),
        fmt_num(color[0]),
        fmt_num(color[1]),
        fmt_num(color[2])
    );
    for s in strokes.iter().filter(|s| !s.is_empty()) {
        stroke_path(s, &mut c);
        c.push_str("S\n");
    }
    c.push_str("Q\n");

    Appearance {
        bbox,
        content: PAINT_GROUP.into(),
        opacity,
        multiply,
        uses_helvetica: false,
        matrix: None,
        gstates: Vec::new(),
        group: Some(c.into_bytes()),
        image: false,
    }
}

/// Width factor at pressure 0 and its growth up to pressure 1 (TS `pressureWidth`):
/// medium pressure (0.5) draws the set width.
const MIN_FACTOR: f64 = 0.4;
const FACTOR_RANGE: f64 = 1.2;

/// Stroke width at `pressure` (0..1, clamped) for the set `width`.
pub fn pressure_width(width: f64, pressure: f64) -> f64 {
    width * (MIN_FACTOR + FACTOR_RANGE * pressure.clamp(0.0, 1.0))
}

type P = [f64; 2];

fn add(a: P, b: P, k: f64) -> P {
    [a[0] + b[0] * k, a[1] + b[1] * k]
}

fn sub(a: P, b: P) -> P {
    [a[0] - b[0], a[1] - b[1]]
}

fn neg(v: P) -> P {
    [-v[0], -v[1]]
}

/// Left normal of a unit direction (y up).
fn left(t: P) -> P {
    [-t[1], t[0]]
}

fn unit(v: P) -> Option<P> {
    let len = v[0].hypot(v[1]);
    (len > 1e-9).then(|| [v[0] / len, v[1] / len])
}

/// A piece of the centre line: a line (`c` = None) or a quadratic, with the
/// widths at its ends and control point and the unit tangents at its ends.
struct Piece {
    a: P,
    b: P,
    c: Option<P>,
    wa: f64,
    wb: f64,
    wc: f64,
    ta: P,
    tb: P,
}

/// The centre line of `stroke_path` as pieces, zero-length ones dropped.
fn pieces(s: &[P], w: &[f64]) -> Vec<Piece> {
    let n = s.len();
    let mut out = Vec::new();
    let mut push = |a: P, b: P, wa: f64, wb: f64, c: Option<(P, f64)>| {
        let chord = unit(sub(b, a));
        let ta = c.and_then(|(c, _)| unit(sub(c, a))).or(chord);
        let tb = c.and_then(|(c, _)| unit(sub(b, c))).or(chord);
        if let (Some(ta), Some(tb)) = (ta, tb) {
            let wc = c.map_or((wa + wb) / 2.0, |(_, wc)| wc);
            out.push(Piece { a, b, c: c.map(|(c, _)| c), wa, wb, wc, ta, tb });
        }
    };
    if n == 2 {
        push(s[0], s[1], w[0], w[1], None);
        return out;
    }
    let (mut cur, mut wcur) = (s[0], w[0]);
    for i in 1..n - 1 {
        let end = mid(s[i], s[i + 1]);
        let wend = (w[i] + w[i + 1]) / 2.0;
        push(cur, end, wcur, wend, Some((s[i], w[i])));
        cur = end;
        wcur = wend;
    }
    push(cur, s[n - 1], wcur, w[n - 1], None);
    out
}

/// Offset of a piece by half its width to the left (`side` 1) or right (-1):
/// start, end and (quadratics) the control point where the offset control legs meet.
fn offset(pc: &Piece, side: f64) -> (P, P, Option<P>) {
    let (na, nb) = (left(pc.ta), left(pc.tb));
    let a = add(pc.a, na, side * pc.wa / 2.0);
    let b = add(pc.b, nb, side * pc.wb / 2.0);
    let c = pc.c.map(|c| {
        let nm = unit(add(na, nb, 1.0)).unwrap_or(na);
        let cos_half = (nm[0] * na[0] + nm[1] * na[1]).max(0.25);
        add(c, nm, side * pc.wc / 2.0 / cos_half)
    });
    (a, b, c)
}

/// Builds outline path operators, skipping zero-length lines.
struct Outline<'a> {
    out: &'a mut String,
    cur: Option<P>,
}

impl Outline<'_> {
    fn move_to(&mut self, p: P) {
        self.out.push_str(&format!("{} m\n", pt(p)));
        self.cur = Some(p);
    }
    fn line_to(&mut self, p: P) {
        if self.cur.is_some_and(|c| (c[0] - p[0]).hypot(c[1] - p[1]) < 1e-9) {
            return;
        }
        self.out.push_str(&format!("{} l\n", pt(p)));
        self.cur = Some(p);
    }
    fn curve(&mut self, c1: P, c2: P, p: P) {
        self.out.push_str(&format!("{} {} {} c\n", pt(c1), pt(c2), pt(p)));
        self.cur = Some(p);
    }
    /// Quadratic from the current point `a` via `c` to `b`, as a cubic.
    fn quad(&mut self, a: P, c: P, b: P) {
        self.curve(add(a, sub(c, a), 2.0 / 3.0), add(b, sub(c, b), 2.0 / 3.0), b);
    }
    /// Quarter circle around `c` (radius r) from c + r·u to c + r·v (v ⟂ u).
    fn quarter(&mut self, c: P, r: f64, u: P, v: P) {
        self.curve(add(add(c, u, r), v, KAPPA * r), add(add(c, v, r), u, KAPPA * r), add(c, v, r));
    }
    fn close(&mut self) {
        self.out.push_str("h\n");
        self.cur = None;
    }
}

/// Outline of one stroke with per-point widths `w` (TS `strokeOutline`): the
/// left edge forward, a round cap, the right edge back, a round cap, always
/// clockwise; a full circle when the stroke has no length.
fn stroke_outline(s: &[P], w: &[f64], out: &mut String) {
    if s.is_empty() {
        return;
    }
    let mut o = Outline { out, cur: None };
    let ps = if s.len() == 1 { Vec::new() } else { pieces(s, w) };
    let (Some(first), Some(last)) = (ps.first(), ps.last()) else {
        let r = w.iter().take(s.len()).fold(0.0_f64, |m, &x| m.max(x)) / 2.0;
        let dirs = [[1.0, 0.0], [0.0, -1.0], [-1.0, 0.0], [0.0, 1.0]];
        o.move_to(add(s[0], dirs[0], r));
        for i in 0..4 {
            o.quarter(s[0], r, dirs[i], dirs[(i + 1) % 4]);
        }
        o.close();
        return;
    };
    let lefts: Vec<_> = ps.iter().map(|pc| offset(pc, 1.0)).collect();
    let rights: Vec<_> = ps.iter().map(|pc| offset(pc, -1.0)).collect();
    o.move_to(lefts[0].0);
    for &(a, b, c) in &lefts {
        o.line_to(a);
        match c {
            Some(c) => o.quad(a, c, b),
            None => o.line_to(b),
        }
    }
    let n_end = left(last.tb);
    o.line_to(add(last.b, n_end, last.wb / 2.0));
    o.quarter(last.b, last.wb / 2.0, n_end, last.tb);
    o.quarter(last.b, last.wb / 2.0, last.tb, neg(n_end));
    for &(a, b, c) in rights.iter().rev() {
        o.line_to(b);
        match c {
            Some(c) => o.quad(b, c, a),
            None => o.line_to(a),
        }
    }
    let n_start = left(first.ta);
    o.line_to(add(first.a, n_start, -first.wa / 2.0));
    o.quarter(first.a, first.wa / 2.0, neg(n_start), neg(first.ta));
    o.quarter(first.a, first.wa / 2.0, neg(first.ta), n_start);
    o.close();
}

/// Per-point widths of stroke `i` (the set width where its pressure is missing or does not match).
fn stroke_widths(strokes: &[Vec<P>], pressure: &[Vec<f64>], i: usize, width: f64) -> Vec<f64> {
    match pressure.get(i) {
        Some(ps) if ps.len() == strokes[i].len() => ps.iter().map(|&p| pressure_width(width, p)).collect(),
        _ => vec![width; strokes[i].len()],
    }
}

/// A pressure-sensitive ink annotation: every stroke as a filled outline
/// whose width follows the pressure (same geometry as the TS renderer), all
/// filled in one nonzero fill so overlaps are not darkened twice. Same group,
/// opacity and blend as `ink_appearance`; callers skip annotations whose
/// strokes are all empty.
pub fn ink_pressure_appearance(
    strokes: &[Vec<P>],
    pressure: &[Vec<f64>],
    color: [f64; 3],
    width: f64,
    opacity: f64,
    multiply: bool,
) -> Appearance {
    let widths: Vec<Vec<f64>> = (0..strokes.len()).map(|i| stroke_widths(strokes, pressure, i, width)).collect();
    let max_width = widths.iter().flatten().fold(0.0_f64, |m, &w| m.max(w));
    let mut ink = ink_appearance(strokes, color, max_width, opacity, multiply);
    let mut c = format!("q\n{} {} {} rg\n", fmt_num(color[0]), fmt_num(color[1]), fmt_num(color[2]));
    for (s, w) in strokes.iter().zip(&widths) {
        stroke_outline(s, w, &mut c);
    }
    c.push_str("f\nQ\n");
    ink.group = Some(c.into_bytes());
    ink
}

/// One filled path per quad (QuadPoints order TL, TR, BL, BR; drawn TL→TR→BR→BL),
/// in an opaque group painted multiply-blended with the opacity. `bbox` = union of the quads (zero if there are none).
pub fn highlight_appearance(quads: &[[f64; 8]], color: [f64; 3], opacity: f64) -> Appearance {
    let (mut x1, mut y1, mut x2, mut y2) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for q in quads {
        for p in q.as_chunks::<2>().0 {
            x1 = x1.min(p[0]);
            y1 = y1.min(p[1]);
            x2 = x2.max(p[0]);
            y2 = y2.max(p[1]);
        }
    }
    let bbox = if quads.is_empty() { [0.0; 4] } else { [x1, y1, x2, y2] };

    let mut c = format!(
        "q\n{} {} {} rg\n",
        fmt_num(color[0]),
        fmt_num(color[1]),
        fmt_num(color[2])
    );
    for q in quads {
        c.push_str(&format!(
            "{} m\n{} l\n{} l\n{} l\nh\nf\n",
            pt([q[0], q[1]]),
            pt([q[2], q[3]]),
            pt([q[6], q[7]]),
            pt([q[4], q[5]])
        ));
    }
    c.push_str("Q\n");

    Appearance {
        bbox,
        content: PAINT_GROUP.into(),
        opacity,
        multiply: true,
        uses_helvetica: false,
        matrix: None,
        gstates: Vec::new(),
        group: Some(c.into_bytes()),
        image: false,
    }
}

/// Which line a text-line annotation draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TextLine {
    Underline,
    StrikeOut,
}

/// Line thickness (fraction of the quad height), thinnest line (pt), and line
/// centres (fraction of the quad height above its bottom edge); identical to
/// the TS `textLines.ts`.
const TEXT_LINE_THICKNESS: f64 = 1.0 / 14.0;
const TEXT_LINE_MIN_THICKNESS: f64 = 0.5;
const UNDERLINE_POSITION: f64 = 0.12;
const STRIKEOUT_POSITION: f64 = 0.42;

/// The band the line covers inside quad `q` (QuadPoints order TL, TR, BL, BR,
/// any orientation), in the same order; a quad without height yields itself.
pub fn text_line_band(q: &[f64; 8], kind: TextLine) -> [f64; 8] {
    let [tlx, tly, trx, try_, blx, bly, brx, bry] = *q;
    let (lx, ly, rx, ry) = (tlx - blx, tly - bly, trx - brx, try_ - bry);
    let h = lx.hypot(ly);
    if h == 0.0 {
        return *q;
    }
    let thickness = h.min(TEXT_LINE_MIN_THICKNESS.max(h * TEXT_LINE_THICKNESS)) / h;
    let centre = match kind {
        TextLine::Underline => UNDERLINE_POSITION,
        TextLine::StrikeOut => STRIKEOUT_POSITION,
    };
    let lo = (centre - thickness / 2.0).max(0.0);
    let hi = (lo + thickness).min(1.0);
    [
        blx + lx * hi,
        bly + ly * hi,
        brx + rx * hi,
        bry + ry * hi,
        blx + lx * lo,
        bly + ly * lo,
        brx + rx * lo,
        bry + ry * lo,
    ]
}

/// One filled band per quad (see `text_line_band`), opaque and normal-blended,
/// so no transparency group is needed. `bbox` = union of the quads (zero if
/// there are none), which contains every band.
pub fn text_line_appearance(quads: &[[f64; 8]], kind: TextLine, color: [f64; 3]) -> Appearance {
    let (mut x1, mut y1, mut x2, mut y2) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for q in quads {
        for p in q.as_chunks::<2>().0 {
            x1 = x1.min(p[0]);
            y1 = y1.min(p[1]);
            x2 = x2.max(p[0]);
            y2 = y2.max(p[1]);
        }
    }
    let bbox = if quads.is_empty() { [0.0; 4] } else { [x1, y1, x2, y2] };

    let mut c = format!(
        "q\n{} {} {} rg\n",
        fmt_num(color[0]),
        fmt_num(color[1]),
        fmt_num(color[2])
    );
    for q in quads {
        let b = text_line_band(q, kind);
        c.push_str(&format!(
            "{} m\n{} l\n{} l\n{} l\nh\n",
            pt([b[0], b[1]]),
            pt([b[2], b[3]]),
            pt([b[6], b[7]]),
            pt([b[4], b[5]])
        ));
    }
    // One fill for all bands.
    c.push_str("f\nQ\n");

    Appearance {
        bbox,
        content: c.into_bytes(),
        opacity: 1.0,
        multiply: false,
        uses_helvetica: false,
        matrix: None,
        gstates: Vec::new(),
        group: None,
        image: false,
    }
}

/// Inner box padding, line height factor and first-baseline offset (fraction of
/// the font size below the padding); identical to the TS `textLayout` and the
/// overlay's FreeText rendering.
const TEXT_PADDING: f64 = 1.5;
const LINE_HEIGHT: f64 = 1.2;
const ASCENT: f64 = 0.8;

/// PDF literal string body: WinAnsi bytes with `(`, `)` and `\` escaped.
fn literal(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    for b in encode_winansi(s) {
        if matches!(b, b'(' | b')' | b'\\') {
            out.push(b'\\');
        }
        out.push(b);
    }
    out
}

/// Rotation part `[a b c d]` that turns the screen-aligned text frame so it reads
/// upright on a page with this `/Rotate` (clockwise); `None` for 0 and unknown values.
fn upright_rotation(page_rotation: i32) -> Option<[f64; 4]> {
    match page_rotation.rem_euclid(360) {
        90 => Some([0.0, 1.0, -1.0, 0.0]),
        180 => Some([-1.0, 0.0, 0.0, -1.0]),
        270 => Some([0.0, -1.0, 1.0, 0.0]),
        _ => None,
    }
}

/// The screen-aligned frame of `rect` on a page with this `/Rotate`: a box
/// anchored at the rect's lower-left corner (width and height swapped for
/// 90/270) and the `matrix` that turns it exactly onto `rect`, so what is
/// drawn upright in the frame is upright on screen. No matrix for 0.
fn upright_frame(rect: [f64; 4], page_rotation: i32) -> ([f64; 4], Option<[f64; 6]>) {
    let (x1, y1) = (rect[0].min(rect[2]), rect[1].min(rect[3]));
    let (w, h) = ((rect[2] - rect[0]).abs(), (rect[3] - rect[1]).abs());
    let (fw, fh) = match page_rotation.rem_euclid(360) {
        90 | 270 => (h, w),
        _ => (w, h),
    };
    let bbox = [x1, y1, x1 + fw, y1 + fh];
    let matrix = upright_rotation(page_rotation).map(|[a, b, c, d]| {
        let turned = transformed_bounds(bbox, [a, b, c, d, 0.0, 0.0]);
        [a, b, c, d, x1 - turned[0], y1 - turned[1]]
    });
    (bbox, matrix)
}

/// Pasted-image appearance: the image XObject `/Im0` stretched over the
/// screen-aligned frame of `rect` (see `upright_frame`), so it shows upright
/// on screen whatever the page rotation, as the overlay draws it.
pub fn image_appearance(rect: [f64; 4], page_rotation: i32) -> Appearance {
    let (bbox, matrix) = upright_frame(rect, page_rotation);
    let content = format!(
        "q
{} 0 0 {} {} {} cm
/Im0 Do
Q
",
        fmt_num(bbox[2] - bbox[0]),
        fmt_num(bbox[3] - bbox[1]),
        fmt_num(bbox[0]),
        fmt_num(bbox[1])
    );
    Appearance {
        bbox,
        content: content.into_bytes(),
        opacity: 1.0,
        multiply: false,
        uses_helvetica: false,
        matrix,
        gstates: Vec::new(),
        group: None,
        image: true,
    }
}

/// FreeText appearance: optional background fill (its opacity is the `GS0`
/// opacity, so it applies to the fill only) and one opaque Helvetica (`/Helv`,
/// WinAnsiEncoding) line per entry of `lines`, `font_size * LINE_HEIGHT` apart,
/// the first baseline `TEXT_PADDING + font_size * ASCENT` below the top.
/// Each line starts at the inner left edge, or (by `align`) is centred in or
/// flush with the right of the text area (the box minus `TEXT_PADDING` on both
/// sides), measured with Helvetica's metrics as the overlay measures it.
///
/// `rect` is axis-aligned in PDF space. On a page with `/Rotate` 90/180/270 the
/// text is laid out in the screen-aligned frame (width and height swapped for
/// 90/270), anchored at the rect's lower-left corner, and `matrix` rotates that
/// frame exactly onto `rect` so the text reads upright on screen, as the overlay
/// shows it. Unmappable characters are written as `?`.
pub fn freetext_appearance(
    rect: [f64; 4],
    lines: &[String],
    font_size: f64,
    text_color: [f64; 3],
    background: Option<&Background>,
    align: TextAlign,
    page_rotation: i32,
) -> Appearance {
    let (bbox, matrix) = upright_frame(rect, page_rotation);
    let [x1, y1, _, _] = bbox;
    let (fw, fh) = (bbox[2] - bbox[0], bbox[3] - bbox[1]);

    let rgb = |c: [f64; 3]| format!("{} {} {}", fmt_num(c[0]), fmt_num(c[1]), fmt_num(c[2]));
    let mut c: Vec<u8> = Vec::new();
    if let Some(bg) = background {
        c.extend_from_slice(
            format!(
                "q\n/GS0 gs\n{} rg\n{} {} {} {} re\nf\nQ\n",
                rgb(bg.color),
                fmt_num(x1),
                fmt_num(y1),
                fmt_num(fw),
                fmt_num(fh)
            )
            .as_bytes(),
        );
    }
    let baseline = y1 + fh - TEXT_PADDING - font_size * ASCENT;
    let inner = fw - 2.0 * TEXT_PADDING;
    // Where each line starts, from the inner left edge.
    let offset = |line: &str| match align {
        TextAlign::Left => 0.0,
        TextAlign::Center => (inner - helvetica_width(line, font_size)) / 2.0,
        TextAlign::Right => inner - helvetica_width(line, font_size),
    };
    c.extend_from_slice(format!("BT\n/Helv {} Tf\n{} rg\n", fmt_num(font_size), rgb(text_color)).as_bytes());
    // `Td` moves relative to the previous line's start, so left-aligned text
    // keeps its plain `0 -lead Td` steps.
    let mut prev: Option<f64> = None;
    for line in lines {
        let x = offset(line);
        let step = match prev {
            None => format!("{} {} Td\n", fmt_num(x1 + TEXT_PADDING + x), fmt_num(baseline)),
            Some(p) => format!("{} {} Td\n", fmt_num(x - p), fmt_num(-font_size * LINE_HEIGHT)),
        };
        c.extend_from_slice(step.as_bytes());
        prev = Some(x);
        if !line.is_empty() {
            c.push(b'(');
            c.extend(literal(line));
            c.extend_from_slice(b") Tj\n");
        }
    }
    c.extend_from_slice(b"ET\n");

    Appearance {
        bbox,
        content: c,
        opacity: background.map_or(1.0, |b| b.opacity),
        multiply: false,
        uses_helvetica: true,
        matrix,
        gstates: Vec::new(),
        group: None,
        image: false,
    }
}

/// Bézier circle constant: control points at `KAPPA * r` approximate a quarter circle.
const KAPPA: f64 = 0.5523;

/// Closed outline of the shape in `rect` (normalised): a `re` rectangle, or
/// an ellipse of four cubic Béziers around the centre (radii w/2 and h/2).
fn shape_path(shape: ShapeKind, [x1, y1, x2, y2]: [f64; 4]) -> String {
    match shape {
        ShapeKind::Rect => format!("{} {} {} {} re\n", fmt_num(x1), fmt_num(y1), fmt_num(x2 - x1), fmt_num(y2 - y1)),
        ShapeKind::Circle => {
            let (cx, cy) = ((x1 + x2) / 2.0, (y1 + y2) / 2.0);
            let (rx, ry) = ((x2 - x1) / 2.0, (y2 - y1) / 2.0);
            let (kx, ky) = (KAPPA * rx, KAPPA * ry);
            let curve = |a: [f64; 2], b: [f64; 2], c: [f64; 2]| format!("{} {} {} c\n", pt(a), pt(b), pt(c));
            let mut out = format!("{} m\n", pt([cx + rx, cy]));
            out.push_str(&curve([cx + rx, cy + ky], [cx + kx, cy + ry], [cx, cy + ry]));
            out.push_str(&curve([cx - kx, cy + ry], [cx - rx, cy + ky], [cx - rx, cy]));
            out.push_str(&curve([cx - rx, cy - ky], [cx - kx, cy - ry], [cx, cy - ry]));
            out.push_str(&curve([cx + kx, cy - ry], [cx + rx, cy - ky], [cx + rx, cy]));
            out.push_str("h\n");
            out
        }
    }
}

/// Square/Circle appearance: the fill first (`/GSf`, its opacity as `/ca`),
/// then the border (`/GSs`, its opacity as `/CA`), so both have their own
/// opacity. `rect` is the geometric outline (centre of the stroke); `bbox` is
/// it expanded by half the border width plus 1.
pub fn shape_appearance(shape: ShapeKind, rect: [f64; 4], border: Option<&Stroke>, fill: Option<&Fill>) -> Appearance {
    let r = [rect[0].min(rect[2]), rect[1].min(rect[3]), rect[0].max(rect[2]), rect[1].max(rect[3])];
    let pad = border.map_or(0.0, |b| b.width / 2.0) + 1.0;
    let bbox = [r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad];
    let rgb = |c: [f64; 3]| format!("{} {} {}", fmt_num(c[0]), fmt_num(c[1]), fmt_num(c[2]));
    let path = shape_path(shape, r);
    let mut c = String::new();
    let mut gstates = Vec::new();
    if let Some(f) = fill {
        c.push_str(&format!("q\n/GSf gs\n{} rg\n{path}f\nQ\n", rgb(f.color)));
        gstates.push(NamedGState { name: "GSf", fill_opacity: Some(f.opacity), stroke_opacity: None });
    }
    if let Some(b) = border {
        c.push_str(&format!("q\n/GSs gs\n{} w\n{} RG\n{path}S\nQ\n", fmt_num(b.width), rgb(b.color)));
        gstates.push(NamedGState { name: "GSs", fill_opacity: None, stroke_opacity: Some(b.opacity) });
    }
    Appearance {
        bbox,
        content: c.into_bytes(),
        opacity: 1.0,
        multiply: false,
        uses_helvetica: false,
        matrix: None,
        gstates,
        group: None,
        image: false,
    }
}

/// Length of an arrowhead's wings for stroke width `w` (same formula as the TS `arrowLength`).
pub fn arrow_length(w: f64) -> f64 {
    3.0 * w + 6.0
}

/// The open arrowhead at the last point of `points`: [left wing end, tip,
/// right wing end], its wings 30° off the last segment of non-zero length
/// (same as the TS `arrowHead`); `None` when all points coincide.
pub fn arrow_head(points: &[[f64; 2]], width: f64) -> Option<[[f64; 2]; 3]> {
    let tip = *points.last()?;
    let back = points.iter().rev().skip(1).find(|p| p[0] != tip[0] || p[1] != tip[1])?;
    let (dx, dy) = (back[0] - tip[0], back[1] - tip[1]);
    let len = dx.hypot(dy);
    let (ux, uy) = (dx / len, dy / len);
    let l = arrow_length(width);
    let (sin, cos) = std::f64::consts::FRAC_PI_6.sin_cos();
    let left = [tip[0] + l * (ux * cos - uy * sin), tip[1] + l * (ux * sin + uy * cos)];
    let right = [tip[0] + l * (ux * cos + uy * sin), tip[1] + l * (-ux * sin + uy * cos)];
    Some([left, tip, right])
}

/// Line/PolyLine appearance: one stroked path (round caps and joins) through
/// `points` and, with `arrow`, the arrowhead's wings, so a translucent stroke
/// is not darkened twice where they meet. Opacity in `GS0`; `bbox` = the
/// points and wing ends, expanded by half the width plus 1. Callers pass at
/// least one point.
pub fn line_appearance(points: &[[f64; 2]], arrow: bool, border: &Stroke) -> Appearance {
    let head = if arrow { arrow_head(points, border.width) } else { None };
    let (mut x1, mut y1, mut x2, mut y2) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in points.iter().chain(head.iter().flatten()) {
        x1 = x1.min(p[0]);
        y1 = y1.min(p[1]);
        x2 = x2.max(p[0]);
        y2 = y2.max(p[1]);
    }
    let pad = border.width / 2.0 + 1.0;
    let c = border.color;
    let mut out = format!(
        "q
/GS0 gs
{} w
1 J
1 j
{} {} {} RG
",
        fmt_num(border.width),
        fmt_num(c[0]),
        fmt_num(c[1]),
        fmt_num(c[2])
    );
    for (i, p) in points.iter().enumerate() {
        out.push_str(&format!("{} {}
", pt(*p), if i == 0 { "m" } else { "l" }));
    }
    if let Some([left, tip, right]) = head {
        out.push_str(&format!("{} m
{} l
{} l
", pt(left), pt(tip), pt(right)));
    }
    out.push_str("S
Q
");
    Appearance {
        bbox: [x1 - pad, y1 - pad, x2 + pad, y2 + pad],
        content: out.into_bytes(),
        opacity: border.opacity,
        multiply: false,
        uses_helvetica: false,
        matrix: None,
        gstates: Vec::new(),
        group: None,
        image: false,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn arrow_head_points_back_along_the_last_segment() {
        // Horizontal line to the right, width 2: wings 12pt long, 30° off.
        let [l, t, r] = super::arrow_head(&[[0.0, 0.0], [100.0, 0.0], [100.0, 0.0]], 2.0).unwrap();
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert_eq!(t, [100.0, 0.0]);
        let (dx, dy) = (12.0 * (3f64.sqrt() / 2.0), 6.0);
        assert!(close(l[0], 100.0 - dx) && close(l[1], -dy), "{l:?}");
        assert!(close(r[0], 100.0 - dx) && close(r[1], dy), "{r:?}");
        assert!(super::arrow_head(&[[1.0, 1.0], [1.0, 1.0]], 2.0).is_none());
    }

    #[test]
    fn line_appearance_strokes_line_and_arrowhead_in_one_path() {
        let border = super::Stroke { color: [1.0, 0.0, 0.0], width: 2.0, opacity: 0.5 };
        let a = super::line_appearance(&[[0.0, 0.0], [50.0, 0.0], [50.0, 40.0]], true, &border);
        let c = String::from_utf8(a.content.clone()).unwrap();
        assert!(c.starts_with("q
/GS0 gs
2 w
1 J
1 j
1 0 0 RG
0 0 m
50 0 l
50 40 l
"), "{c}");
        assert_eq!(c.matches(" m
").count(), 2, "{c}");
        assert_eq!(c.matches("S
").count(), 1, "{c}");
        assert_eq!(a.opacity, 0.5);
        // Arrowhead at (50, 40) pointing up: wings reach down to y = 40 - 12 cos 30°.
        assert_eq!(a.bbox[3], 42.0);
        assert!(a.group.is_none());
        let plain = super::line_appearance(&[[0.0, 0.0], [50.0, 0.0]], false, &border);
        assert_eq!(plain.bbox, [-2.0, -2.0, 52.0, 2.0]);
    }

    #[test]
    fn text_line_band_sits_under_the_baseline_or_through_the_middle() {
        // 14pt tall quad from y=0 to y=14: thickness 1pt.
        let q = [0.0, 14.0, 20.0, 14.0, 0.0, 0.0, 20.0, 0.0];
        let u = super::text_line_band(&q, super::TextLine::Underline);
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert!(close(u[1], 14.0 * 0.12 + 0.5) && close(u[5], 14.0 * 0.12 - 0.5), "{u:?}");
        assert!(close(u[0], 0.0) && close(u[2], 20.0), "{u:?}");
        let s = super::text_line_band(&q, super::TextLine::StrikeOut);
        assert!(close(s[1], 14.0 * 0.42 + 0.5) && close(s[5], 14.0 * 0.42 - 0.5), "{s:?}");
        // Small text keeps a 0.5pt line; rotated quads (text running up) stay parallel.
        let small = super::text_line_band(&[0.0, 2.0, 5.0, 2.0, 0.0, 0.0, 5.0, 0.0], super::TextLine::Underline);
        assert!(close(small[1] - small[5], 0.5), "{small:?}");
        let up = super::text_line_band(&[0.0, 0.0, 0.0, 20.0, 14.0, 0.0, 14.0, 20.0], super::TextLine::Underline);
        assert!(close(up[0], up[2]) && close(up[4], up[6]) && close(up[4] - up[0], 1.0), "{up:?}");
    }

    #[test]
    fn text_line_appearance_fills_all_bands_once_without_a_group() {
        let a = super::text_line_appearance(
            &[[0.0, 14.0, 20.0, 14.0, 0.0, 0.0, 20.0, 0.0], [0.0, 34.0, 10.0, 34.0, 0.0, 20.0, 10.0, 20.0]],
            super::TextLine::StrikeOut,
            [1.0, 0.0, 0.0],
        );
        let c = String::from_utf8(a.content.clone()).unwrap();
        assert!(c.starts_with("q\n1 0 0 rg\n"), "{c}");
        assert_eq!(c.matches(" m\n").count(), 2, "{c}");
        assert_eq!(c.matches("f\n").count(), 1, "{c}");
        assert!(a.group.is_none() && !a.multiply && a.opacity == 1.0);
        assert_eq!(a.bbox, [0.0, 0.0, 20.0, 34.0]);
    }

    use super::*;

    #[test]
    fn shape_appearance_rect_fill_then_stroke() {
        let border = Stroke { color: [1.0, 0.0, 0.0], width: 2.0, opacity: 0.5 };
        let fill = Fill { color: [0.0, 0.0, 1.0], opacity: 0.25 };
        let a = shape_appearance(ShapeKind::Rect, [30.0, 40.0, 10.0, 20.0], Some(&border), Some(&fill));
        assert_eq!(
            text(&a),
            "q\n/GSf gs\n0 0 1 rg\n10 20 20 20 re\nf\nQ\nq\n/GSs gs\n2 w\n1 0 0 RG\n10 20 20 20 re\nS\nQ\n"
        );
        assert_eq!(a.bbox, [8.0, 18.0, 32.0, 42.0]);
        assert_eq!(
            a.gstates,
            vec![
                NamedGState { name: "GSf", fill_opacity: Some(0.25), stroke_opacity: None },
                NamedGState { name: "GSs", fill_opacity: None, stroke_opacity: Some(0.5) },
            ]
        );
        let outline = shape_appearance(ShapeKind::Circle, [0.0, 0.0, 10.0, 10.0], Some(&border), None);
        assert_eq!(text(&outline).matches(" c\n").count(), 4);
        assert_eq!(outline.gstates.len(), 1);
    }

    #[test]
    fn image_appearance_stretches_image_over_rect() {
        let a = image_appearance([10.0, 20.0, 110.0, 70.0], 0);
        assert_eq!(text(&a), "q
100 0 0 50 10 20 cm
/Im0 Do
Q
");
        assert!(a.image && a.matrix.is_none());
        assert_eq!(a.rect(), [10.0, 20.0, 110.0, 70.0]);
        // Rotate 90: the frame is the rect turned upright, mapped back onto it.
        let r = image_appearance([10.0, 20.0, 110.0, 70.0], 90);
        assert_eq!(text(&r), "q
50 0 0 100 10 20 cm
/Im0 Do
Q
");
        assert!(r.matrix.is_some());
        assert_eq!(r.rect(), [10.0, 20.0, 110.0, 70.0]);
    }

    #[test]
    fn freetext_appearance_layout() {
        // First baseline: x1 + 1.5 padding, top - 1.5 padding - 0.8 * 10 ascent.
        let lines = vec!["a(b)".to_string(), String::new(), "c".to_string()];
        let bg = Background { color: [1.0, 1.0, 0.0], opacity: 0.5 };
        let a = freetext_appearance([10.0, 20.0, 110.0, 70.0], &lines, 10.0, [0.0, 0.0, 1.0], Some(&bg), TextAlign::Left, 0);
        assert_eq!(
            text(&a),
            "q\n/GS0 gs\n1 1 0 rg\n10 20 100 50 re\nf\nQ\nBT\n/Helv 10 Tf\n0 0 1 rg\n11.5 60.5 Td\n(a\\(b\\)) Tj\n0 -12 Td\n0 -12 Td\n(c) Tj\nET\n"
        );
        assert_eq!(a.opacity, 0.5);
        assert!(a.uses_helvetica && !a.multiply);
        assert_eq!(a.bbox, [10.0, 20.0, 110.0, 70.0]);
        let plain = freetext_appearance([10.0, 20.0, 110.0, 70.0], &lines, 10.0, [0.0; 3], None, TextAlign::Left, 0);
        assert!(text(&plain).starts_with("BT\n"));
        assert_eq!(plain.opacity, 1.0);
    }

    #[test]
    fn freetext_appearance_centres_and_right_aligns_lines() {
        // Box 100 wide: text area 97 from x 11.5. "Hi" at 10 pt is 9.44 wide.
        let lines = vec!["Hi".to_string(), String::new()];
        let rect = [10.0, 20.0, 110.0, 70.0];
        let centre = freetext_appearance(rect, &lines, 10.0, [0.0; 3], None, TextAlign::Center, 0);
        // First line at 11.5 + (97 - 9.44) / 2 = 55.28; the empty line at the
        // centre, 48.5 from the inner edge (relative move 48.5 - 43.78).
        assert_eq!(text(&centre), "BT
/Helv 10 Tf
0 0 0 rg
55.28 60.5 Td
(Hi) Tj
4.72 -12 Td
ET
");
        let right = freetext_appearance(rect, &lines, 10.0, [0.0; 3], None, TextAlign::Right, 0);
        // 11.5 + 97 - 9.44 = 99.06; the empty line at the right edge (+9.44).
        assert_eq!(text(&right), "BT
/Helv 10 Tf
0 0 0 rg
99.06 60.5 Td
(Hi) Tj
9.44 -12 Td
ET
");
    }

    #[test]
    fn freetext_rotation_matrix_maps_frame_onto_rect() {
        let rect = [100.0, 500.0, 130.0, 700.0];
        let ninety = freetext_appearance(rect, &[], 12.0, [0.0; 3], None, TextAlign::Left, 90);
        assert_eq!(ninety.matrix, Some([0.0, 1.0, -1.0, 0.0, 630.0, 400.0]));
        // Frame top-left (screen top-left) lands on the rect's min corner, which is
        // the top-left on screen for Rotate 90 (right = +y, down = +x).
        let m = ninety.matrix.unwrap();
        let (fx, fy) = (ninety.bbox[0], ninety.bbox[3]);
        assert_eq!((m[0] * fx + m[2] * fy + m[4], m[1] * fx + m[3] * fy + m[5]), (100.0, 500.0));
        assert_eq!(freetext_appearance(rect, &[], 12.0, [0.0; 3], None, TextAlign::Left, -270).matrix, ninety.matrix);
        assert!(freetext_appearance(rect, &[], 12.0, [0.0; 3], None, TextAlign::Left, 45).matrix.is_none());
    }

    fn text(a: &Appearance) -> String {
        String::from_utf8(a.content.clone()).unwrap()
    }

    /// The opaque drawing of a grouped appearance (the `/Fm0` form).
    fn group_text(a: &Appearance) -> String {
        String::from_utf8(a.group.clone().expect("transparency group")).unwrap()
    }

    #[test]
    fn ink_and_highlight_paint_an_opaque_group_with_opacity_applied_once() {
        let ink = ink_appearance(
            &[vec![[0.0, 0.0], [10.0, 0.0]], vec![[5.0, -5.0], [5.0, 5.0]]],
            [1.0, 0.0, 0.0],
            2.0,
            0.4,
            true,
        );
        let hl = highlight_appearance(&[[0.0, 10.0, 10.0, 10.0, 0.0, 0.0, 10.0, 0.0]], [1.0, 0.5, 0.0], 0.4);
        for a in [&ink, &hl] {
            // Outer stream: opacity and blend mode (GS0), then the group, once.
            assert_eq!(text(a), "q\n/GS0 gs\n/Fm0 Do\nQ\n");
            assert_eq!(a.opacity, 0.4);
            assert!(a.multiply);
            // The group draws opaque paths: no graphics state changes inside.
            assert!(!group_text(a).contains(" gs"), "{}", group_text(a));
        }
        assert_eq!(group_text(&ink).matches("S\n").count(), 2);
        assert_eq!(group_text(&hl).matches("f\n").count(), 1);
        // Other appearances draw directly.
        let fill = Fill { color: [0.0; 3], opacity: 0.5 };
        assert!(shape_appearance(ShapeKind::Rect, [0.0, 0.0, 1.0, 1.0], None, Some(&fill)).group.is_none());
        assert!(freetext_appearance([0.0, 0.0, 10.0, 10.0], &[], 10.0, [0.0; 3], None, TextAlign::Left, 0).group.is_none());
    }

    #[test]
    fn highlight_appearance_uses_multiply() {
        let a = highlight_appearance(&[[0.0, 10.0, 10.0, 10.0, 0.0, 0.0, 10.0, 0.0]], [1.0, 0.5, 0.0], 0.4);
        assert!(a.multiply);
        assert_eq!(a.opacity, 0.4);
        assert!(!a.uses_helvetica);
        assert!(a.matrix.is_none());
        assert!(text(&a).contains("/GS0 gs\n"));
    }

    #[test]
    fn highlight_appearance_fills_each_quad_tl_tr_br_bl() {
        let a = highlight_appearance(
            &[
                [1.0, 20.0, 30.0, 20.0, 1.0, 10.0, 30.0, 10.0],
                [5.0, 8.0, 15.0, 8.0, 5.0, -2.0, 15.0, -2.0],
            ],
            [1.0, 0.5, 0.0],
            0.4,
        );
        assert_eq!(
            group_text(&a),
            "q\n1 0.5 0 rg\n1 20 m\n30 20 l\n30 10 l\n1 10 l\nh\nf\n5 8 m\n15 8 l\n15 -2 l\n5 -2 l\nh\nf\nQ\n"
        );
        assert_eq!(a.bbox, [1.0, -2.0, 30.0, 20.0]);
    }

    #[test]
    fn ink_appearance_bbox_includes_half_width() {
        let a = ink_appearance(&[vec![[10.0, 10.0], [20.0, 10.0]]], [0.0; 3], 4.0, 1.0, false);
        assert_eq!(a.bbox, [7.0, 7.0, 23.0, 13.0]);
    }

    #[test]
    fn ink_appearance_contains_curve_ops() {
        let a = ink_appearance(&[vec![[0.0, 0.0], [10.0, 10.0], [20.0, 0.0]]], [1.0, 0.0, 0.0], 2.0, 1.0, false);
        let t = group_text(&a);
        assert!(t.contains(" c\n"));
        assert!(t.ends_with("S\nQ\n"));
        assert!(t.starts_with("q\n2 w\n1 J\n1 j\n1 0 0 RG\n"), "{t}");
        let b = ink_appearance(&[vec![[0.0, 0.0], [10.0, 0.0]]], [0.0; 3], 2.0, 1.0, false);
        assert!(group_text(&b).contains(" l\n"));
        assert!(!group_text(&b).contains(" c\n"));
    }

    #[test]
    fn ink_curve_is_cubic_of_midpoint_quadratic() {
        // p0=(0,0) c=(10,10) end=mid((10,10),(20,0))=(15,5)
        // c1 = (6.667,6.667); c2 = (15+2/3*(10-15), 5+2/3*(10-5)) = (11.667,8.333)
        let a = ink_appearance(&[vec![[0.0, 0.0], [10.0, 10.0], [20.0, 0.0]]], [0.0; 3], 2.0, 1.0, false);
        let t = group_text(&a);
        assert!(t.contains("0 0 m\n6.667 6.667 11.667 8.333 15 5 c\n20 0 l\nS\n"), "{t}");
    }

    #[test]
    fn ink_single_point_is_zero_length_line() {
        let a = ink_appearance(&[vec![[5.0, 6.0]]], [0.0; 3], 2.0, 1.0, false);
        assert!(group_text(&a).contains("5 6 m\n5 6 l\nS\n"));
    }

    #[test]
    fn ink_skips_empty_strokes() {
        let a = ink_appearance(&[vec![], vec![[1.0, 1.0], [2.0, 2.0]]], [0.0; 3], 2.0, 1.0, false);
        assert_eq!(group_text(&a).matches("S\n").count(), 1);
        let none = ink_appearance(&[], [0.0; 3], 2.0, 1.0, false);
        assert_eq!(none.bbox, [0.0; 4]);
    }

    #[test]
    fn pressure_width_maps_medium_pressure_to_the_set_width() {
        assert_eq!(pressure_width(2.0, 0.5), 2.0);
        assert!((pressure_width(2.0, 0.0) - 0.8).abs() < 1e-12);
        assert!((pressure_width(2.0, 1.0) - 3.2).abs() < 1e-12);
        assert_eq!(pressure_width(2.0, 7.0), pressure_width(2.0, 1.0), "clamped");
    }

    #[test]
    fn ink_pressure_straight_stroke_is_one_closed_clockwise_outline() {
        // Horizontal stroke, constant pressure 0.5 → half width 1 at both ends.
        let a = ink_pressure_appearance(&[vec![[0.0, 0.0], [10.0, 0.0]]], &[vec![0.5, 0.5]], [1.0, 0.0, 0.0], 2.0, 0.5, false);
        let t = group_text(&a);
        assert!(t.starts_with("q\n1 0 0 rg\n0 1 m\n10 1 l\n"), "left edge forward: {t}");
        // End cap from the left edge round the front to the right edge, then the right edge back.
        assert!(t.contains("11 0 c\n") && t.contains("10 -1 c\n0 -1 l\n"), "{t}");
        assert!(t.contains("-1 0 c\n") && t.ends_with("0 1 c\nh\nf\nQ\n"), "start cap closes the outline: {t}");
        assert_eq!(t.matches(" m\n").count(), 1);
        assert_eq!(a.opacity, 0.5);
        assert_eq!(a.bbox, [-2.0, -2.0, 12.0, 2.0]);
    }

    #[test]
    fn ink_pressure_width_follows_pressure_along_the_stroke() {
        let a = ink_pressure_appearance(&[vec![[0.0, 0.0], [10.0, 0.0]]], &[vec![0.0, 1.0]], [0.0; 3], 2.0, 1.0, false);
        let t = group_text(&a);
        // Half widths 0.4 at the start, 1.6 at the end.
        assert!(t.contains("0 0.4 m\n10 1.6 l\n"), "{t}");
        assert_eq!(a.bbox, [-2.6, -2.6, 12.6, 2.6], "padded by the widest point");
    }

    #[test]
    fn ink_pressure_single_point_is_a_circle_and_all_strokes_share_one_fill() {
        let a = ink_pressure_appearance(
            &[vec![[5.0, 5.0]], vec![], vec![[0.0, 0.0], [0.0, 10.0], [10.0, 10.0]]],
            &[vec![0.5], vec![], vec![0.5, 0.5, 0.5]],
            [0.0; 3],
            2.0,
            1.0,
            false,
        );
        let t = group_text(&a);
        assert!(t.starts_with("q\n0 0 0 rg\n6 5 m\n"), "{t}");
        assert_eq!(t.matches(" m\n").count(), 2);
        assert_eq!(t.matches("h\n").count(), 2);
        assert_eq!(t.matches("f\n").count(), 1);
    }

    #[test]
    fn ink_pressure_missing_or_mismatched_pressure_keeps_the_set_width() {
        let set = ink_pressure_appearance(&[vec![[0.0, 0.0], [10.0, 0.0]]], &[vec![0.5, 0.5]], [0.0; 3], 2.0, 1.0, false);
        let missing = ink_pressure_appearance(&[vec![[0.0, 0.0], [10.0, 0.0]]], &[], [0.0; 3], 2.0, 1.0, false);
        let mismatched = ink_pressure_appearance(&[vec![[0.0, 0.0], [10.0, 0.0]]], &[vec![1.0]], [0.0; 3], 2.0, 1.0, false);
        assert_eq!(group_text(&missing), group_text(&set));
        assert_eq!(group_text(&mismatched), group_text(&set));
    }

    #[test]
    fn ink_appearance_multiply_flag() {
        let a = ink_appearance(&[vec![[0.0, 0.0]]], [0.0; 3], 2.0, 0.5, true);
        assert!(a.multiply);
        assert_eq!(a.opacity, 0.5);
        assert!(!a.uses_helvetica);
        assert!(a.matrix.is_none());
    }

    #[test]
    fn ink_four_points_second_segment_starts_at_midpoint() {
        let a = ink_appearance(&[vec![[0.0, 0.0], [10.0, 0.0], [20.0, 10.0], [30.0, 10.0]]], [0.0; 3], 2.0, 1.0, false);
        let t = group_text(&a);
        // first end = mid(p1,p2) = (15,5); second curve: c = p2, p0' = (15,5), end = mid(p2,p3) = (25,10)
        // c1 = 15+2/3*(20-15), 5+2/3*(10-5) = 18.333 8.333; c2 = 25+2/3*(20-25), 10+2/3*(10-10) = 21.667 10
        assert!(t.contains("15 5 c
18.333 8.333 21.667 10 25 10 c
30 10 l
S
"), "{t}");
        assert_eq!(t.matches(" c
").count(), 2);
    }
}

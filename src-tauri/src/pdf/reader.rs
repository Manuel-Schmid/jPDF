//! Maps a document's `/Ink`, `/Highlight`, `/Underline`, `/StrikeOut`, `/FreeText`, `/Square`,
//! `/Circle`, `/Line` and `/PolyLine` annotations, and the `/Stamp`s JuliePDF saved for pasted images,
//! to DTOs.
//! `/JuliePDF` values win; foreign annotations get defaults. Other subtypes,
//! annotations stored inline in `/Annots` (which cannot be addressed by ref),
//! hidden ones and ones JuliePDF cannot draw (no points, no quads, empty
//! `/Rect`) are skipped: pdf.js keeps drawing them, display-only.
use lopdf::{Dictionary, Document, Object, decode_text_string};

use super::date::iso_from_pdf_date;
use super::dto::{AnnotationDto, Background, Blend, Common, Fill, ImageData, InkRole, ShapeKind, Stroke, TextAlign};
use super::image::{encode_base64, png_size};
use super::{annotation_nm, annotation_refs, format_source_ref, load_document, nm_owners};
use crate::error::AppError;

const BLACK: [f64; 3] = [0.0; 3];

pub fn read_annotations(bytes: &[u8]) -> Result<Vec<AnnotationDto>, AppError> {
    let doc = load_document(bytes)?;
    let owners = nm_owners(&doc);
    let mut out = Vec::new();
    for (index, id) in annotation_refs(&doc) {
        let Ok(d) = doc.get_dictionary(id) else {
            continue;
        };
        // A repeated /NM keeps ids unique: only its first carrier uses it.
        let annotation_id = annotation_nm(&doc, d)
            .filter(|nm| owners.get(nm) == Some(&id))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let common = Common {
            id: annotation_id,
            page: index as u32,
            source_ref: Some(format_source_ref(id)),
            modified_at: text(&doc, d, b"M")
                .and_then(|m| iso_from_pdf_date(&m))
                .unwrap_or_default(),
            author: text(&doc, d, b"T").unwrap_or_default(),
            flattened: false,
        };
        if let Some(dto) = map_annotation(&doc, d, common) {
            out.push(dto);
        }
    }
    Ok(out)
}

/// `/F` Hidden (bit 2) and NoView (bit 6).
const HIDDEN_FLAGS: i64 = 2 | 32;

fn map_annotation(doc: &Document, d: &Dictionary, common: Common) -> Option<AnnotationDto> {
    let subtype = deref(doc, d.get(b"Subtype").ok()?).as_name().ok()?;
    let flags = number(doc, d.get(b"F").ok()).unwrap_or(0.0) as i64;
    if flags & HIDDEN_FLAGS != 0 {
        return None;
    }
    let private = d.get_deref(b"JuliePDF", doc).and_then(Object::as_dict).ok();
    let private_name =
        |key: &[u8]| private.and_then(|p| p.get_deref(key, doc).and_then(Object::as_name).ok());
    let color = color_of(doc, d.get(b"C").ok()).unwrap_or(BLACK);
    let opacity = number(doc, d.get(b"CA").ok()).unwrap_or(1.0);
    match subtype {
        b"Ink" => {
            let strokes: Vec<Vec<[f64; 2]>> = d
                .get_deref(b"InkList", doc)
                .and_then(Object::as_array)
                .map(|list| list.iter().map(|s| points(doc, s)).collect())
                .unwrap_or_default();
            if strokes.iter().all(|s| s.is_empty()) {
                return None;
            }
            let width = d
                .get_deref(b"BS", doc)
                .and_then(Object::as_dict)
                .ok()
                .and_then(|bs| number(doc, bs.get(b"W").ok()))
                .unwrap_or(1.0);
            let role = match private_name(b"role") {
                Some(b"marker") => InkRole::Marker,
                _ => InkRole::Pen,
            };
            let blend = match private_name(b"blend") {
                Some(b"multiply") => Blend::Multiply,
                _ => Blend::Normal,
            };
            // Pen pressure, kept only while it still pairs with the points
            // (another editor may have changed the strokes).
            let pressure = private
                .and_then(|p| p.get_deref(b"pressure", doc).and_then(Object::as_array).ok())
                .map(|lists| lists.iter().map(|l| numbers(doc, Some(l))).collect::<Vec<_>>())
                .filter(|lists| lists.len() == strokes.len() && lists.iter().zip(&strokes).all(|(p, s)| p.len() == s.len()));
            Some(AnnotationDto::Ink {
                common,
                strokes,
                color,
                width,
                opacity,
                blend,
                role,
                pressure,
            })
        }
        b"Highlight" => {
            let flat = numbers(doc, d.get(b"QuadPoints").ok());
            let quads = flat.as_chunks::<8>().0.to_vec();
            if quads.is_empty() {
                return None;
            }
            Some(AnnotationDto::Highlight {
                common,
                quads,
                color,
                opacity,
            })
        }
        b"Underline" | b"StrikeOut" => {
            let flat = numbers(doc, d.get(b"QuadPoints").ok());
            let quads = flat.as_chunks::<8>().0.to_vec();
            if quads.is_empty() {
                return None;
            }
            Some(if subtype == b"Underline" {
                AnnotationDto::Underline { common, quads, color }
            } else {
                AnnotationDto::Strikeout { common, quads, color }
            })
        }
        b"FreeText" => {
            let r = numbers(doc, d.get(b"Rect").ok());
            if r.len() != 4 || r.iter().any(|v| !v.is_finite()) {
                return None;
            }
            let rect = [
                r[0].min(r[2]),
                r[1].min(r[3]),
                r[0].max(r[2]),
                r[1].max(r[3]),
            ];
            if rect[2] <= rect[0] || rect[3] <= rect[1] {
                return None;
            }
            let (da_size, da_color) = parse_da(&text(doc, d, b"DA").unwrap_or_default());
            let c = color_of(doc, d.get(b"C").ok());
            // JuliePDF keeps /CA at 1 and font size, text colour and background
            // opacity in /JuliePDF (exact, unlike the rounded /DA).
            let private_num = |key: &[u8]| private.and_then(|p| number(doc, p.get(key).ok()));
            let private_bool =
                |key: &[u8]| private.and_then(|p| p.get_deref(key, doc).and_then(Object::as_bool).ok());
            let font_size = private_num(b"fontSize").filter(|s| *s > 0.0).unwrap_or(da_size);
            let text_color = private
                .and_then(|p| components_to_rgb(&numbers(doc, p.get(b"textColor").ok())))
                .map(snap_rgb)
                .unwrap_or(da_color);
            let background = match private_bool(b"hasBg") {
                Some(false) => None,
                // A background without a colour cannot be drawn: none.
                Some(true) => c.map(|color| Background {
                    color: snap_rgb(color),
                    opacity: private_num(b"bgOpacity").unwrap_or(1.0),
                }),
                None => c.map(|color| Background { color, opacity }),
            };
            Some(AnnotationDto::Freetext {
                common,
                rect,
                text: text(doc, d, b"Contents").unwrap_or_default(),
                lines: Vec::new(),
                font_size,
                text_color,
                background,
                align: match d.get(b"Q").ok().and_then(|q| q.as_i64().ok()) {
                    Some(1) => TextAlign::Center,
                    Some(2) => TextAlign::Right,
                    _ => TextAlign::Left,
                },
            })
        }
        b"Stamp" if private_name(b"kind") == Some(b"image") => map_image(doc, d, private?, common),
        b"Square" | b"Circle" => {
            let shape = if subtype == b"Square" { ShapeKind::Rect } else { ShapeKind::Circle };
            map_shape(doc, d, private, shape, opacity, common)
        }
        b"Line" | b"PolyLine" => map_line(doc, d, private.is_some(), subtype == b"Line", opacity, common),
        _ => None,
    }
}

/// How far (pt) `/Rect` may differ from the bbox JuliePDF wrote and still count as unchanged.
const RECT_EPSILON: f64 = 0.01;

fn normalized(r: &[f64]) -> [f64; 4] {
    [r[0].min(r[2]), r[1].min(r[3]), r[0].max(r[2]), r[1].max(r[3])]
}

/// `/Square` and `/Circle`. JuliePDF's own keep the geometric rect, both
/// opacities and which of border and fill exist in `/JuliePDF` (`/CA` is 1).
/// The private rect is used only while `/Rect` is still the bbox JuliePDF
/// wrote for it (stroke-expanded + 1); a `/Rect` of the same size elsewhere
/// (moved by another editor) shifts it; any other `/Rect` (resized elsewhere)
/// is read like a foreign one. Foreign geometry: `/Rect` inset by `/RD`, then
/// by half the border width. Border width: `/BS /W`, else the third entry of
/// `/Border`, else 1; 0 means no border. Foreign colours: border `/C`, fill
/// `/IC` (none when missing or empty), both with opacity `/CA`. Zero-area
/// shapes and ones with neither border nor fill are skipped.
fn map_shape(
    doc: &Document,
    d: &Dictionary,
    private: Option<&Dictionary>,
    shape: ShapeKind,
    opacity: f64,
    common: Common,
) -> Option<AnnotationDto> {
    let width = border_width(doc, d);
    let c = color_of(doc, d.get(b"C").ok());
    let ic = color_of(doc, d.get(b"IC").ok());
    let r = numbers(doc, d.get(b"Rect").ok());
    let outer = (r.len() == 4).then(|| normalized(&r));
    let private_num = |key: &[u8]| private.and_then(|p| number(doc, p.get(key).ok()));
    let private_bool =
        |key: &[u8]| private.and_then(|p| p.get_deref(key, doc).and_then(Object::as_bool).ok());

    let (border, fill) = match private {
        Some(_) => (
            match private_bool(b"hasBorder") {
                Some(false) => None,
                _ => c.filter(|_| width > 0.0).map(|color| Stroke {
                    color: snap_rgb(color),
                    width,
                    opacity: private_num(b"borderOpacity").unwrap_or(1.0),
                }),
            },
            match private_bool(b"hasFill") {
                Some(false) => None,
                _ => ic.map(|color| Fill {
                    color: snap_rgb(color),
                    opacity: private_num(b"fillOpacity").unwrap_or(1.0),
                }),
            },
        ),
        None => (
            c.filter(|_| width > 0.0).map(|color| Stroke { color, width, opacity }),
            ic.map(|color| Fill { color, opacity }),
        ),
    };

    // The rect JuliePDF saved, shifted along with /Rect if another editor moved it.
    let private_rect = private
        .map(|p| numbers(doc, p.get(b"rect").ok()))
        .filter(|p| p.len() == 4)
        .map(|p| normalized(&p))
        .and_then(|p| {
            let pad = border.as_ref().map_or(0.0, |b| b.width / 2.0) + 1.0;
            let written = [p[0] - pad, p[1] - pad, p[2] + pad, p[3] + pad];
            let Some(o) = outer else { return Some(p) };
            let near = |a: f64, b: f64| (a - b).abs() <= RECT_EPSILON;
            let same_size = near(o[2] - o[0], written[2] - written[0]) && near(o[3] - o[1], written[3] - written[1]);
            if !same_size {
                return None;
            }
            let (dx, dy) = (o[0] - written[0], o[1] - written[1]);
            if near(dx, 0.0) && near(dy, 0.0) {
                Some(p)
            } else {
                Some([p[0] + dx, p[1] + dy, p[2] + dx, p[3] + dy])
            }
        });

    let rect = match private_rect {
        Some(p) => p,
        None => {
            let o = outer?;
            let rd = numbers(doc, d.get(b"RD").ok());
            let rd = if rd.len() == 4 { [rd[0], rd[1], rd[2], rd[3]] } else { [0.0; 4] };
            let h = width / 2.0;
            [o[0] + rd[0] + h, o[1] + rd[1] + h, o[2] - rd[2] - h, o[3] - rd[3] - h]
        }
    };
    // An inset larger than the rect leaves nothing to draw.
    if rect.iter().any(|v| !v.is_finite()) || rect[2] <= rect[0] || rect[3] <= rect[1] {
        return None;
    }
    if border.is_none() && fill.is_none() {
        return None;
    }
    Some(AnnotationDto::Shape {
        common,
        shape,
        rect,
        border,
        fill,
    })
}

/// Border width: `/BS /W`, else the third entry of `/Border`, else 1.
fn border_width(doc: &Document, d: &Dictionary) -> f64 {
    d.get_deref(b"BS", doc)
        .and_then(Object::as_dict)
        .ok()
        .map(|bs| number(doc, bs.get(b"W").ok()).unwrap_or(1.0))
        .or_else(|| numbers(doc, d.get(b"Border").ok()).get(2).copied())
        .filter(|w| w.is_finite() && *w >= 0.0)
        .unwrap_or(1.0)
}

/// `/Line` (`/L`) and `/PolyLine` (`/Vertices`), stroked with `/C` at width
/// `border_width` and opacity `/CA`. An arrow ending (`/OpenArrow`,
/// `/ClosedArrow`) at the end of `/LE` becomes the arrowhead; one only at the
/// start too, with the points reversed; other endings are dropped. A foreign
/// line with leader lines (`/LL`) is drawn where the viewer shows it: offset
/// by `/LL`, clockwise of its direction. Lines without a colour, with width 0
/// or fewer than two points are skipped.
fn map_line(
    doc: &Document,
    d: &Dictionary,
    own: bool,
    straight: bool,
    opacity: f64,
    common: Common,
) -> Option<AnnotationDto> {
    let mut points = if straight {
        let l = numbers(doc, d.get(b"L").ok());
        if l.len() != 4 {
            return None;
        }
        let (a, b) = ([l[0], l[1]], [l[2], l[3]]);
        let ll = number(doc, d.get(b"LL").ok()).filter(|v| v.is_finite()).unwrap_or(0.0);
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        if ll != 0.0 && len > 0.0 {
            let (ox, oy) = ((b[1] - a[1]) / len * ll, -(b[0] - a[0]) / len * ll);
            vec![[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy]]
        } else {
            vec![a, b]
        }
    } else {
        d.get(b"Vertices").map(|v| points(doc, v)).unwrap_or_default()
    };
    if points.len() < 2 || points.iter().flatten().any(|v| !v.is_finite()) {
        return None;
    }
    let width = border_width(doc, d);
    let color = color_of(doc, d.get(b"C").ok())?;
    if width <= 0.0 {
        return None;
    }
    let endings: Vec<&[u8]> = d
        .get_deref(b"LE", doc)
        .and_then(Object::as_array)
        .map(|a| a.iter().filter_map(|n| deref(doc, n).as_name().ok()).collect())
        .unwrap_or_default();
    let is_arrow = |n: Option<&&[u8]>| matches!(n, Some(&b"OpenArrow") | Some(&b"ClosedArrow"));
    let arrow = if is_arrow(endings.get(1)) {
        true
    } else if is_arrow(endings.first()) {
        points.reverse();
        true
    } else {
        false
    };
    Some(AnnotationDto::Line {
        common,
        points,
        arrow,
        border: Stroke { color: if own { snap_rgb(color) } else { color }, width, opacity },
    })
}

/// A pasted image: the original PNG from `/JuliePDF /png`, drawn into
/// `/Rect`. Without a readable PNG it stays a foreign (display-only) stamp.
fn map_image(doc: &Document, d: &Dictionary, private: &Dictionary, common: Common) -> Option<AnnotationDto> {
    let png = private.get(b"png").and_then(Object::as_reference).ok()?;
    let bytes = doc.get_object(png).and_then(Object::as_stream).ok()?.get_plain_content().ok()?;
    let (width, height) = png_size(&bytes)?;
    let r = numbers(doc, d.get(b"Rect").ok());
    if r.len() != 4 || r.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let rect = normalized(&r);
    if rect[2] <= rect[0] || rect[3] <= rect[1] {
        return None;
    }
    Some(AnnotationDto::Image {
        common,
        rect,
        image: ImageData { width, height, png: encode_base64(&bytes) },
    })
}

fn deref<'a>(doc: &'a Document, o: &'a Object) -> &'a Object {
    doc.dereference(o).map(|(_, o)| o).unwrap_or(o)
}

fn text(doc: &Document, d: &Dictionary, key: &[u8]) -> Option<String> {
    decode_text_string(deref(doc, d.get(key).ok()?)).ok()
}

/// lopdf stores reals as f32; going through the shortest decimal form turns
/// 123.45679f32 back into 123.45679 rather than 123.456787109375.
fn number(doc: &Document, o: Option<&Object>) -> Option<f64> {
    match deref(doc, o?) {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => r.to_string().parse().ok(),
        _ => None,
    }
}

fn numbers(doc: &Document, o: Option<&Object>) -> Vec<f64> {
    o.and_then(|o| deref(doc, o).as_array().ok())
        .map(|a| a.iter().filter_map(|v| number(doc, Some(v))).collect())
        .unwrap_or_default()
}

fn points(doc: &Document, stroke: &Object) -> Vec<[f64; 2]> {
    numbers(doc, Some(stroke)).as_chunks::<2>().0.to_vec()
}

/// `/C` with 1 (gray), 3 (RGB) or 4 (CMYK) components; empty = transparent → `None`.
fn color_of(doc: &Document, o: Option<&Object>) -> Option<[f64; 3]> {
    components_to_rgb(&numbers(doc, o))
}

fn components_to_rgb(c: &[f64]) -> Option<[f64; 3]> {
    match *c {
        [g] => Some([g, g, g]),
        [r, g, b] => Some([r, g, b]),
        [c, m, y, k] => Some([
            (1.0 - c) * (1.0 - k),
            (1.0 - m) * (1.0 - k),
            (1.0 - y) * (1.0 - k),
        ]),
        _ => None,
    }
}

/// PDF reals carry about 7 significant digits (lopdf stores them as f32), so
/// a colour picked as `k/255` (e.g. 32/255) comes back as 0.1254902. Snaps
/// components that are that close to the `k/255` grid back onto it; other
/// values (presets such as 0.898) are left alone.
fn snap_rgb(c: [f64; 3]) -> [f64; 3] {
    c.map(|v| {
        let k = (v * 255.0).round();
        let exact = k / 255.0;
        if (v - exact).abs() <= 1e-6 { exact } else { v }
    })
}

/// Font size and fill colour from a default appearance string such as
/// `/Helv 12 Tf 0 0 0 rg`. Defaults: 12 and black.
fn parse_da(da: &str) -> (f64, [f64; 3]) {
    let mut size = 12.0;
    let mut color = BLACK;
    let mut operands: Vec<f64> = Vec::new();
    for token in da.split_whitespace() {
        if let Ok(v) = token.parse::<f64>() {
            operands.push(v);
            continue;
        }
        let n = operands.len();
        match token {
            "Tf" if n >= 1 && operands[n - 1] > 0.0 => size = operands[n - 1],
            "g" if n >= 1 => color = components_to_rgb(&operands[n - 1..]).unwrap_or(color),
            "rg" if n >= 3 => color = components_to_rgb(&operands[n - 3..]).unwrap_or(color),
            "k" if n >= 4 => color = components_to_rgb(&operands[n - 4..]).unwrap_or(color),
            _ => {}
        }
        operands.clear();
    }
    (size, color)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn da_parsing() {
        assert_eq!(parse_da("/Helv 12 Tf 0 0 0 rg"), (12.0, BLACK));
        assert_eq!(parse_da("/Helv 9.5 Tf 1 0 0 rg"), (9.5, [1.0, 0.0, 0.0]));
        assert_eq!(parse_da("0.5 g /F1 14 Tf"), (14.0, [0.5, 0.5, 0.5]));
        assert_eq!(parse_da("/Helv 0 Tf 0 0 0 1 k"), (12.0, BLACK));
        assert_eq!(parse_da(""), (12.0, BLACK));
    }

    #[test]
    fn colour_components() {
        assert_eq!(components_to_rgb(&[]), None);
        assert_eq!(
            components_to_rgb(&[0.0, 1.0, 0.0, 0.0]),
            Some([1.0, 0.0, 1.0])
        );
    }
}

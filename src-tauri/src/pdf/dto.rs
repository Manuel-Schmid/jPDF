use serde::{Deserialize, Serialize};

/// JSON shape is identical to the TS model in `src/core/session/model.ts`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Common {
    pub id: String,
    pub page: u32,
    pub source_ref: Option<String>,
    pub modified_at: String,
    pub author: String,
    /// Burn the annotation into the page content instead of saving it as an
    /// annotation (see `Writer::flatten`). Left out of the JSON when false,
    /// as the TS model leaves it out.
    #[serde(default, skip_serializing_if = "is_false")]
    pub flattened: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// An annotation deleted in the app: the writer only detaches `source_ref`
/// if that object is still the annotation `id` was read as.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRef {
    pub id: String,
    pub source_ref: String,
}

/// The z-order (bottom first) of a reordered page's annotations, to write as
/// the order of its `/Annots`. Same JSON shape as `PageOrder` in
/// `src/core/session/store.svelte.ts`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageOrder {
    pub page: u32,
    pub annotations: Vec<OrderedRef>,
}

/// An annotation of a `PageOrder`: its id and the file object it was saved
/// as before this save (`None` when new).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrderedRef {
    pub id: String,
    pub source_ref: Option<String>,
}

/// One page of a save plan (the page list as the user arranged it), in the
/// new order. Same JSON shape as `PageSpec` in `src/core/session/pages.ts`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum PageSpec {
    /// Page `index` (0-based) of the source file with the absolute final `/Rotate`.
    Source { index: u32, rotate: i32 },
    /// An empty page of `width` x `height` points (unrotated) with this `/Rotate`.
    Blank { width: f64, height: f64, rotate: i32 },
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Blend {
    Normal,
    Multiply,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InkRole {
    Pen,
    Marker,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Background {
    pub color: [f64; 3],
    pub opacity: f64,
}

/// Horizontal alignment of a text box's lines (`/Q` 0, 1, 2). Left when absent,
/// so DTOs from before alignment existed still parse.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// A shape's fill: same JSON shape as a text box background.
pub type Fill = Background;

/// A shape's border (stroke).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Stroke {
    pub color: [f64; 3],
    pub width: f64,
    pub opacity: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ShapeKind {
    Rect,
    Circle,
}

/// A pasted image: its pixel size and the PNG file, base64 without a `data:` prefix.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ImageData {
    pub width: u32,
    pub height: u32,
    pub png: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum AnnotationDto {
    Highlight {
        #[serde(flatten)]
        common: Common,
        quads: Vec<[f64; 8]>,
        color: [f64; 3],
        opacity: f64,
    },
    /// Underlined text: `quads` are the text's line boxes, the line is drawn inside them.
    Underline {
        #[serde(flatten)]
        common: Common,
        quads: Vec<[f64; 8]>,
        color: [f64; 3],
    },
    /// Struck-through text, as `Underline`.
    Strikeout {
        #[serde(flatten)]
        common: Common,
        quads: Vec<[f64; 8]>,
        color: [f64; 3],
    },
    Ink {
        #[serde(flatten)]
        common: Common,
        strokes: Vec<Vec<[f64; 2]>>,
        color: [f64; 3],
        width: f64,
        opacity: f64,
        blend: Blend,
        role: InkRole,
    },
    Freetext {
        #[serde(flatten)]
        common: Common,
        rect: [f64; 4],
        text: String,
        lines: Vec<String>,
        font_size: f64,
        text_color: [f64; 3],
        background: Option<Background>,
        #[serde(default)]
        align: TextAlign,
    },
    /// `rect` is the geometric outline (centre of the border stroke); for
    /// circles the bounding box of the circle (an ellipse after resizing).
    Shape {
        #[serde(flatten)]
        common: Common,
        shape: ShapeKind,
        rect: [f64; 4],
        border: Option<Stroke>,
        fill: Option<Fill>,
    },
    /// A line (two points), a polyline (more) or either with an open
    /// arrowhead at its last point; `points` are the centre line of the stroke.
    Line {
        #[serde(flatten)]
        common: Common,
        points: Vec<[f64; 2]>,
        arrow: bool,
        border: Stroke,
    },
    /// A pasted image drawn upright on screen into `rect` (stretched to fill it).
    Image {
        #[serde(flatten)]
        common: Common,
        rect: [f64; 4],
        image: ImageData,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    /// JS has one number type; compare numbers as f64 so `1` equals `1.0`.
    fn norm(v: Value) -> Value {
        match v {
            Value::Number(n) => json!(n.as_f64().unwrap()),
            Value::Array(a) => Value::Array(a.into_iter().map(norm).collect()),
            Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, norm(v))).collect()),
            other => other,
        }
    }

    fn roundtrip(src: &str) -> (AnnotationDto, Value, Value) {
        let dto: AnnotationDto = serde_json::from_str(src).unwrap();
        let out = serde_json::to_value(&dto).unwrap();
        (dto, norm(out), norm(serde_json::from_str(src).unwrap()))
    }

    #[test]
    fn dto_json_matches_ts_shape() {
        let src = r#"{"kind":"ink","id":"a","page":0,"sourceRef":null,"modifiedAt":"2026-11-18T10:00:00Z","author":"JuliePDF","strokes":[[[0,0],[10,0]]],"color":[1,0,0],"width":2,"opacity":1,"blend":"normal","role":"pen"}"#;
        let (dto, out, orig) = roundtrip(src);
        assert!(matches!(dto, AnnotationDto::Ink { .. }));
        assert_eq!(out, orig);
    }

    #[test]
    fn dto_freetext_camel_case_roundtrip() {
        let src = r#"{"kind":"freetext","id":"f","page":2,"sourceRef":"12R3","modifiedAt":"2026-11-18T10:00:00Z","author":"J","rect":[1,2,3,4],"text":"a\nb","lines":["a","b"],"fontSize":12,"textColor":[0,0,0],"background":{"color":[1,1,0],"opacity":0.5},"align":"center"}"#;
        let (dto, out, orig) = roundtrip(src);
        assert!(matches!(dto, AnnotationDto::Freetext { font_size, align: TextAlign::Center, .. } if font_size == 12.0));
        assert_eq!(out, orig);
    }

    #[test]
    fn dto_freetext_without_align_is_left_aligned() {
        let src = r#"{"kind":"freetext","id":"f","page":0,"sourceRef":null,"modifiedAt":"","author":"J","rect":[1,2,3,4],"text":"","lines":[],"fontSize":12,"textColor":[0,0,0],"background":null}"#;
        let dto: AnnotationDto = serde_json::from_str(src).unwrap();
        assert!(matches!(dto, AnnotationDto::Freetext { align: TextAlign::Left, .. }));
    }

    #[test]
    fn page_spec_json_matches_ts_shape() {
        let src = r#"[{"kind":"source","index":2,"rotate":90},{"kind":"blank","width":595.5,"height":842,"rotate":0}]"#;
        let specs: Vec<PageSpec> = serde_json::from_str(src).unwrap();
        assert_eq!(
            specs,
            vec![
                PageSpec::Source { index: 2, rotate: 90 },
                PageSpec::Blank { width: 595.5, height: 842.0, rotate: 0 },
            ]
        );
        assert_eq!(norm(serde_json::to_value(&specs).unwrap()), norm(serde_json::from_str(src).unwrap()));
    }

    #[test]
    fn dto_text_line_kinds() {
        let src = r#"{"kind":"strikeout","id":"s","page":0,"sourceRef":null,"modifiedAt":"t","author":"J","quads":[[0,10,10,10,0,0,10,0]],"color":[1,0,0]}"#;
        let dto: AnnotationDto = serde_json::from_str(src).unwrap();
        assert!(matches!(dto, AnnotationDto::Strikeout { .. }));
        assert_eq!(norm(serde_json::to_value(&dto).unwrap()), norm(serde_json::from_str(src).unwrap()));
        let u = src.replace("strikeout", "underline");
        assert!(matches!(serde_json::from_str(&u).unwrap(), AnnotationDto::Underline { .. }));
    }

    #[test]
    fn dto_highlight_roundtrip() {
        let src = r#"{"kind":"highlight","id":"h","page":1,"sourceRef":null,"modifiedAt":"t","author":"J","quads":[[0,10,10,10,0,0,10,0]],"color":[1,1,0],"opacity":0.4}"#;
        let (dto, out, orig) = roundtrip(src);
        assert!(matches!(dto, AnnotationDto::Highlight { .. }));
        assert_eq!(out, orig);
    }

    #[test]
    fn dto_line_roundtrip() {
        let src = r#"{"kind":"line","id":"l","page":1,"sourceRef":null,"modifiedAt":"t","author":"J","points":[[1,2],[3,4],[5,6]],"arrow":true,"border":{"color":[1,0,0],"width":2,"opacity":0.5}}"#;
        let (dto, input, output) = roundtrip(src);
        assert!(matches!(dto, AnnotationDto::Line { arrow: true, ref points, .. } if points.len() == 3));
        assert_eq!(input, output);
    }

    #[test]
    fn dto_shape_roundtrip() {
        let src = r#"{"kind":"shape","id":"s","page":0,"sourceRef":null,"modifiedAt":"t","author":"J","shape":"circle","rect":[1,2,3,4],"border":{"color":[1,0,0],"width":2,"opacity":0.5},"fill":null}"#;
        let (dto, out, orig) = roundtrip(src);
        assert!(matches!(dto, AnnotationDto::Shape { shape: ShapeKind::Circle, fill: None, .. }));
        assert_eq!(out, orig);
        let src = r#"{"kind":"shape","id":"s","page":0,"sourceRef":"3R","modifiedAt":"t","author":"J","shape":"rect","rect":[1,2,3,4],"border":null,"fill":{"color":[0,1,0],"opacity":0.4}}"#;
        let (_, out, orig) = roundtrip(src);
        assert_eq!(out, orig);
    }

    #[test]
    fn dto_image_roundtrip() {
        let src = r#"{"kind":"image","id":"i","page":0,"sourceRef":null,"modifiedAt":"t","author":"J","rect":[1,2,3,4],"image":{"width":2,"height":1,"png":"iVBORw0KGgo="}}"#;
        let (dto, out, orig) = roundtrip(src);
        assert!(matches!(dto, AnnotationDto::Image { ref image, .. } if image.width == 2 && image.height == 1));
        assert_eq!(out, orig);
    }

    #[test]
    fn dto_flattened_flag_roundtrip() {
        let src = r#"{"kind":"highlight","id":"h","page":1,"sourceRef":null,"modifiedAt":"t","author":"J","flattened":true,"quads":[[0,10,10,10,0,0,10,0]],"color":[1,1,0],"opacity":0.4}"#;
        let (dto, out, orig) = roundtrip(src);
        assert!(matches!(dto, AnnotationDto::Highlight { ref common, .. } if common.flattened));
        assert_eq!(out, orig);
        // Absent means false, and false is not written.
        let (dto, out, _) = roundtrip(&src.replace(r#""flattened":true,"#, ""));
        assert!(matches!(dto, AnnotationDto::Highlight { ref common, .. } if !common.flattened));
        assert!(out.get("flattened").is_none());
    }

    #[test]
    fn dto_roundtrip_is_exact_for_non_dyadic_values() {
        let src = r#"{"kind":"ink","id":"a","page":0,"sourceRef":null,"modifiedAt":"t","author":"J","strokes":[[[123.456789,0.1]]],"color":[0.4,0.2,0.7],"width":2.5,"opacity":0.4,"blend":"multiply","role":"marker"}"#;
        let dto: AnnotationDto = serde_json::from_str(src).unwrap();
        let out = serde_json::to_value(&dto).unwrap();
        assert_eq!(out, serde_json::from_str::<Value>(src).unwrap());
    }
}

mod fixtures;

use std::collections::HashSet;

use juliepdf_lib::commands::files::save_to_path;
use juliepdf_lib::error::AppError;
use juliepdf_lib::pdf::appearance::{freetext_appearance, shape_appearance};
use juliepdf_lib::pdf::dto::{
    AnnotationDto, Background, Blend, Common, DeleteRef, Fill, InkRole, OrderedRef, PageOrder, ShapeKind, Stroke,
    TextAlign,
};
use juliepdf_lib::pdf::reader::read_annotations;
use juliepdf_lib::pdf::writer::{write_incremental, write_incremental_ordered};
use lopdf::{Document, Object, ObjectId};

fn ink(id: &str, page: u32, color: [f64; 3]) -> AnnotationDto {
    AnnotationDto::Ink {
        common: Common {
            id: id.into(),
            page,
            source_ref: None,
            modified_at: "2026-11-18T10:00:00Z".into(),
            author: "Jülie".into(),
            flattened: false,
        },
        strokes: vec![
            vec![[100.5, 200.25], [150.0, 250.0], [200.0, 210.0]],
            vec![[300.0, 300.0]],
        ],
        color,
        width: 2.5,
        opacity: 0.5,
        blend: Blend::Multiply,
        role: InkRole::Marker,
    }
}

fn highlight(id: &str, page: u32) -> AnnotationDto {
    AnnotationDto::Highlight {
        common: common(&ink(id, page, [0.0; 3])).clone(),
        quads: vec![
            [72.0, 790.0, 200.5, 790.0, 72.0, 766.0, 200.5, 766.0],
            [72.0, 760.0, 150.0, 760.0, 72.0, 740.25, 150.0, 740.25],
        ],
        color: [1.0, 0.922, 0.231],
        opacity: 0.4,
    }
}

fn freetext(id: &str, page: u32, text: &str, background: Option<Background>) -> AnnotationDto {
    AnnotationDto::Freetext {
        common: common(&ink(id, page, [0.0; 3])).clone(),
        rect: [72.0, 700.5, 272.0, 740.0],
        text: text.into(),
        lines: Vec::new(),
        font_size: 14.0,
        text_color: [0.1, 0.2, 0.7],
        background,
        align: TextAlign::Left,
    }
}

fn shape(id: &str, page: u32, kind: ShapeKind, border: Option<Stroke>, fill: Option<Fill>) -> AnnotationDto {
    AnnotationDto::Shape {
        common: common(&ink(id, page, [0.0; 3])).clone(),
        shape: kind,
        rect: [100.5, 200.0, 250.0, 300.25],
        border,
        fill,
    }
}

fn line(id: &str, page: u32, points: Vec<[f64; 2]>, arrow: bool) -> AnnotationDto {
    AnnotationDto::Line {
        common: common(&ink(id, page, [0.0; 3])).clone(),
        points,
        arrow,
        border: red_border().unwrap(),
    }
}

fn red_border() -> Option<Stroke> {
    Some(Stroke { color: [0.898, 0.224, 0.208], width: 2.5, opacity: 0.75 })
}

fn yellow_fill() -> Option<Fill> {
    Some(Fill { color: [1.0, 0.922, 0.231], opacity: 0.35 })
}

fn annot_dict<'a>(doc: &'a Document, r: &str) -> &'a lopdf::Dictionary {
    doc.get_dictionary(lopdf_id(r)).unwrap()
}

fn ap_stream<'a>(doc: &'a Document, annot: &lopdf::Dictionary) -> &'a lopdf::Stream {
    let ap = annot.get(b"AP").unwrap().as_dict().unwrap().get(b"N").unwrap().as_reference().unwrap();
    doc.get_object(ap).unwrap().as_stream().unwrap()
}

fn common(a: &AnnotationDto) -> &Common {
    match a {
        AnnotationDto::Ink { common, .. }
        | AnnotationDto::Highlight { common, .. }
        | AnnotationDto::Underline { common, .. }
        | AnnotationDto::Strikeout { common, .. }
        | AnnotationDto::Freetext { common, .. }
        | AnnotationDto::Shape { common, .. }
        | AnnotationDto::Line { common, .. }
        | AnnotationDto::Image { common, .. } => common,
    }
}

fn with_ref(mut a: AnnotationDto, r: &str) -> AnnotationDto {
    match &mut a {
        AnnotationDto::Ink { common, .. }
        | AnnotationDto::Highlight { common, .. }
        | AnnotationDto::Underline { common, .. }
        | AnnotationDto::Strikeout { common, .. }
        | AnnotationDto::Freetext { common, .. }
        | AnnotationDto::Shape { common, .. }
        | AnnotationDto::Line { common, .. }
        | AnnotationDto::Image { common, .. } => common.source_ref = Some(r.into()),
    }
    a
}

fn write(
    original: &[u8],
    upserts: &[AnnotationDto],
    deletes: &[(&str, &str)],
) -> (Vec<u8>, std::collections::HashMap<String, String>) {
    let deletes: Vec<DeleteRef> = deletes
        .iter()
        .map(|(id, r)| DeleteRef { id: id.to_string(), source_ref: r.to_string() })
        .collect();
    write_incremental(original, upserts, &deletes).unwrap()
}

/// Object numbers defined (`N G obj`) in `bytes`.
fn defined_objects(bytes: &[u8]) -> HashSet<u32> {
    let text = String::from_utf8_lossy(bytes);
    let mut out = HashSet::new();
    for (pos, _) in text.match_indices(" obj") {
        let head = &text[..pos];
        let mut parts = head.rsplit(|c: char| c.is_whitespace());
        let generation = parts.next().unwrap_or("");
        let num = parts.next().unwrap_or("");
        if !generation.is_empty()
            && generation.bytes().all(|b| b.is_ascii_digit())
            && let Ok(n) = num.parse()
        {
            out.insert(n);
        }
    }
    out
}

fn page_annots(doc: &Document, page: usize) -> Vec<Object> {
    let page_id = doc.page_iter().nth(page).unwrap();
    let dict = doc.get_dictionary(page_id).unwrap();
    match dict.get_deref(b"Annots", doc) {
        Ok(Object::Array(a)) => a.clone(),
        _ => vec![],
    }
}

fn refs_of(objs: &[Object]) -> Vec<ObjectId> {
    objs.iter().filter_map(|o| o.as_reference().ok()).collect()
}

fn is_source_ref(s: &str) -> bool {
    let Some((num, generation)) = s.split_once('R') else {
        return false;
    };
    !num.is_empty()
        && num.bytes().all(|b| b.is_ascii_digit())
        && generation.bytes().all(|b| b.is_ascii_digit())
}

#[test]
fn original_bytes_are_prefix() {
    let orig = fixtures::simple_pdf(2);
    let (out, _) = write(&orig, &[ink("a", 1, [1.0, 0.0, 0.0])], &[]);
    assert!(out.len() > orig.len());
    assert_eq!(&out[..orig.len()], &orig[..]);
}

#[test]
fn xref_table_original_gets_xref_table_section() {
    let orig = fixtures::simple_pdf(1);
    let (out, _) = write(&orig, &[ink("a", 0, [0.0; 3])], &[]);
    let tail = String::from_utf8_lossy(&out[orig.len()..]).into_owned();
    assert!(tail.contains("\nxref\n") && tail.contains("trailer"), "{tail}");
    assert!(!tail.contains("/XRef"), "{tail}");
    assert!(tail.contains("/Prev "), "{tail}");
}

#[test]
fn ink_roundtrip() {
    let orig = fixtures::simple_pdf(2);
    let a = ink("a", 1, [1.0, 0.0, 0.0]);
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    let got = read_annotations(&out).unwrap();
    assert_eq!(got, vec![with_ref(a, &refs["a"])]);
}

#[test]
fn highlight_roundtrip() {
    let orig = fixtures::simple_pdf(2);
    let a = highlight("h", 1);
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(&out[..orig.len()], &orig[..]);
    let got = read_annotations(&out).unwrap();
    assert_eq!(got, vec![with_ref(a, &refs["h"])]);

    let doc = Document::load_mem(&out).unwrap();
    let annot = doc.get_dictionary(lopdf_id(&refs["h"])).unwrap();
    assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), b"Highlight");
    assert_eq!(annot.get(b"QuadPoints").unwrap().as_array().unwrap().len(), 16);
    let rect: Vec<f32> = annot
        .get(b"Rect")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o.as_float().unwrap())
        .collect();
    assert_eq!(rect, [72.0, 740.25, 200.5, 790.0], "rect = union of the quads");
    let private = annot.get(b"JuliePDF").unwrap().as_dict().unwrap();
    assert_eq!(private.get(b"v").unwrap().as_i64().unwrap(), 1);
    let ap = annot.get(b"AP").unwrap().as_dict().unwrap().get(b"N").unwrap().as_reference().unwrap();
    let stream = doc.get_object(ap).unwrap().as_stream().unwrap();
    // Opacity is applied once, to an opaque knockout group: overlapping quads
    // are not darkened twice.
    let outer = String::from_utf8(stream.decompressed_content().unwrap()).unwrap();
    assert_eq!(outer, "q\n/GS0 gs\n/Fm0 Do\nQ\n");
    let group = knockout_group(&doc, stream);
    let content = String::from_utf8(group.decompressed_content().unwrap()).unwrap();
    assert!(
        content.contains("72 790 m\n200.5 790 l\n200.5 766 l\n72 766 l\nh\nf\n"),
        "{content}"
    );
    assert!(!content.contains(" gs"), "{content}");
    let gs = stream
        .dict
        .get(b"Resources")
        .unwrap()
        .as_dict()
        .unwrap()
        .get(b"ExtGState")
        .unwrap()
        .as_dict()
        .unwrap()
        .get(b"GS0")
        .unwrap()
        .as_dict()
        .unwrap();
    assert_eq!(gs.get(b"BM").unwrap().as_name().unwrap(), b"Multiply");
    assert_eq!(gs.get(b"ca").unwrap().as_float().unwrap(), 0.4);
    assert_eq!(gs.get(b"CA").unwrap().as_float().unwrap(), 0.4);
}

#[test]
fn underline_and_strikeout_roundtrip() {
    let orig = fixtures::simple_pdf(1);
    let quads = vec![[72.0, 790.0, 200.5, 790.0, 72.0, 776.0, 200.5, 776.0]];
    let base = common(&ink("x", 0, [0.0; 3])).clone();
    let u = AnnotationDto::Underline {
        common: Common { id: "u".into(), ..base.clone() },
        quads: quads.clone(),
        color: [0.118, 0.533, 0.898],
    };
    let s = AnnotationDto::Strikeout { common: Common { id: "s".into(), ..base }, quads, color: [1.0, 0.0, 0.0] };
    let (out, refs) = write(&orig, &[u.clone(), s.clone()], &[]);
    let got = read_annotations(&out).unwrap();
    assert_eq!(got, vec![with_ref(u, &refs["u"]), with_ref(s, &refs["s"])]);

    let doc = Document::load_mem(&out).unwrap();
    // 14pt quad from y=776: 1pt line centred 0.12 (underline) or 0.42 (strike-out) up.
    let bands = [
        ("u", "Underline", "72 778.18 m\n200.5 778.18 l\n200.5 777.18 l\n72 777.18 l\n"),
        ("s", "StrikeOut", "72 782.38 m\n200.5 782.38 l\n200.5 781.38 l\n72 781.38 l\n"),
    ];
    for (id, subtype, band) in bands {
        let annot = annot_dict(&doc, &refs[id]);
        assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), subtype.as_bytes());
        assert_eq!(annot.get(b"QuadPoints").unwrap().as_array().unwrap().len(), 8);
        let stream = ap_stream(&doc, annot);
        let content = String::from_utf8(stream.decompressed_content().unwrap()).unwrap();
        assert!(content.contains(band), "{subtype}: {content}");
        assert!(content.ends_with("h\nf\nQ\n"), "{content}");
    }
}

/// The `/Fm0` form an ink or highlight appearance paints: an isolated
/// knockout transparency group with the same box.
fn knockout_group<'a>(doc: &'a Document, outer: &lopdf::Stream) -> &'a lopdf::Stream {
    let res = outer.dict.get(b"Resources").unwrap().as_dict().unwrap();
    let id = res.get(b"XObject").unwrap().as_dict().unwrap().get(b"Fm0").unwrap().as_reference().unwrap();
    let inner = doc.get_object(id).unwrap().as_stream().unwrap();
    assert_eq!(inner.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Form");
    let g = inner.dict.get(b"Group").unwrap().as_dict().unwrap();
    assert_eq!(g.get(b"S").unwrap().as_name().unwrap(), b"Transparency");
    assert!(g.get(b"I").unwrap().as_bool().unwrap(), "isolated");
    assert!(g.get(b"K").unwrap().as_bool().unwrap(), "knockout");
    assert_eq!(floats(inner.dict.get(b"BBox").unwrap()), floats(outer.dict.get(b"BBox").unwrap()));
    inner
}

#[test]
fn highlight_edit_after_save_keeps_object() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(&orig, &[highlight("h", 0)], &[]);
    let mut edited = with_ref(highlight("h", 0), &refs1["h"]);
    if let AnnotationDto::Highlight { color, .. } = &mut edited {
        *color = [0.094, 1.0, 1.0];
    }
    let (out2, refs2) = write(&out1, std::slice::from_ref(&edited), &[]);
    assert_eq!(refs2["h"], refs1["h"]);
    assert_eq!(read_annotations(&out2).unwrap(), vec![edited]);
}

#[test]
fn update_keeps_foreign_keys_and_overwrites_owned_ones() {
    let orig = fixtures::pdf_with_foreign_annots();
    let AnnotationDto::Ink { common: c, .. } = read_annotations(&orig).unwrap().remove(0) else {
        panic!("expected the foreign ink")
    };
    let mut edited = ink("foreign-ink", 0, [0.0, 1.0, 0.0]);
    if let AnnotationDto::Ink { common, .. } = &mut edited {
        common.source_ref = c.source_ref.clone();
    }
    let (out, refs) = write(&orig, &[edited], &[]);
    assert_eq!(Some(&refs["foreign-ink"]), c.source_ref.as_ref());
    let doc = Document::load_mem(&out).unwrap();
    let d = doc.get_dictionary(lopdf_id(&refs["foreign-ink"])).unwrap();
    let text = |k: &[u8]| lopdf::decode_text_string(d.get(k).unwrap()).unwrap();
    assert_eq!(text(b"Contents"), "a reviewer note");
    assert_eq!(text(b"CreationDate"), "D:20260101000000Z");
    assert_eq!(text(b"RC"), "<body><p>a reviewer note</p></body>");
    assert_eq!(d.get(b"StructParent").unwrap().as_i64().unwrap(), 7);
    assert_eq!(text(b"T"), "Jülie", "owned keys are overwritten");
    assert!(d.get(b"AP").is_ok() && d.get(b"JuliePDF").is_ok());
    let c: Vec<f32> = d.get(b"C").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect();
    assert_eq!(c, [0.0, 1.0, 0.0]);
}

#[test]
fn empty_author_is_written_as_juliepdf() {
    let orig = fixtures::simple_pdf(1);
    let mut a = ink("a", 0, [0.0; 3]);
    if let AnnotationDto::Ink { common, .. } = &mut a {
        common.author = String::new();
    }
    let (out, refs) = write(&orig, &[a], &[]);
    let doc = Document::load_mem(&out).unwrap();
    let d = doc.get_dictionary(lopdf_id(&refs["a"])).unwrap();
    assert_eq!(lopdf::decode_text_string(d.get(b"T").unwrap()).unwrap(), "JuliePDF");
}

#[test]
fn returns_source_refs_for_new_annotations() {
    let (_, refs) = write(&fixtures::simple_pdf(1), &[ink("a", 0, [0.0; 3])], &[]);
    assert_eq!(refs.len(), 1);
    assert!(is_source_ref(&refs["a"]), "{}", refs["a"]);
}

#[test]
fn edit_after_save_replaces_not_duplicates() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(&orig, &[ink("a", 0, [1.0, 0.0, 0.0])], &[]);
    let edited = with_ref(ink("a", 0, [0.0, 0.0, 1.0]), &refs1["a"]);
    let (out2, refs2) = write(&out1, &[edited], &[]);
    assert_eq!(&out2[..out1.len()], &out1[..]);
    assert_eq!(refs2["a"], refs1["a"], "an update keeps its object number");
    let got = read_annotations(&out2).unwrap();
    assert_eq!(got.len(), 1);
    assert!(matches!(&got[0], AnnotationDto::Ink { color, .. } if *color == [0.0, 0.0, 1.0]));
    assert_eq!(page_annots(&Document::load_mem(&out2).unwrap(), 0).len(), 1);
}

#[test]
fn update_with_vanished_ref_is_written_as_new() {
    let orig = fixtures::simple_pdf(1);
    let a = with_ref(ink("a", 0, [1.0, 0.0, 0.0]), "999R");
    let (out, refs) = write(&orig, &[a], &[]);
    assert_ne!(refs["a"], "999R");
    assert_eq!(read_annotations(&out).unwrap().len(), 1);
}

#[test]
fn update_with_ref_to_non_annotation_is_written_as_new() {
    let orig = fixtures::simple_pdf(1);
    let doc = Document::load_mem(&orig).unwrap();
    let page_id = doc.page_iter().next().unwrap();
    let a = with_ref(ink("a", 0, [1.0, 0.0, 0.0]), &juliepdf_ref(page_id));
    let (out, refs) = write(&orig, &[a], &[]);
    assert_ne!(refs["a"], juliepdf_ref(page_id));
    let after = Document::load_mem(&out).unwrap();
    assert_eq!(after.page_iter().count(), 1);
    assert_eq!(read_annotations(&out).unwrap().len(), 1);
}

#[test]
fn delete_removes_from_annots() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs) = write(&orig, &[ink("a", 0, [1.0, 0.0, 0.0])], &[]);
    let (out2, _) = write(&out1, &[], &[("a", &refs["a"]), ("x", "garbage"), ("y", "999R")]);
    assert!(read_annotations(&out2).unwrap().is_empty());
    assert!(page_annots(&Document::load_mem(&out2).unwrap(), 0).is_empty());
}

#[test]
fn foreign_annotations_loaded_and_link_preserved() {
    let orig = fixtures::pdf_with_foreign_annots();
    let got = read_annotations(&orig).unwrap();
    assert_eq!(got.len(), 1, "the link is not editable");
    let AnnotationDto::Ink {
        common,
        strokes,
        color,
        width,
        opacity,
        blend,
        role,
    } = &got[0]
    else {
        panic!("expected ink: {got:?}")
    };
    assert_eq!(common.id, "foreign-ink");
    assert_eq!(common.author, "Drawboard");
    assert_eq!(common.page, 0);
    assert_eq!(common.modified_at, "2026-01-02T02:04:05Z");
    assert!(common.source_ref.is_some());
    assert_eq!(
        strokes,
        &vec![vec![[100.0, 100.0], [150.0, 150.0], [200.0, 100.0]]]
    );
    assert_eq!(
        (*color, *width, *opacity, *blend, *role),
        ([0.0, 0.0, 1.0], 1.0, 1.0, Blend::Normal, InkRole::Pen)
    );

    let doc = Document::load_mem(&orig).unwrap();
    let link_id = refs_of(&page_annots(&doc, 0))
        .into_iter()
        .find(|&id| {
            doc.get_dictionary(id)
                .unwrap()
                .get(b"Subtype")
                .unwrap()
                .as_name()
                .unwrap()
                == b"Link"
        })
        .unwrap();
    let link_before = doc.get_object(link_id).unwrap().clone();

    let (out, _) = write(&orig, &[ink("new", 0, [1.0, 0.0, 0.0])], &[]);
    assert!(
        !defined_objects(&out[orig.len()..]).contains(&link_id.0),
        "link object must not be rewritten"
    );
    let after = Document::load_mem(&out).unwrap();
    let annots = refs_of(&page_annots(&after, 0));
    assert_eq!(annots.len(), 3);
    assert!(annots.contains(&link_id));
    assert_eq!(after.get_object(link_id).unwrap(), &link_before);
    assert_eq!(read_annotations(&out).unwrap().len(), 2);
}

#[test]
fn page_without_annots_array_gets_one() {
    let orig = fixtures::simple_pdf(2);
    assert!(page_annots(&Document::load_mem(&orig).unwrap(), 1).is_empty());
    let (out, refs) = write(&orig, &[ink("a", 1, [0.0; 3])], &[]);
    let doc = Document::load_mem(&out).unwrap();
    let annots = refs_of(&page_annots(&doc, 1));
    assert_eq!(annots.len(), 1);
    assert_eq!(juliepdf_ref(annots[0]), refs["a"]);
    assert!(page_annots(&doc, 0).is_empty());
}

fn juliepdf_ref((num, generation): ObjectId) -> String {
    if generation == 0 {
        format!("{num}R")
    } else {
        format!("{num}R{generation}")
    }
}

#[test]
fn page_with_indirect_annots_array_is_updated() {
    let orig = fixtures::pdf_with_indirect_annots();
    let doc = Document::load_mem(&orig).unwrap();
    let page_id = doc.page_iter().next().unwrap();
    let arr_id = doc
        .get_dictionary(page_id)
        .unwrap()
        .get(b"Annots")
        .unwrap()
        .as_reference()
        .unwrap();

    let (out, _) = write(&orig, &[ink("a", 0, [0.0; 3])], &[]);
    let appended = defined_objects(&out[orig.len()..]);
    assert!(
        appended.contains(&arr_id.0),
        "the annots array object is revised"
    );
    assert!(
        !appended.contains(&page_id.0),
        "the page itself is untouched"
    );
    let after = Document::load_mem(&out).unwrap();
    assert_eq!(page_annots(&after, 0).len(), 2);
    assert_eq!(read_annotations(&out).unwrap().len(), 1);
}

#[test]
fn two_annotations_on_one_page() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(
        &orig,
        &[ink("a", 0, [1.0, 0.0, 0.0]), ink("b", 0, [0.0, 1.0, 0.0])],
        &[],
    );
    assert_ne!(refs1["a"], refs1["b"]);
    let got = read_annotations(&out1).unwrap();
    let ids: Vec<&str> = got.iter().map(|a| common(a).id.as_str()).collect();
    assert_eq!(ids, ["a", "b"]);

    let (out2, _) = write(&out1, &[ink("c", 0, [0.0, 0.0, 1.0])], &[]);
    let ids: Vec<String> = read_annotations(&out2)
        .unwrap()
        .iter()
        .map(|a| common(a).id.clone())
        .collect();
    assert_eq!(ids, ["a", "b", "c"]);
}

#[test]
fn xref_stream_original_roundtrip() {
    let orig = fixtures::xref_stream_pdf();
    let a = ink("a", 1, [1.0, 0.0, 0.0]);
    let (out1, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(&out1[..orig.len()], &orig[..]);
    let tail = String::from_utf8_lossy(&out1[orig.len()..]).into_owned();
    assert!(
        tail.contains("/XRef"),
        "appended section must be an xref stream: {tail}"
    );
    assert!(
        !tail.contains("\nxref\n") && !tail.contains("trailer"),
        "no classic table: {tail}"
    );

    let doc = Document::load_mem(&out1).unwrap();
    assert_eq!(doc.page_iter().count(), 2);
    assert_eq!(
        read_annotations(&out1).unwrap(),
        vec![with_ref(a, &refs["a"])]
    );

    let edited = with_ref(ink("a", 1, [0.0, 1.0, 0.0]), &refs["a"]);
    let (out2, _) = write(&out1, &[edited, ink("b", 0, [0.0; 3])], &[]);
    let got = read_annotations(&out2).unwrap();
    assert_eq!(got.len(), 2);
    assert!(got.iter().any(|a| matches!(a, AnnotationDto::Ink { common, color, .. } if common.id == "a" && *color == [0.0, 1.0, 0.0])));
    let (out3, _) = write(&out2, &[], &[("a", &refs["a"])]);
    assert_eq!(read_annotations(&out3).unwrap().len(), 1);
}

#[test]
fn rotated_page_roundtrip() {
    let orig = fixtures::rotated_pdf();
    let a = ink("a", 0, [0.0; 3]);
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(
        read_annotations(&out).unwrap(),
        vec![with_ref(a, &refs["a"])]
    );
}

#[test]
fn output_reloads_with_lopdf() {
    let orig = fixtures::simple_pdf(3);
    let (out, refs) = write(&orig, &[ink("a", 2, [0.0; 3])], &[]);
    let doc = Document::load_mem(&out).unwrap();
    assert_eq!(doc.page_iter().count(), 3);
    let annot = doc.get_dictionary(lopdf_id(&refs["a"])).unwrap();
    assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), b"Ink");
    assert_eq!(annot.get(b"F").unwrap().as_i64().unwrap(), 4);
    let ap = annot
        .get(b"AP")
        .unwrap()
        .as_dict()
        .unwrap()
        .get(b"N")
        .unwrap()
        .as_reference()
        .unwrap();
    let stream = doc.get_object(ap).unwrap().as_stream().unwrap();
    assert_eq!(
        stream.dict.get(b"Subtype").unwrap().as_name().unwrap(),
        b"Form"
    );
    let content = knockout_group(&doc, stream).decompressed_content().unwrap();
    assert!(
        content.starts_with(b"q\n2.5 w\n"),
        "{}",
        String::from_utf8_lossy(&content)
    );
}

fn lopdf_id(r: &str) -> ObjectId {
    let (num, generation) = r.split_once('R').unwrap();
    (
        num.parse().unwrap(),
        if generation.is_empty() {
            0
        } else {
            generation.parse().unwrap()
        },
    )
}

#[test]
fn bad_page_is_invalid() {
    let orig = fixtures::simple_pdf(1);
    let err = write_incremental(&orig, &[ink("a", 5, [0.0; 3])], &[]).unwrap_err();
    assert!(matches!(err, AppError::InvalidPdf(_)));
}

#[test]
fn freetext_roundtrip() {
    let orig = fixtures::simple_pdf(1);
    let with_bg = freetext(
        "f",
        0,
        "Hello (world)\\ \nsecond line",
        Some(Background { color: [1.0, 0.922, 0.231], opacity: 0.35 }),
    );
    let without_bg = freetext("g", 0, "plain", None);
    let (out, refs) = write(&orig, &[with_bg.clone(), without_bg.clone()], &[]);
    assert_eq!(&out[..orig.len()], &orig[..]);
    assert_eq!(
        read_annotations(&out).unwrap(),
        vec![with_ref(with_bg, &refs["f"]), with_ref(without_bg, &refs["g"])]
    );

    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["f"]);
    assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), b"FreeText");
    assert_eq!(annot.get(b"DA").unwrap().as_str().unwrap(), b"/Helv 14 Tf 0.1 0.2 0.7 rg");
    assert_eq!(annot.get(b"CA").unwrap().as_i64().unwrap(), 1, "text stays opaque");
    assert_eq!(annot.get(b"C").unwrap().as_array().unwrap().len(), 3);
    let bs = annot.get(b"BS").unwrap().as_dict().unwrap();
    assert_eq!(bs.get(b"W").unwrap().as_i64().unwrap(), 0);
    let private = annot.get(b"JuliePDF").unwrap().as_dict().unwrap();
    assert!(private.get(b"hasBg").unwrap().as_bool().unwrap());
    let stream = ap_stream(&doc, annot);
    let content = String::from_utf8(stream.decompressed_content().unwrap()).unwrap();
    assert!(content.contains("/GS0 gs\n1 0.922 0.231 rg\n72 700.5 200 39.5 re\nf\n"), "{content}");
    assert!(content.contains("/Helv 14 Tf\n"), "{content}");
    assert!(content.contains("(Hello \\(world\\)\\\\ ) Tj\n"), "{content}");
    assert!(content.contains("(second line) Tj\n"), "{content}");
    let res = stream.dict.get(b"Resources").unwrap().as_dict().unwrap();
    let helv = res.get(b"Font").unwrap().as_dict().unwrap().get(b"Helv").unwrap().as_dict().unwrap();
    assert_eq!(helv.get(b"BaseFont").unwrap().as_name().unwrap(), b"Helvetica");
    assert_eq!(helv.get(b"Encoding").unwrap().as_name().unwrap(), b"WinAnsiEncoding");
    let gs = res.get(b"ExtGState").unwrap().as_dict().unwrap().get(b"GS0").unwrap().as_dict().unwrap();
    assert_eq!(gs.get(b"ca").unwrap().as_float().unwrap(), 0.35);

    let plain = annot_dict(&doc, &refs["g"]);
    assert!(plain.get(b"C").unwrap().as_array().unwrap().is_empty(), "no background = transparent");
    let plain_content = String::from_utf8(ap_stream(&doc, plain).decompressed_content().unwrap()).unwrap();
    assert!(!plain_content.contains(" re\n"), "{plain_content}");
}

#[test]
fn freetext_edit_removes_background_and_keeps_object() {
    let orig = fixtures::simple_pdf(1);
    let a = freetext("f", 0, "x", Some(Background { color: [1.0, 0.0, 0.0], opacity: 1.0 }));
    let (out1, refs1) = write(&orig, &[a], &[]);
    let edited = with_ref(freetext("f", 0, "y", None), &refs1["f"]);
    let (out2, refs2) = write(&out1, std::slice::from_ref(&edited), &[]);
    assert_eq!(refs2["f"], refs1["f"]);
    assert_eq!(read_annotations(&out2).unwrap(), vec![edited]);
}

#[test]
fn freetext_custom_colours_and_size_survive_exactly() {
    // 32/255 has more digits than /DA (3 decimals) or a PDF real (f32) keep.
    let k = 32.0 / 255.0;
    let orig = fixtures::simple_pdf(1);
    let mut a = freetext("c", 0, "dark", Some(Background { color: [k, 1.0, 0.898], opacity: 0.35 }));
    if let AnnotationDto::Freetext { text_color, font_size, .. } = &mut a {
        *text_color = [k, 0.898, 200.0 / 255.0];
        *font_size = 13.5;
    }
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(a, &refs["c"])]);
    let doc = Document::load_mem(&out).unwrap();
    let private = annot_dict(&doc, &refs["c"]).get(b"JuliePDF").unwrap().as_dict().unwrap();
    assert_eq!(private.get(b"textColor").unwrap().as_array().unwrap().len(), 3);
    assert_eq!(private.get(b"fontSize").unwrap().as_float().unwrap(), 13.5);
}

#[test]
fn freetext_alignment_roundtrips_as_q() {
    let orig = fixtures::simple_pdf(1);
    let mut boxes = Vec::new();
    for (id, align) in [("l", TextAlign::Left), ("c", TextAlign::Center), ("r", TextAlign::Right)] {
        let mut a = freetext(id, 0, "aligned", None);
        if let AnnotationDto::Freetext { align: al, .. } = &mut a {
            *al = align;
        }
        boxes.push(a);
    }
    let (out, refs) = write(&orig, &boxes, &[]);
    let expected: Vec<_> = boxes.iter().map(|a| with_ref(a.clone(), &refs[&a_id(a)])).collect();
    assert_eq!(read_annotations(&out).unwrap(), expected);
    let doc = Document::load_mem(&out).unwrap();
    for (id, q) in [("l", 0), ("c", 1), ("r", 2)] {
        assert_eq!(annot_dict(&doc, &refs[id]).get(b"Q").unwrap().as_i64().unwrap(), q, "{id}");
    }
}

#[test]
fn freetext_unknown_q_reads_as_left_aligned() {
    let orig = fixtures::simple_pdf(1);
    let mut a = freetext("q", 0, "x", None);
    if let AnnotationDto::Freetext { align, .. } = &mut a {
        *align = TextAlign::Right;
    }
    let (out, refs) = write(&orig, &[a], &[]);
    let mut doc = Document::load_mem(&out).unwrap();
    doc.get_dictionary_mut(lopdf_id(&refs["q"])).unwrap().set("Q", 7);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    let got = read_annotations(&bytes).unwrap();
    assert!(matches!(&got[0], AnnotationDto::Freetext { align: TextAlign::Left, .. }), "{got:?}");
}

fn a_id(a: &AnnotationDto) -> String {
    common(a).id.clone()
}

#[test]
fn freetext_has_bg_without_colour_reads_as_transparent() {
    let orig = fixtures::simple_pdf(1);
    let a = freetext("b", 0, "x", Some(Background { color: [1.0, 0.0, 0.0], opacity: 0.5 }));
    let (out, refs) = write(&orig, &[a], &[]);
    let mut doc = Document::load_mem(&out).unwrap();
    doc.get_dictionary_mut(lopdf_id(&refs["b"])).unwrap().remove(b"C");
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    let got = read_annotations(&bytes).unwrap();
    assert!(matches!(&got[0], AnnotationDto::Freetext { background: None, .. }), "{got:?}");
}

#[test]
fn freetext_umlauts_survive_and_emoji_replaced() {
    let orig = fixtures::simple_pdf(1);
    let a = freetext("u", 0, "Übung 😀", None);
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(a, &refs["u"])]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["u"]);
    let contents = annot.get(b"Contents").unwrap().as_str().unwrap();
    assert!(contents.starts_with(b"\xFE\xFF"), "UTF-16BE with BOM: {contents:?}");
    let utf16: Vec<u16> = contents[2..].chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
    assert_eq!(String::from_utf16(&utf16).unwrap(), "Übung 😀");
    let content = ap_stream(&doc, annot).decompressed_content().unwrap();
    let needle = b"(\xDCbung ?) Tj";
    assert!(
        content.windows(needle.len()).any(|w| w == needle),
        "{}",
        String::from_utf8_lossy(&content)
    );
}

#[test]
fn freetext_on_rotated_page_has_counter_rotation_matrix() {
    // Rotate 90: a box 200 wide and 30 tall on screen is 30 x 200 in PDF space.
    let rect = [100.0, 500.0, 130.0, 700.0];
    let lines = vec!["upright".to_string()];
    let flat = freetext_appearance(rect, &lines, 12.0, [0.0; 3], None, TextAlign::Left, 0);
    assert!(flat.matrix.is_none());
    assert_eq!(flat.rect(), rect);

    let ap = freetext_appearance(rect, &lines, 12.0, [0.0; 3], None, TextAlign::Left, 90);
    let m = ap.matrix.expect("rotated page needs a matrix");
    assert_eq!(&m[..4], &[0.0, 1.0, -1.0, 0.0]);
    assert_ne!(m, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    // The text frame is the screen-aligned box (200 x 30) and maps exactly onto /Rect.
    assert_eq!(ap.bbox[2] - ap.bbox[0], 200.0);
    assert_eq!(ap.bbox[3] - ap.bbox[1], 30.0);
    assert_eq!(ap.rect(), rect);

    for (rot, abcd) in [(180, [-1.0, 0.0, 0.0, -1.0]), (270, [0.0, -1.0, 1.0, 0.0])] {
        let ap = freetext_appearance(rect, &lines, 12.0, [0.0; 3], None, TextAlign::Left, rot);
        assert_eq!(&ap.matrix.unwrap()[..4], &abcd, "rotation {rot}");
        assert_eq!(ap.rect(), rect, "rotation {rot}");
    }

    // The writer applies the page rotation and keeps /Rect on the box.
    let orig = fixtures::rotated_pdf();
    let mut a = freetext("r", 0, "upright", None);
    if let AnnotationDto::Freetext { rect: r, .. } = &mut a {
        *r = rect;
    }
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(a, &refs["r"])]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["r"]);
    let matrix: Vec<f32> = ap_stream(&doc, annot)
        .dict
        .get(b"Matrix")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o.as_float().unwrap())
        .collect();
    assert_eq!(&matrix[..4], &[0.0, 1.0, -1.0, 0.0]);
    let r: Vec<f32> = annot.get(b"Rect").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect();
    assert_eq!(r, [100.0, 500.0, 130.0, 700.0]);
}

#[test]
fn empty_ink_is_skipped() {
    let orig = fixtures::simple_pdf(1);
    let mut a = ink("a", 0, [0.0; 3]);
    if let AnnotationDto::Ink { strokes, .. } = &mut a {
        *strokes = vec![vec![]];
    }
    let (out, refs) = write(&orig, &[a], &[]);
    assert!(refs.is_empty());
    assert!(read_annotations(&out).unwrap().is_empty());
}

#[test]
fn encrypted_and_garbage_inputs() {
    let enc = fixtures::encrypted_pdf();
    assert!(matches!(
        read_annotations(&enc),
        Err(AppError::Encrypted(_))
    ));
    assert!(matches!(
        write_incremental(&enc, &[ink("a", 0, [0.0; 3])], &[]),
        Err(AppError::Encrypted(_))
    ));
    assert!(matches!(
        read_annotations(b"hello"),
        Err(AppError::InvalidPdf(_))
    ));
    assert!(matches!(
        write_incremental(b"hello", &[], &[]),
        Err(AppError::InvalidPdf(_))
    ));
}

fn temp_pdf(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    std::fs::write(&path, bytes).unwrap();
    (dir, path)
}

#[test]
fn save_to_path_writes_and_reloads() {
    let orig = fixtures::simple_pdf(1);
    let (dir, path) = temp_pdf("lecture.pdf", &orig);
    let res = save_to_path(&path, &path, &[ink("a", 0, [0.0; 3])], &[]).unwrap();
    let saved = std::fs::read(&path).unwrap();
    assert_eq!(&saved[..orig.len()], &orig[..]);
    let got = read_annotations(&saved).unwrap();
    assert_eq!(
        common(&got[0]).source_ref.as_deref(),
        Some(res.refs["a"].as_str())
    );
    let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
    assert_eq!(leftovers.len(), 1, "no temp file left behind");
}

#[cfg(windows)]
#[test]
fn save_to_locked_file_returns_locked_and_keeps_original() {
    use std::os::windows::fs::OpenOptionsExt;
    let orig = fixtures::simple_pdf(1);
    let (dir, path) = temp_pdf("locked.pdf", &orig);
    let src = dir.path().join("source.pdf");
    std::fs::write(&src, &orig).unwrap();
    {
        let _lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let err = save_to_path(&src, &path, &[ink("a", 0, [0.0; 3])], &[]).unwrap_err();
        assert!(matches!(err, AppError::Locked(_)), "{err:?}");
        let err = save_to_path(&path, &path, &[ink("a", 0, [0.0; 3])], &[]).unwrap_err();
        assert!(matches!(err, AppError::Locked(_)), "{err:?}");
    }
    assert_eq!(std::fs::read(&path).unwrap(), orig);
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        2,
        "no temp file left behind"
    );
}

#[test]
fn save_to_read_only_file_returns_read_only_and_keeps_original() {
    let orig = fixtures::simple_pdf(1);
    let (_dir, path) = temp_pdf("ro.pdf", &orig);
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms.clone()).unwrap();
    let err = save_to_path(&path, &path, &[ink("a", 0, [0.0; 3])], &[]).unwrap_err();
    let after = std::fs::read(&path).unwrap();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(&path, perms).unwrap();
    assert!(matches!(err, AppError::ReadOnly(_)), "{err:?}");
    assert_eq!(after, orig);
}

#[test]
fn save_with_invalid_input_keeps_original() {
    let (_dir, path) = temp_pdf("bad.pdf", b"not a pdf");
    let err = save_to_path(&path, &path, &[ink("a", 0, [0.0; 3])], &[]).unwrap_err();
    assert!(matches!(err, AppError::InvalidPdf(_)));
    assert_eq!(std::fs::read(&path).unwrap(), b"not a pdf");
}

/// Writes `target/sample-annotated.pdf` (a foreign `/Ink` and `/Link` plus two
/// JuliePDF inks on page 1) for manual viewer checks and the pdf.js suppression
/// fixture in `tests/fixtures/`. Run: `cargo test -- --ignored write_sample`.
#[test]
#[ignore]
fn write_sample() {
    let (bytes, _) = write(
        &fixtures::pdf_with_foreign_annots(),
        &[ink("sample-a", 0, [0.9, 0.2, 0.2]), ink("sample-b", 0, [0.1, 0.4, 0.9])],
        &[],
    );
    let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/sample-annotated.pdf");
    std::fs::write(&out, bytes).unwrap();
    println!("wrote {}", out.display());
}

fn floats(o: &Object) -> Vec<f64> {
    o.as_array().unwrap().iter().map(|v| v.as_float().unwrap() as f64).collect()
}

fn transform_bounds(b: &[f64], m: &[f64]) -> [f64; 4] {
    let pts = [(b[0], b[1]), (b[2], b[1]), (b[0], b[3]), (b[2], b[3])];
    let xs = pts.map(|(x, y)| m[0] * x + m[2] * y + m[4]);
    let ys = pts.map(|(x, y)| m[1] * x + m[3] * y + m[5]);
    let min = |v: [f64; 4]| v.into_iter().fold(f64::MAX, f64::min);
    let max = |v: [f64; 4]| v.into_iter().fold(f64::MIN, f64::max);
    [min(xs), min(ys), max(xs), max(ys)]
}

#[test]
fn offset_media_box_roundtrip_keeps_rects_inside_the_box() {
    let media = [50.0, 100.0, 645.0, 942.0];
    let inside = |r: &[f64], what: &str| {
        assert!(
            r[0] >= media[0] - 1e-3 && r[1] >= media[1] - 1e-3 && r[2] <= media[2] + 1e-3 && r[3] <= media[3] + 1e-3,
            "{what} {r:?} outside {media:?}"
        );
    };
    for rotate in [false, true] {
        let orig = fixtures::offset_box_pdf(rotate);
        let mut a = ink("i", 0, [1.0, 0.0, 0.0]);
        if let AnnotationDto::Ink { strokes, .. } = &mut a {
            *strokes = vec![vec![[60.0, 110.0], [300.0, 500.0], [635.0, 932.0]]];
        }
        let mut h = highlight("h", 0);
        if let AnnotationDto::Highlight { quads, .. } = &mut h {
            *quads = vec![[60.0, 930.0, 400.0, 930.0, 60.0, 910.0, 400.0, 910.0]];
        }
        let mut f = freetext("f", 0, "hello", None);
        if let AnnotationDto::Freetext { rect, .. } = &mut f {
            // Rotate 90: 200 wide x 30 tall on screen is 30 x 200 in PDF space.
            *rect = if rotate { [600.0, 120.0, 630.0, 320.0] } else { [60.0, 880.0, 260.0, 920.0] };
        }
        let upserts = [a, h, f];
        let (out, refs) = write(&orig, &upserts, &[]);
        let mut got = read_annotations(&out).unwrap();
        got.sort_by(|x, y| common(x).id.cmp(&common(y).id));
        let mut want: Vec<_> = upserts.iter().map(|u| with_ref(u.clone(), &refs[&common(u).id])).collect();
        want.sort_by(|x, y| common(x).id.cmp(&common(y).id));
        assert_eq!(got, want, "rotate {rotate}");
        let doc = Document::load_mem(&out).unwrap();
        for id in ["i", "h", "f"] {
            let annot = annot_dict(&doc, &refs[id]);
            let rect = floats(annot.get(b"Rect").unwrap());
            inside(&rect, &format!("{id} /Rect (rotate {rotate})"));
            let ap = ap_stream(&doc, annot);
            let bbox = floats(ap.dict.get(b"BBox").unwrap());
            let matrix = ap.dict.get(b"Matrix").map(floats).unwrap_or(vec![1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
            let placed = transform_bounds(&bbox, &matrix);
            inside(&placed, &format!("{id} /BBox x /Matrix (rotate {rotate})"));
            for k in 0..4 {
                assert!((placed[k] - rect[k]).abs() < 1e-3, "{id}: AP {placed:?} maps onto /Rect {rect:?}");
            }
        }
    }
}

#[test]
fn update_of_object_with_other_nm_is_written_as_new() {
    // The file on disk changed since loading: the ref now names another annotation.
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(&orig, &[ink("theirs", 0, [1.0, 0.0, 0.0])], &[]);
    let mine = with_ref(ink("mine", 0, [0.0, 0.0, 1.0]), &refs1["theirs"]);
    let (out2, refs2) = write(&out1, &[mine], &[]);
    assert_ne!(refs2["mine"], refs1["theirs"]);
    let doc = Document::load_mem(&out2).unwrap();
    assert!(
        !defined_objects(&out2[out1.len()..]).contains(&lopdf_id(&refs1["theirs"]).0),
        "the other annotation must not be rewritten"
    );
    let theirs = annot_dict(&doc, &refs1["theirs"]);
    assert_eq!(lopdf::decode_text_string(theirs.get(b"NM").unwrap()).unwrap(), "theirs");
    let mut ids: Vec<_> = read_annotations(&out2).unwrap().iter().map(|a| common(a).id.clone()).collect();
    ids.sort();
    assert_eq!(ids, ["mine", "theirs"]);
}

#[test]
fn delete_of_object_with_other_nm_keeps_it() {
    // The file on disk changed since loading: the deleted ref now names another annotation.
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(&orig, &[ink("theirs", 0, [1.0, 0.0, 0.0])], &[]);
    let (out2, _) = write(&out1, &[], &[("mine", &refs1["theirs"])]);
    let ids: Vec<_> = read_annotations(&out2).unwrap().iter().map(|a| common(a).id.clone()).collect();
    assert_eq!(ids, ["theirs"], "another annotation must not be detached");
}

#[test]
fn delete_of_foreign_annotation_detaches_only_it() {
    let orig = fixtures::pdf_with_foreign_annots();
    let before = read_annotations(&orig).unwrap();
    let target = common(&before[0]).clone();
    let (out, _) = write(&orig, &[], &[(&target.id, target.source_ref.as_deref().unwrap())]);
    let after: Vec<_> = read_annotations(&out).unwrap().iter().map(|a| common(a).id.clone()).collect();
    assert_eq!(after.len(), before.len() - 1);
    assert!(!after.contains(&target.id));
}

#[test]
fn update_of_foreign_annotation_without_nm_overwrites_it() {
    // Ink A loses its /NM: the reader gives it a fresh id, which the writer
    // cannot check against the object, so the update goes in place.
    let orig = {
        let mut doc = Document::load_mem(&fixtures::pdf_with_duplicate_annots()).unwrap();
        let a = refs_of(&page_annots(&doc, 0))[0];
        doc.get_dictionary_mut(a).unwrap().remove(b"NM");
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    };
    let got = read_annotations(&orig).unwrap();
    let a = got.iter().find(|a| common(a).id != "dup").unwrap();
    let r = common(a).source_ref.clone().unwrap();
    let edited = with_ref(ink(&common(a).id, 0, [0.0, 1.0, 0.0]), &r);
    let (_, refs) = write(&orig, &[edited], &[]);
    assert_eq!(refs[&common(a).id], r);
}

#[test]
fn duplicate_annotations_read_once_with_unique_ids() {
    let orig = fixtures::pdf_with_duplicate_annots();
    let got = read_annotations(&orig).unwrap();
    assert_eq!(got.len(), 2, "object A is listed three times but read once: {got:?}");
    let ids: HashSet<_> = got.iter().map(|a| common(a).id.clone()).collect();
    assert_eq!(ids.len(), 2, "ids are unique");
    assert!(ids.contains("dup"), "the first carrier keeps its /NM");
    let refs: HashSet<_> = got.iter().map(|a| common(a).source_ref.clone().unwrap()).collect();
    assert_eq!(refs.len(), 2);

    // Editing the repeat (fresh id) still updates its object in place.
    let repeat = got.iter().find(|a| common(a).id != "dup").unwrap();
    let r = common(repeat).source_ref.clone().unwrap();
    let edited = with_ref(ink(&common(repeat).id, 0, [0.0, 1.0, 0.0]), &r);
    let (out, refs) = write(&orig, &[edited], &[]);
    assert_eq!(refs[&common(repeat).id], r);
    let again = read_annotations(&out).unwrap();
    assert_eq!(again.len(), 2);
    assert!(again.iter().any(|a| common(a).id == common(repeat).id));
}

#[test]
fn undrawable_and_hidden_annotations_are_not_editable() {
    let got = read_annotations(&fixtures::pdf_with_undrawable_annots()).unwrap();
    let ids: Vec<_> = got.iter().map(|a| common(a).id.as_str()).collect();
    assert_eq!(ids, ["ok"]);
}

#[test]
fn freetext_update_drops_stale_rich_text() {
    let orig = fixtures::pdf_with_foreign_freetext();
    let got = read_annotations(&orig).unwrap();
    assert_eq!(got.len(), 1);
    let r = common(&got[0]).source_ref.clone().unwrap();
    let edited = with_ref(freetext("foreign-ft", 0, "new text", None), &r);
    let (out, refs) = write(&orig, &[edited], &[]);
    assert_eq!(refs["foreign-ft"], r);
    let doc = Document::load_mem(&out).unwrap();
    let d = annot_dict(&doc, &r);
    for key in [b"RC".as_slice(), b"RD", b"CL", b"IT"] {
        assert!(d.get(key).is_err(), "{} must be removed", String::from_utf8_lossy(key));
    }
    let text = |k: &[u8]| lopdf::decode_text_string(d.get(k).unwrap()).unwrap();
    assert_eq!(text(b"Contents"), "new text");
    assert_eq!(text(b"CreationDate"), "D:20260101000000Z", "foreign keys are kept");
}

fn content_of(doc: &Document, annot: &lopdf::Dictionary) -> String {
    String::from_utf8(ap_stream(doc, annot).decompressed_content().unwrap()).unwrap()
}

#[test]
fn shape_rect_roundtrip() {
    let orig = fixtures::simple_pdf(2);
    let a = shape("s", 1, ShapeKind::Rect, red_border(), yellow_fill());
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(&out[..orig.len()], &orig[..]);
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(a, &refs["s"])]);

    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["s"]);
    assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), b"Square");
    // /Rect = the geometric rect expanded by half the border width + 1.
    assert_eq!(floats(annot.get(b"Rect").unwrap()), [98.25, 197.75, 252.25, 302.5]);
    assert_eq!(floats(annot.get(b"C").unwrap()).len(), 3);
    assert_eq!(floats(annot.get(b"IC").unwrap()).len(), 3);
    assert_eq!(annot.get(b"CA").unwrap().as_i64().unwrap(), 1, "opacities live in the AP");
    let bs = annot.get(b"BS").unwrap().as_dict().unwrap();
    assert_eq!(bs.get(b"W").unwrap().as_float().unwrap(), 2.5);
    assert_eq!(bs.get(b"S").unwrap().as_name().unwrap(), b"S");
    let private = annot.get(b"JuliePDF").unwrap().as_dict().unwrap();
    assert_eq!(private.get(b"v").unwrap().as_i64().unwrap(), 1);
    assert!(private.get(b"hasBorder").unwrap().as_bool().unwrap());
    assert!(private.get(b"hasFill").unwrap().as_bool().unwrap());
    assert_eq!(private.get(b"borderOpacity").unwrap().as_float().unwrap(), 0.75);
    assert_eq!(private.get(b"fillOpacity").unwrap().as_float().unwrap(), 0.35);
    assert_eq!(floats(private.get(b"rect").unwrap()), [100.5, 200.0, 250.0, 300.25]);
    let content = content_of(&doc, annot);
    assert!(content.contains("100.5 200 149.5 100.25 re\n"), "{content}");
    for key in ["NM", "M", "T", "F", "P"] {
        assert!(annot.get(key.as_bytes()).is_ok(), "{key}");
    }
}

#[test]
fn shape_circle_roundtrip() {
    let orig = fixtures::simple_pdf(1);
    let k = 32.0 / 255.0;
    let a = shape(
        "c",
        0,
        ShapeKind::Circle,
        Some(Stroke { color: [k, 0.5, 1.0], width: 0.5, opacity: 0.1 }),
        Some(Fill { color: [0.094, 1.0, 1.0], opacity: 0.0 }),
    );
    let (out, refs) = write(&orig, std::slice::from_ref(&a), &[]);
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(a, &refs["c"])]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["c"]);
    assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), b"Circle");
    let content = content_of(&doc, annot);
    // One path for the fill, one for the stroke: 4 Béziers each.
    assert_eq!(content.matches(" c\n").count(), 8, "{content}");

    let outline = shape("o", 0, ShapeKind::Circle, red_border(), None);
    let (out, refs) = write(&orig, std::slice::from_ref(&outline), &[]);
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(outline, &refs["o"])]);
    let doc = Document::load_mem(&out).unwrap();
    assert_eq!(content_of(&doc, annot_dict(&doc, &refs["o"])).matches(" c\n").count(), 4);
}

#[test]
fn shape_circle_path_is_four_beziers_around_the_centre() {
    let ap = shape_appearance(ShapeKind::Circle, [0.0, 0.0, 200.0, 100.0], red_border().as_ref(), None);
    let t = String::from_utf8(ap.content).unwrap();
    assert_eq!(t.matches(" c\n").count(), 4, "{t}");
    // Starts at the rightmost point; rx = 100, ry = 50, kappa 0.5523.
    assert!(t.contains("200 50 m\n200 77.615 155.23 100 100 100 c\n"), "{t}");
    assert!(t.contains("h\nS\n"), "{t}");
    assert_eq!(ap.bbox, [-2.25, -2.25, 202.25, 102.25]);
}

#[test]
fn shape_appearance_uses_separate_fill_and_stroke_opacity() {
    let orig = fixtures::simple_pdf(1);
    let a = shape("s", 0, ShapeKind::Rect, red_border(), yellow_fill());
    let (out, refs) = write(&orig, &[a], &[]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["s"]);
    let stream = ap_stream(&doc, annot);
    let gs = stream
        .dict
        .get(b"Resources")
        .unwrap()
        .as_dict()
        .unwrap()
        .get(b"ExtGState")
        .unwrap()
        .as_dict()
        .unwrap();
    let f = gs.get(b"GSf").unwrap().as_dict().unwrap();
    let s = gs.get(b"GSs").unwrap().as_dict().unwrap();
    assert_eq!(f.get(b"ca").unwrap().as_float().unwrap(), 0.35);
    assert!(f.get(b"CA").is_err());
    assert_eq!(s.get(b"CA").unwrap().as_float().unwrap(), 0.75);
    assert!(s.get(b"ca").is_err());
    let content = content_of(&doc, annot);
    let fill = content.find("/GSf gs").expect("fill state");
    let stroke = content.find("/GSs gs").expect("stroke state");
    assert!(fill < stroke, "fill first: {content}");
    assert!(content.contains("1 0.922 0.231 rg\n"), "{content}");
    assert!(content.contains("2.5 w\n0.898 0.224 0.208 RG\n"), "{content}");
    assert!(content.contains("re\nf\n") && content.contains("re\nS\n"), "{content}");
}

#[test]
fn shape_without_fill_writes_empty_ic() {
    let orig = fixtures::simple_pdf(1);
    let a = shape("s", 0, ShapeKind::Rect, red_border(), None);
    let (out, refs) = write(&orig, &[a], &[]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["s"]);
    assert!(annot.get(b"IC").unwrap().as_array().unwrap().is_empty());
    let content = content_of(&doc, annot);
    assert!(!content.contains("/GSf") && !content.contains("\nf\n"), "{content}");

    let fill_only = shape("f", 0, ShapeKind::Rect, None, yellow_fill());
    let (out, refs) = write(&orig, std::slice::from_ref(&fill_only), &[]);
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(fill_only, &refs["f"])]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = annot_dict(&doc, &refs["f"]);
    assert!(annot.get(b"C").unwrap().as_array().unwrap().is_empty());
    assert_eq!(annot.get(b"BS").unwrap().as_dict().unwrap().get(b"W").unwrap().as_i64().unwrap(), 0);
    assert_eq!(floats(annot.get(b"Rect").unwrap()), [99.5, 199.0, 251.0, 301.25]);
    assert!(!content_of(&doc, annot).contains("/GSs"));
}

#[test]
fn shape_without_border_and_fill_is_skipped() {
    let orig = fixtures::simple_pdf(1);
    let (out, refs) = write(&orig, &[shape("n", 0, ShapeKind::Rect, None, None)], &[]);
    assert!(refs.is_empty());
    assert!(read_annotations(&out).unwrap().is_empty());
}

#[test]
fn foreign_square_annotation_is_read() {
    let orig = fixtures::pdf_with_foreign_shapes();
    let got = read_annotations(&orig).unwrap();
    let ids: Vec<_> = got.iter().map(|a| common(a).id.as_str()).collect();
    assert_eq!(ids, ["sq", "circ", "rd"], "the zero-area and invisible ones are skipped");
    let AnnotationDto::Shape { shape, rect, border, fill, .. } = &got[0] else { panic!("{got:?}") };
    assert_eq!(*shape, ShapeKind::Rect);
    assert_eq!(*rect, [102.0, 202.0, 298.0, 398.0], "/Rect shrunk by /BS /W / 2");
    assert_eq!(*border, Some(Stroke { color: [0.0, 0.0, 1.0], width: 4.0, opacity: 0.5 }));
    assert_eq!(*fill, None, "no /IC = no fill");
    let AnnotationDto::Shape { shape, rect, border, fill, .. } = &got[1] else { panic!("{got:?}") };
    assert_eq!(*shape, ShapeKind::Circle);
    assert_eq!(*rect, [100.5, 100.5, 199.5, 149.5], "no /BS = width 1");
    assert_eq!(*border, None, "empty /C = no border");
    assert_eq!(*fill, Some(Fill { color: [1.0, 0.0, 0.0], opacity: 1.0 }));
    let AnnotationDto::Shape { rect, .. } = &got[2] else { panic!("{got:?}") };
    assert_eq!(*rect, [16.0, 17.0, 86.0, 88.0], "/RD, then half the width");
}

#[test]
fn shape_edit_after_save_keeps_object() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(&orig, &[shape("s", 0, ShapeKind::Rect, red_border(), yellow_fill())], &[]);
    let mut edited = with_ref(shape("s", 0, ShapeKind::Rect, None, yellow_fill()), &refs1["s"]);
    if let AnnotationDto::Shape { rect, .. } = &mut edited {
        *rect = [50.0, 60.0, 70.0, 80.0];
    }
    let (out2, refs2) = write(&out1, std::slice::from_ref(&edited), &[]);
    assert_eq!(refs2["s"], refs1["s"]);
    assert_eq!(read_annotations(&out2).unwrap(), vec![edited]);
    let doc = Document::load_mem(&out2).unwrap();
    let annot = annot_dict(&doc, &refs2["s"]);
    assert!(annot.get(b"C").unwrap().as_array().unwrap().is_empty(), "old border colour cleared");
    assert_eq!(page_annots(&doc, 0).len(), 1);
}

#[test]
fn foreign_square_update_drops_stale_rd_and_keeps_foreign_keys() {
    let orig = fixtures::pdf_with_foreign_shapes();
    let got = read_annotations(&orig).unwrap();
    let rd = got.iter().find(|a| common(a).id == "rd").unwrap().clone();
    let r = common(&rd).source_ref.clone().unwrap();
    let (out, refs) = write(&orig, &[rd], &[]);
    assert_eq!(refs["rd"], r);
    let doc = Document::load_mem(&out).unwrap();
    let d = annot_dict(&doc, &r);
    assert!(d.get(b"RD").is_err());
    assert_eq!(lopdf::decode_text_string(d.get(b"CreationDate").unwrap()).unwrap(), "D:20260101000000Z");
    let again = read_annotations(&out).unwrap();
    let AnnotationDto::Shape { rect, .. } = again.iter().find(|a| common(a).id == "rd").unwrap() else {
        panic!("{again:?}")
    };
    assert_eq!(*rect, [16.0, 17.0, 86.0, 88.0]);
}

/// `bytes` with the annotation dictionary at `r` changed by `f` (another editor's save).
fn edited_by_other_app(bytes: &[u8], r: &str, f: impl FnOnce(&mut lopdf::Dictionary)) -> Vec<u8> {
    let mut doc = Document::load_mem(bytes).unwrap();
    f(doc.get_dictionary_mut(lopdf_id(r)).unwrap());
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn rect_obj(r: [f64; 4]) -> Object {
    Object::Array(r.iter().map(|&v| Object::Real(v as f32)).collect())
}

#[test]
fn shape_moved_by_another_editor_follows_its_rect() {
    let orig = fixtures::simple_pdf(1);
    let a = shape("s", 0, ShapeKind::Rect, red_border(), yellow_fill());
    let (out, refs) = write(&orig, &[a], &[]);
    // Written /Rect is [98.25, 197.75, 252.25, 302.5]; another app moves it by (+10, -20).
    let moved = edited_by_other_app(&out, &refs["s"], |d| d.set("Rect", rect_obj([108.25, 177.75, 262.25, 282.5])));
    let got = read_annotations(&moved).unwrap();
    let AnnotationDto::Shape { rect, border, fill, .. } = &got[0] else { panic!("{got:?}") };
    assert_eq!(*rect, [110.5, 180.0, 260.0, 280.25]);
    assert_eq!(*border, red_border(), "style still comes from /JuliePDF");
    assert_eq!(*fill, yellow_fill());
}

#[test]
fn shape_resized_by_another_editor_uses_geometry_from_its_rect() {
    let orig = fixtures::simple_pdf(1);
    let a = shape("s", 0, ShapeKind::Circle, red_border(), None);
    let (out, refs) = write(&orig, &[a], &[]);
    let resized = edited_by_other_app(&out, &refs["s"], |d| d.set("Rect", rect_obj([50.0, 50.0, 150.0, 100.0])));
    let got = read_annotations(&resized).unwrap();
    let AnnotationDto::Shape { rect, border, .. } = &got[0] else { panic!("{got:?}") };
    assert_eq!(*rect, [51.25, 51.25, 148.75, 98.75], "/Rect shrunk by /BS /W / 2");
    assert_eq!(*border, red_border());

    // Unchanged /Rect: the exact private rect wins.
    let got = read_annotations(&out).unwrap();
    assert!(matches!(&got[0], AnnotationDto::Shape { rect, .. } if *rect == [100.5, 200.0, 250.0, 300.25]));
}

#[test]
fn foreign_shape_with_zero_border_width_has_no_border() {
    let orig = fixtures::simple_pdf(1);
    let a = shape("s", 0, ShapeKind::Rect, red_border(), yellow_fill());
    let (out, refs) = write(&orig, &[a], &[]);
    let foreign = |f: &dyn Fn(&mut lopdf::Dictionary)| {
        let bytes = edited_by_other_app(&out, &refs["s"], |d| {
            d.remove(b"JuliePDF");
            d.set("Rect", rect_obj([10.0, 10.0, 50.0, 50.0]));
            f(d);
        });
        let got = read_annotations(&bytes).unwrap();
        let AnnotationDto::Shape { rect, border, fill, .. } = got[0].clone() else { panic!("{got:?}") };
        (rect, border, fill)
    };

    let (rect, border, fill) = foreign(&|d| d.set("BS", lopdf::dictionary! { "W" => 0 }));
    assert_eq!(border, None, "/BS /W 0 draws no border");
    assert_eq!(rect, [10.0, 10.0, 50.0, 50.0]);
    assert!(fill.is_some());

    let (rect, border, _) = foreign(&|d| {
        d.remove(b"BS");
        d.set("Border", vec![0.into(), 0.into(), 0.into()]);
    });
    assert_eq!(border, None, "/Border [0 0 0] without /BS draws no border");
    assert_eq!(rect, [10.0, 10.0, 50.0, 50.0]);

    let (rect, border, _) = foreign(&|d| {
        d.remove(b"BS");
        d.set("Border", vec![0.into(), 0.into(), 4.into()]);
    });
    assert_eq!(border.map(|b| b.width), Some(4.0), "/Border width without /BS");
    assert_eq!(rect, [12.0, 12.0, 48.0, 48.0]);
}

#[test]
fn saved_annotation_moved_to_another_page_changes_pages() {
    let orig = fixtures::simple_pdf(2);
    let (out1, refs1) = write(&orig, &[ink("a", 0, [0.0; 3])], &[]);
    let moved = with_ref(ink("a", 1, [0.0; 3]), &refs1["a"]);
    let (out2, refs2) = write(&out1, &[moved], &[]);
    assert_eq!(refs2["a"], refs1["a"], "the same object is reused");
    let doc = Document::load_mem(&out2).unwrap();
    assert!(page_annots(&doc, 0).is_empty(), "removed from its old page");
    assert_eq!(refs_of(&page_annots(&doc, 1)).iter().map(|&id| juliepdf_ref(id)).collect::<Vec<_>>(), [refs1["a"].clone()]);
    let got = read_annotations(&out2).unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got, vec![with_ref(ink("a", 1, [0.0; 3]), &refs1["a"])]);
}

#[test]
fn line_polyline_and_arrow_roundtrip() {
    let orig = fixtures::simple_pdf(1);
    let plain = line("l", 0, vec![[100.5, 200.0], [250.0, 300.25]], false);
    let arrow = line("a", 0, vec![[10.0, 10.0], [60.0, 10.0]], true);
    let poly = line("p", 0, vec![[10.0, 100.0], [50.0, 150.0], [90.0, 100.0], [130.0, 150.0]], true);
    let (out, refs) = write(&orig, &[plain.clone(), arrow.clone(), poly.clone()], &[]);
    let got = read_annotations(&out).unwrap();
    assert_eq!(got, vec![with_ref(plain, &refs["l"]), with_ref(arrow, &refs["a"]), with_ref(poly, &refs["p"])]);

    let doc = Document::load_mem(&out).unwrap();
    let name = |d: &lopdf::Dictionary, k: &[u8]| d.get(k).unwrap().as_name().unwrap().to_vec();
    let endings = |d: &lopdf::Dictionary| -> Vec<Vec<u8>> {
        d.get(b"LE").unwrap().as_array().unwrap().iter().map(|n| n.as_name().unwrap().to_vec()).collect()
    };
    let l = annot_dict(&doc, &refs["l"]);
    assert_eq!(name(l, b"Subtype"), b"Line");
    assert_eq!(floats(l.get(b"L").unwrap()), [100.5, 200.0, 250.0, 300.25]);
    assert_eq!(endings(l), [b"None".to_vec(), b"None".to_vec()]);
    assert_eq!(l.get(b"CA").unwrap().as_float().unwrap(), 0.75);
    let a = annot_dict(&doc, &refs["a"]);
    assert_eq!(endings(a), [b"None".to_vec(), b"OpenArrow".to_vec()]);
    // The /Rect covers the arrowhead: wings 3 * 2.5 + 6 = 13.5pt long, 30° off.
    let rect = floats(a.get(b"Rect").unwrap());
    assert!(rect[1] < 10.0 - 13.5 / 2.0 && rect[3] > 10.0 + 13.5 / 2.0, "{rect:?}");
    let p = annot_dict(&doc, &refs["p"]);
    assert_eq!(name(p, b"Subtype"), b"PolyLine");
    assert_eq!(floats(p.get(b"Vertices").unwrap()).len(), 8);
    let content = String::from_utf8(ap_stream(&doc, p).decompressed_content().unwrap()).unwrap();
    assert!(content.contains("10 100 m
50 150 l
90 100 l
130 150 l
"), "{content}");
    assert_eq!(content.matches("S
").count(), 1, "{content}");
}

#[test]
fn line_edit_after_save_keeps_object() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(&orig, &[line("l", 0, vec![[0.0, 0.0], [10.0, 10.0]], true)], &[]);
    let edited = with_ref(line("l", 0, vec![[5.0, 5.0], [20.0, 30.0]], false), &refs1["l"]);
    let (out2, refs2) = write(&out1, std::slice::from_ref(&edited), &[]);
    assert_eq!(refs2["l"], refs1["l"]);
    assert_eq!(read_annotations(&out2).unwrap(), vec![edited]);
}

#[test]
fn foreign_lines_are_read() {
    let orig = fixtures::pdf_with_foreign_lines();
    let got = read_annotations(&orig).unwrap();
    let ids: Vec<_> = got.iter().map(|a| common(a).id.as_str()).collect();
    assert_eq!(ids, ["line", "poly"], "the line without a colour is skipped");
    let AnnotationDto::Line { points, arrow, border, .. } = &got[0] else { panic!("{got:?}") };
    // Leader lines 10pt clockwise of the direction (+x): the line sits 10pt lower;
    // the arrow at the start becomes the end.
    assert_eq!(*points, vec![[200.0, 90.0], [100.0, 90.0]]);
    assert!(*arrow);
    assert_eq!(*border, Stroke { color: [0.0, 1.0, 0.0], width: 2.0, opacity: 1.0 });
    let AnnotationDto::Line { points, arrow, border, .. } = &got[1] else { panic!("{got:?}") };
    assert_eq!(*points, vec![[10.0, 10.0], [50.0, 60.0], [90.0, 10.0]]);
    assert!(!*arrow);
    assert_eq!(*border, Stroke { color: [0.0, 0.0, 1.0], width: 3.0, opacity: 0.5 });

    // Saving the foreign line drops its leader lines (the appearance draws none).
    let r = common(&got[0]).source_ref.clone().unwrap();
    let (out, _) = write(&orig, &[got[0].clone()], &[]);
    let doc = Document::load_mem(&out).unwrap();
    assert!(annot_dict(&doc, &r).get(b"LL").is_err());
    let AnnotationDto::Line { points: p, arrow: a, border: b, .. } = &read_annotations(&out).unwrap()[0] else {
        panic!()
    };
    assert_eq!((p, a, b), (points_of(&got[0]), &true, &Stroke { color: [0.0, 1.0, 0.0], width: 2.0, opacity: 1.0 }));
}

fn points_of(a: &AnnotationDto) -> &Vec<[f64; 2]> {
    let AnnotationDto::Line { points, .. } = a else { panic!("{a:?}") };
    points
}

fn order(page: u32, entries: &[(&str, Option<&str>)]) -> PageOrder {
    PageOrder {
        page,
        annotations: entries
            .iter()
            .map(|(id, r)| OrderedRef { id: id.to_string(), source_ref: r.map(str::to_string) })
            .collect(),
    }
}

fn ids_of(bytes: &[u8]) -> Vec<String> {
    read_annotations(bytes).unwrap().iter().map(|a| common(a).id.clone()).collect()
}

#[test]
fn reorder_roundtrip() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs) = write(
        &orig,
        &[ink("a", 0, [1.0, 0.0, 0.0]), ink("b", 0, [0.0, 1.0, 0.0]), ink("c", 0, [0.0, 0.0, 1.0])],
        &[],
    );
    let order = order(0, &[("c", Some(&refs["c"])), ("a", Some(&refs["a"])), ("b", Some(&refs["b"]))]);
    let (out2, new_refs) = write_incremental_ordered(&out1, &[], &[], None, &[order]).unwrap();
    assert!(new_refs.is_empty());
    assert_eq!(ids_of(&out2), ["c", "a", "b"]);
    // Only the order changed: the annotation objects are not written again.
    let appended = defined_objects(&out2[out1.len()..]);
    for r in refs.values() {
        assert!(!appended.contains(&lopdf_id(r).0), "{r} must not be rewritten");
    }
    let doc = Document::load_mem(&out2).unwrap();
    let annots: Vec<String> = refs_of(&page_annots(&doc, 0)).into_iter().map(juliepdf_ref).collect();
    assert_eq!(annots, [refs["c"].clone(), refs["a"].clone(), refs["b"].clone()]);
}

#[test]
fn unchanged_order_writes_nothing() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs) = write(&orig, &[ink("a", 0, [1.0, 0.0, 0.0]), ink("b", 0, [0.0, 1.0, 0.0])], &[]);
    let order = order(0, &[("a", Some(&refs["a"])), ("b", Some(&refs["b"]))]);
    let (out2, _) = write_incremental_ordered(&out1, &[], &[], None, &[order]).unwrap();
    let page_id = Document::load_mem(&out1).unwrap().page_iter().next().unwrap();
    assert!(!defined_objects(&out2[out1.len()..]).contains(&page_id.0));
    assert_eq!(ids_of(&out2), ["a", "b"]);
}

#[test]
fn reorder_places_annotations_new_in_the_same_save() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs) = write(&orig, &[ink("a", 0, [1.0, 0.0, 0.0])], &[]);
    // "b" is new (no ref yet) and goes below "a"; "a" is edited in the same save.
    let a = with_ref(ink("a", 0, [0.5, 0.0, 0.0]), &refs["a"]);
    let order = order(0, &[("b", None), ("a", Some(&refs["a"]))]);
    let (out2, _) = write_incremental_ordered(&out1, &[a, ink("b", 0, [0.0; 3])], &[], None, &[order]).unwrap();
    assert_eq!(ids_of(&out2), ["b", "a"]);
}

#[test]
fn reorder_keeps_foreign_entries_in_their_slots() {
    let orig = fixtures::pdf_with_foreign_annots();
    let doc = Document::load_mem(&orig).unwrap();
    let before = refs_of(&page_annots(&doc, 0));
    let foreign = read_annotations(&orig).unwrap();
    let foreign_ref = common(&foreign[0]).source_ref.clone().unwrap();
    let (out1, refs) = write(&orig, &[ink("new", 0, [1.0, 0.0, 0.0])], &[]);
    let order = order(0, &[("new", Some(&refs["new"])), ("foreign-ink", Some(&foreign_ref))]);
    let (out2, _) = write_incremental_ordered(&out1, &[], &[], None, &[order]).unwrap();
    assert_eq!(ids_of(&out2), ["new", "foreign-ink"]);
    // The link (not listed) keeps its index; the listed ones swap their slots.
    let after = refs_of(&page_annots(&Document::load_mem(&out2).unwrap(), 0));
    let new_id = lopdf_id(&refs["new"]);
    let ink_id = lopdf_id(&foreign_ref);
    let expected: Vec<ObjectId> = before
        .iter()
        .map(|&id| if id == ink_id { new_id } else { id })
        .chain([ink_id])
        .collect();
    assert_eq!(after, expected);
}

#[test]
fn order_ignores_stale_refs_and_pages_out_of_range() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs) = write(&orig, &[ink("a", 0, [1.0, 0.0, 0.0]), ink("b", 0, [0.0, 1.0, 0.0])], &[]);
    let orders = [
        // A ref now naming another annotation must not move it.
        order(0, &[("b", Some(&refs["b"])), ("x", Some(&refs["a"])), ("y", Some("garbage"))]),
        order(7, &[("a", Some(&refs["a"]))]),
    ];
    let (out2, _) = write_incremental_ordered(&out1, &[], &[], None, &orders).unwrap();
    assert_eq!(ids_of(&out2), ["a", "b"]);
}

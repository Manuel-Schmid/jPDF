//! Flattened annotations: burned into the page content instead of saved as annotations.
// Shared fixtures: this file needs only a few of them.
#[allow(dead_code)]
mod fixtures;

use juliepdf_lib::pdf::dto::{AnnotationDto, Common, ShapeKind, Stroke};
use juliepdf_lib::pdf::reader::read_annotations;
use juliepdf_lib::pdf::writer::write_incremental;
use lopdf::{Dictionary, Document, Object};

fn common(id: &str, page: u32, flattened: bool) -> Common {
    Common {
        id: id.into(),
        page,
        source_ref: None,
        modified_at: "2026-11-19T10:00:00Z".into(),
        author: "JuliePDF".into(),
        flattened,
    }
}

fn ink(id: &str, page: u32, flattened: bool) -> AnnotationDto {
    AnnotationDto::Ink {
        common: common(id, page, flattened),
        strokes: vec![vec![[100.0, 200.0], [150.0, 250.0], [200.0, 210.0]]],
        color: [1.0, 0.0, 0.0],
        width: 2.0,
        opacity: 1.0,
        blend: juliepdf_lib::pdf::dto::Blend::Normal,
        role: juliepdf_lib::pdf::dto::InkRole::Pen,
        pressure: None,
    }
}

fn rect(id: &str, page: u32, flattened: bool) -> AnnotationDto {
    AnnotationDto::Shape {
        common: common(id, page, flattened),
        shape: ShapeKind::Rect,
        rect: [300.0, 300.0, 400.0, 350.0],
        border: Some(Stroke { color: [0.0, 0.0, 1.0], width: 3.0, opacity: 1.0 }),
        fill: None,
    }
}

fn flattened(mut a: AnnotationDto, source_ref: Option<&str>) -> AnnotationDto {
    match &mut a {
        AnnotationDto::Ink { common, .. } | AnnotationDto::Shape { common, .. } => {
            common.flattened = true;
            common.source_ref = source_ref.map(Into::into);
        }
        _ => unreachable!(),
    }
    a
}

fn page_dict(doc: &Document, page: usize) -> &Dictionary {
    doc.get_dictionary(doc.page_iter().nth(page).unwrap()).unwrap()
}

/// The page's content streams, decoded, in order.
fn contents(doc: &Document, page: usize) -> Vec<String> {
    let refs = match page_dict(doc, page).get(b"Contents").unwrap() {
        Object::Array(items) => items.iter().map(|o| o.as_reference().unwrap()).collect(),
        Object::Reference(id) => vec![*id],
        o => panic!("{o:?}"),
    };
    refs.into_iter()
        .map(|id| {
            let s = doc.get_object(id).unwrap().as_stream().unwrap();
            String::from_utf8_lossy(&s.decompressed_content().unwrap_or_else(|_| s.content.clone())).into_owned()
        })
        .collect()
}

fn xobjects(doc: &Document, page: usize) -> Dictionary {
    let res = page_dict(doc, page).get_deref(b"Resources", doc).unwrap().as_dict().unwrap();
    res.get_deref(b"XObject", doc).unwrap().as_dict().unwrap().clone()
}

fn annots_len(doc: &Document, page: usize) -> usize {
    match page_dict(doc, page).get_deref(b"Annots", doc) {
        Ok(Object::Array(a)) => a.len(),
        _ => 0,
    }
}

#[test]
fn flattened_annotation_is_painted_into_the_page_not_saved_as_annotation() {
    let orig = fixtures::simple_pdf(2);
    let (out, refs) = write_incremental(&orig, &[ink("a", 1, true)], &[]).unwrap();
    assert!(refs.is_empty(), "a flattened annotation gets no file object: {refs:?}");
    assert_eq!(&out[..orig.len()], &orig[..], "still an incremental update");
    assert!(read_annotations(&out).unwrap().is_empty());

    let doc = Document::load_mem(&out).unwrap();
    assert_eq!(annots_len(&doc, 1), 0);
    let streams = contents(&doc, 1);
    // The original content is wrapped in q … Q, then the form is painted.
    assert_eq!(streams.first().map(String::as_str), Some("q\n"));
    assert!(streams[1].contains("(Page 2) Tj"), "{streams:?}");
    assert_eq!(streams.last().unwrap(), "Q\nq /JPDFFlat0 Do Q\n");

    let xo = xobjects(&doc, 1);
    let form = doc.get_object(xo.get(b"JPDFFlat0").unwrap().as_reference().unwrap()).unwrap().as_stream().unwrap();
    assert_eq!(form.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Form");
    // The inherited resources (the page font) are kept in the page's own copy.
    let res = page_dict(&doc, 1).get_deref(b"Resources", &doc).unwrap().as_dict().unwrap();
    assert!(res.get_deref(b"Font", &doc).unwrap().as_dict().unwrap().has(b"F1"));
    // The other page is untouched.
    assert_eq!(contents(&doc, 0).len(), 1);
}

#[test]
fn flattening_a_saved_annotation_removes_it_from_annots() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write_incremental(&orig, &[ink("a", 0, false), rect("b", 0, false)], &[]).unwrap();
    let a = flattened(ink("a", 0, false), Some(&refs1["a"]));
    let (out2, refs2) = write_incremental(&out1, &[a], &[]).unwrap();
    assert!(refs2.is_empty());

    let got = read_annotations(&out2).unwrap();
    let ids: Vec<_> = got
        .iter()
        .map(|a| match a {
            AnnotationDto::Shape { common, .. } => common.id.as_str(),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(ids, ["b"], "only the flattened annotation left /Annots");
    let doc = Document::load_mem(&out2).unwrap();
    assert_eq!(annots_len(&doc, 0), 1);
    assert!(contents(&doc, 0).last().unwrap().contains("/JPDFFlat0 Do"));
}

#[test]
fn several_flattened_annotations_are_painted_in_order() {
    let orig = fixtures::simple_pdf(1);
    let (out, _) = write_incremental(&orig, &[rect("r", 0, true), ink("normal", 0, false), ink("i", 0, true)], &[]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    assert_eq!(contents(&doc, 0).last().unwrap(), "Q\nq /JPDFFlat0 Do Q\nq /JPDFFlat1 Do Q\n");
    let xo = xobjects(&doc, 0);
    assert!(xo.has(b"JPDFFlat0") && xo.has(b"JPDFFlat1"));
    // The annotation that was not flattened is saved as usual.
    assert_eq!(read_annotations(&out).unwrap().len(), 1);
    assert_eq!(annots_len(&doc, 0), 1);
}

#[test]
fn flattening_twice_uses_fresh_resource_names() {
    let orig = fixtures::simple_pdf(1);
    let (out1, _) = write_incremental(&orig, &[ink("a", 0, true)], &[]).unwrap();
    let (out2, _) = write_incremental(&out1, &[rect("b", 0, true)], &[]).unwrap();
    let doc = Document::load_mem(&out2).unwrap();
    let xo = xobjects(&doc, 0);
    assert!(xo.has(b"JPDFFlat0") && xo.has(b"JPDFFlat1"), "the first save's form is kept");
    assert_eq!(contents(&doc, 0).last().unwrap(), "Q\nq /JPDFFlat1 Do Q\n");
}

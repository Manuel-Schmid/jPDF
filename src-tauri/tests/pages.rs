//! Saving with a page plan: reordered, duplicated, deleted, empty and rotated pages.
#[allow(dead_code)]
mod fixtures;

use juliepdf_lib::error::AppError;
use juliepdf_lib::pdf::dto::{AnnotationDto, Blend, Common, DeleteRef, InkRole, PageSpec, TextAlign};
use juliepdf_lib::pdf::reader::read_annotations;
use juliepdf_lib::pdf::writer::{write_incremental, write_incremental_with_pages};
use lopdf::{Dictionary, Document, Object, ObjectId};

fn common(id: &str, page: u32) -> Common {
    Common {
        id: id.into(),
        page,
        source_ref: None,
        modified_at: "2026-11-19T10:00:00Z".into(),
        author: "JuliePDF".into(),
        flattened: false,
    }
}

fn ink(id: &str, page: u32) -> AnnotationDto {
    AnnotationDto::Ink {
        common: common(id, page),
        strokes: vec![vec![[100.0, 200.0], [150.0, 250.0]]],
        color: [1.0, 0.0, 0.0],
        width: 2.0,
        opacity: 1.0,
        blend: Blend::Normal,
        role: InkRole::Pen,
        pressure: None,
    }
}

fn freetext(id: &str, page: u32) -> AnnotationDto {
    AnnotationDto::Freetext {
        common: common(id, page),
        rect: [100.0, 300.0, 130.0, 500.0],
        text: "upright".into(),
        lines: vec!["upright".into()],
        font_size: 12.0,
        text_color: [0.0; 3],
        background: None,
        align: TextAlign::Left,
    }
}

fn source(index: u32, rotate: i32) -> PageSpec {
    PageSpec::Source { index, rotate }
}

fn with_pages(
    orig: &[u8],
    upserts: &[AnnotationDto],
    pages: &[PageSpec],
) -> Result<(Vec<u8>, std::collections::HashMap<String, String>), AppError> {
    write_incremental_with_pages(orig, upserts, &[], Some(pages))
}

fn root_pages(doc: &Document) -> ObjectId {
    doc.catalog().unwrap().get(b"Pages").unwrap().as_reference().unwrap()
}

fn page(doc: &Document, id: ObjectId) -> &Dictionary {
    doc.get_dictionary(id).unwrap()
}

fn own_rotate(doc: &Document, id: ObjectId) -> i64 {
    page(doc, id).get(b"Rotate").unwrap().as_i64().unwrap()
}

fn nums(o: &Object) -> Vec<f32> {
    o.as_array().unwrap().iter().map(|v| v.as_float().unwrap()).collect()
}

fn ref_id(r: &str) -> ObjectId {
    (r.trim_end_matches('R').parse().unwrap(), 0)
}

#[test]
fn no_plan_writes_exactly_what_the_plain_writer_writes() {
    let orig = fixtures::simple_pdf(2);
    let ups = [ink("a", 1)];
    let dels: [DeleteRef; 0] = [];
    let plain = write_incremental(&orig, &ups, &dels).unwrap().0;
    let none = write_incremental_with_pages(&orig, &ups, &dels, None).unwrap().0;
    assert_eq!(plain, none);
}

#[test]
fn plan_reorders_duplicates_deletes_inserts_and_rotates() {
    let orig = fixtures::nested_pages_pdf();
    let before = Document::load_mem(&orig).unwrap();
    let old: Vec<ObjectId> = before.page_iter().collect();
    let inherited_resources = before
        .get_dictionary(page(&before, old[0]).get(b"Parent").unwrap().as_reference().unwrap())
        .unwrap()
        .get(b"Resources")
        .unwrap()
        .clone();
    // Page 2 first, page 0 twice (second a duplicate), page 1 deleted, then an empty page.
    let plan = [
        source(2, 90),
        source(0, 180),
        source(0, 90),
        PageSpec::Blank { width: 300.0, height: 500.0, rotate: 270 },
    ];
    let (out, _) = with_pages(&orig, &[], &plan).unwrap();
    assert_eq!(&out[..orig.len()], &orig[..], "original bytes stay a prefix");

    let doc = Document::load_mem(&out).unwrap();
    let pages: Vec<ObjectId> = doc.page_iter().collect();
    assert_eq!(pages.len(), 4);
    assert_eq!(pages[0], old[2], "first occurrences keep their object");
    assert_eq!(pages[1], old[0]);
    assert!(!old.contains(&pages[2]), "a duplicate is a new page object");
    assert!(!old.contains(&pages[3]));

    let root = root_pages(&doc);
    let root_dict = doc.get_dictionary(root).unwrap();
    assert_eq!(root_dict.get(b"Count").unwrap().as_i64().unwrap(), 4);
    for (k, &p) in pages.iter().enumerate() {
        assert_eq!(page(&doc, p).get(b"Parent").unwrap().as_reference().unwrap(), root, "page {k}");
    }
    let rotations: Vec<i64> = pages.iter().map(|&p| own_rotate(&doc, p)).collect();
    assert_eq!(rotations, [90, 180, 90, 270]);

    // Attributes inherited from the dropped intermediate node are resolved into the pages.
    for &p in &pages[..3] {
        assert_eq!(nums(page(&doc, p).get(b"MediaBox").unwrap()), [0.0, 0.0, 400.0, 600.0]);
        assert_eq!(page(&doc, p).get(b"Resources").unwrap(), &inherited_resources);
    }
    // The duplicate draws the same content and has none of the original's annotations.
    assert_eq!(
        page(&doc, pages[2]).get(b"Contents").unwrap(),
        page(&before, old[0]).get(b"Contents").unwrap()
    );
    assert!(page(&doc, pages[2]).get(b"Annots").is_err());

    let blank = page(&doc, pages[3]);
    assert_eq!(nums(blank.get(b"MediaBox").unwrap()), [0.0, 0.0, 300.0, 500.0]);
    assert_eq!(blank.get(b"Type").unwrap().as_name().unwrap(), b"Page");
    let contents = doc.get_object(blank.get(b"Contents").unwrap().as_reference().unwrap()).unwrap();
    assert!(contents.as_stream().unwrap().content.is_empty());
    assert!(blank.get(b"Resources").unwrap().as_dict().is_ok());
}

#[test]
fn annotations_land_on_planned_pages_with_their_page_as_p() {
    let orig = fixtures::simple_pdf(2);
    let plan = [source(1, 0), source(0, 0), source(0, 0)];
    let (out, refs) = with_pages(&orig, &[ink("on-dup", 2), ink("on-first", 0)], &plan).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let pages: Vec<ObjectId> = doc.page_iter().collect();
    for (id, p) in [("on-dup", 2usize), ("on-first", 0)] {
        let annot = doc.get_dictionary(ref_id(&refs[id])).unwrap();
        assert_eq!(annot.get(b"P").unwrap().as_reference().unwrap(), pages[p], "{id}");
    }
    let read = read_annotations(&out).unwrap();
    let placed: Vec<(String, u32)> = read
        .iter()
        .map(|a| match a {
            AnnotationDto::Ink { common, .. } => (common.id.clone(), common.page),
            _ => unreachable!(),
        })
        .collect();
    assert_eq!(placed, [("on-first".to_string(), 0), ("on-dup".to_string(), 2)]);
}

#[test]
fn freetext_appearance_uses_the_final_rotation() {
    // The file page inherits /Rotate 90; the plan turns it to 180.
    let orig = fixtures::nested_pages_pdf();
    let (out, refs) = with_pages(&orig, &[freetext("t", 0)], &[source(0, 180)]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let annot = doc.get_dictionary(ref_id(&refs["t"])).unwrap();
    let ap = annot.get(b"AP").unwrap().as_dict().unwrap().get(b"N").unwrap().as_reference().unwrap();
    let matrix = nums(doc.get_object(ap).unwrap().as_stream().unwrap().dict.get(b"Matrix").unwrap());
    assert_eq!(&matrix[..4], &[-1.0, 0.0, 0.0, -1.0]);
}

#[test]
fn duplicate_of_a_page_with_foreign_annotations_gets_none() {
    let orig = fixtures::pdf_with_foreign_annots();
    let before = Document::load_mem(&orig).unwrap();
    let first = before.page_iter().next().unwrap();
    let foreign = page(&before, first).get(b"Annots").unwrap().clone();
    let (out, _) = with_pages(&orig, &[], &[source(0, 0), source(0, 0)]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let pages: Vec<ObjectId> = doc.page_iter().collect();
    assert_eq!(page(&doc, pages[0]).get(b"Annots").unwrap(), &foreign);
    assert!(page(&doc, pages[1]).get(b"Annots").is_err());
    // The foreign annotations are still read once (from the original page only).
    assert_eq!(read_annotations(&out).unwrap().len(), read_annotations(&orig).unwrap().len());
}

#[test]
fn saved_annotation_on_a_shifted_page_keeps_its_object() {
    let orig = fixtures::simple_pdf(2);
    let (first, refs) = write_incremental(&orig, &[ink("a", 1)], &[]).unwrap();
    let r = refs["a"].clone();
    let mut moved = ink("a", 2);
    if let AnnotationDto::Ink { common, .. } = &mut moved {
        common.source_ref = Some(r.clone());
    }
    let plan = [PageSpec::Blank { width: 100.0, height: 100.0, rotate: 0 }, source(0, 0), source(1, 0)];
    let (out, refs2) = with_pages(&first, &[moved], &plan).unwrap();
    assert_eq!(refs2["a"], r);
    let doc = Document::load_mem(&out).unwrap();
    let pages: Vec<ObjectId> = doc.page_iter().collect();
    let annots = page(&doc, pages[2]).get_deref(b"Annots", &doc).unwrap().as_array().unwrap().clone();
    assert_eq!(annots, vec![Object::Reference(ref_id(&r))]);
}

#[test]
fn invalid_plans_are_rejected() {
    let orig = fixtures::simple_pdf(2);
    for plan in [vec![], vec![source(2, 0)], vec![source(0, 45)], vec![PageSpec::Blank { width: 0.0, height: 10.0, rotate: 0 }]] {
        assert!(matches!(with_pages(&orig, &[], &plan), Err(AppError::InvalidPdf(_))), "{plan:?}");
    }
}

#[test]
fn blank_page_does_not_inherit_a_crop_box() {
    let orig = fixtures::inherited_cropbox_pdf();
    let plan = [source(0, 0), PageSpec::Blank { width: 300.0, height: 500.0, rotate: 0 }];
    let (out, _) = with_pages(&orig, &[], &plan).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let pages: Vec<ObjectId> = doc.page_iter().collect();
    assert_eq!(nums(page(&doc, pages[1]).get(b"CropBox").unwrap()), [0.0, 0.0, 300.0, 500.0]);
}

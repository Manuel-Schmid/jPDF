//! Exporting a copy of a PDF without its annotations (the builder's Export menu).
#[allow(dead_code)]
mod fixtures;

use juliepdf_lib::commands::files::export_to_path;
use juliepdf_lib::error::AppError;
use juliepdf_lib::pdf::dto::{AnnotationDto, Blend, Common, InkRole, PageSpec};
use juliepdf_lib::pdf::export::without_annotations;
use juliepdf_lib::pdf::reader::read_annotations;
use juliepdf_lib::pdf::writer::write_incremental;
use lopdf::{Document, Object, ObjectId};

fn load(bytes: &[u8]) -> Document {
    Document::load_mem(bytes).unwrap()
}

fn pages(doc: &Document) -> Vec<ObjectId> {
    doc.page_iter().collect()
}

/// The `/Subtype` of every annotation on page `index`, in order.
fn subtypes(doc: &Document, index: usize) -> Vec<String> {
    let page = doc.get_dictionary(pages(doc)[index]).unwrap();
    let Ok(annots) = page.get_deref(b"Annots", doc).and_then(Object::as_array) else {
        return Vec::new();
    };
    annots
        .iter()
        .map(|o| {
            let d = doc.get_dictionary(o.as_reference().unwrap()).unwrap();
            String::from_utf8(d.get(b"Subtype").unwrap().as_name().unwrap().to_vec()).unwrap()
        })
        .collect()
}

/// Whether any object in the file is an annotation of this subtype.
fn has_object_of_subtype(doc: &Document, subtype: &[u8]) -> bool {
    doc.objects.values().any(|o| {
        o.as_dict()
            .ok()
            .and_then(|d| d.get(b"Subtype").ok())
            .and_then(|s| s.as_name().ok())
            .is_some_and(|n| n == subtype)
    })
}

/// The "Page N" line each page draws, in page order.
fn page_labels(doc: &Document) -> Vec<String> {
    pages(doc)
        .into_iter()
        .map(|id| {
            let content = String::from_utf8_lossy(&doc.get_page_content(id)).into_owned();
            let start = content.find("(Page ").expect("page label") + 1;
            let end = start + content[start..].find(')').unwrap();
            content[start..end].to_string()
        })
        .collect()
}

fn ink(id: &str, page: u32) -> AnnotationDto {
    ink_flattened(id, page, false)
}

fn ink_flattened(id: &str, page: u32, flattened: bool) -> AnnotationDto {
    AnnotationDto::Ink {
        common: Common {
            id: id.into(),
            page,
            source_ref: None,
            modified_at: "2026-11-20T10:00:00Z".into(),
            author: "Jülie".into(),
            flattened,
        },
        strokes: vec![vec![[100.0, 200.0], [150.0, 250.0]]],
        color: [1.0, 0.0, 0.0],
        width: 2.0,
        opacity: 1.0,
        blend: Blend::Normal,
        role: InkRole::Pen,
        pressure: None,
    }
}

#[test]
fn markup_is_removed_and_links_stay() {
    let out = without_annotations(&fixtures::pdf_with_foreign_annots(), &[], None).unwrap();
    let doc = load(&out);
    assert_eq!(subtypes(&doc, 0), ["Link"]);
    // The removed annotation's object is gone from the file, not just unlisted.
    assert!(!has_object_of_subtype(&doc, b"Ink"));
}

#[test]
fn page_with_only_markup_loses_its_annots_entry() {
    let out = without_annotations(&fixtures::pdf_with_foreign_shapes(), &[], None).unwrap();
    let doc = load(&out);
    let page = doc.get_dictionary(pages(&doc)[0]).unwrap();
    assert!(page.get(b"Annots").is_err());
    assert!(!has_object_of_subtype(&doc, b"Square"));
}

#[test]
fn form_fields_stay() {
    let out = without_annotations(&fixtures::form_pdf("name"), &[], None).unwrap();
    let doc = load(&out);
    assert_eq!(subtypes(&doc, 0), ["Widget"]);
    let form = doc.catalog().unwrap().get_deref(b"AcroForm", &doc).unwrap().as_dict().unwrap();
    assert_eq!(form.get(b"Fields").unwrap().as_array().unwrap().len(), 1);
}

#[test]
fn indirect_annots_array_is_filtered() {
    let out = without_annotations(&fixtures::pdf_with_indirect_annots(), &[], None).unwrap();
    assert_eq!(subtypes(&load(&out), 0), ["Link"]);
}

#[test]
fn saved_annotations_leave_no_history_behind() {
    let (saved, _) = write_incremental(&fixtures::simple_pdf(1), &[ink("a", 0)], &[]).unwrap();
    assert_eq!(read_annotations(&saved).unwrap().len(), 1);
    let out = without_annotations(&saved, &[], None).unwrap();
    let doc = load(&out);
    assert!(read_annotations(&out).unwrap().is_empty());
    // A fresh, full file: no earlier revision still holds the annotation.
    assert!(doc.trailer.get(b"Prev").is_err());
    assert!(!has_object_of_subtype(&doc, b"Ink"));
}

#[test]
fn page_plan_is_applied() {
    let plan = [
        PageSpec::Source { index: 2, rotate: 90 },
        PageSpec::Source { index: 0, rotate: 0 },
    ];
    let out = without_annotations(&fixtures::simple_pdf(3), &[], Some(&plan)).unwrap();
    let doc = load(&out);
    assert_eq!(page_labels(&doc), ["Page 3", "Page 1"]);
    let first = doc.get_dictionary(pages(&doc)[0]).unwrap();
    assert_eq!(first.get(b"Rotate").unwrap().as_i64().unwrap(), 90);
}

#[test]
fn page_plan_on_annotated_pages_still_strips() {
    let plan = [
        PageSpec::Blank { width: 595.0, height: 842.0, rotate: 0 },
        PageSpec::Source { index: 0, rotate: 0 },
    ];
    let out = without_annotations(&fixtures::pdf_with_foreign_annots(), &[], Some(&plan)).unwrap();
    let doc = load(&out);
    assert!(subtypes(&doc, 0).is_empty());
    assert_eq!(subtypes(&doc, 1), ["Link"]);
    assert!(!has_object_of_subtype(&doc, b"Ink"));
}

/// The page's content streams, decoded and joined.
fn page_content(doc: &Document, index: usize) -> String {
    String::from_utf8_lossy(&doc.get_page_content(pages(doc)[index])).into_owned()
}

#[test]
fn pending_flattened_annotations_are_burned_in() {
    let out = without_annotations(&fixtures::simple_pdf(2), &[ink_flattened("f", 1, true)], None).unwrap();
    let doc = load(&out);
    assert!(subtypes(&doc, 1).is_empty());
    assert!(page_content(&doc, 1).contains("/JPDFFlat0 Do"), "{}", page_content(&doc, 1));
    assert!(!page_content(&doc, 0).contains("Do"));
}

#[test]
fn unflattened_annotations_passed_along_are_not_written() {
    let out = without_annotations(&fixtures::simple_pdf(1), &[ink("a", 0)], None).unwrap();
    let doc = load(&out);
    assert!(subtypes(&doc, 0).is_empty());
    assert!(!has_object_of_subtype(&doc, b"Ink"));
    assert!(!page_content(&doc, 0).contains("Do"));
}

#[test]
fn flattened_annotations_index_the_page_plan() {
    let plan = [PageSpec::Source { index: 1, rotate: 0 }, PageSpec::Source { index: 0, rotate: 0 }];
    let out = without_annotations(&fixtures::simple_pdf(2), &[ink_flattened("f", 0, true)], Some(&plan)).unwrap();
    let doc = load(&out);
    assert_eq!(page_labels(&doc), ["Page 2", "Page 1"]);
    assert!(page_content(&doc, 0).contains("Do"));
    assert!(!page_content(&doc, 1).contains("Do"));
}

#[test]
fn xref_stream_input() {
    let out = without_annotations(&fixtures::xref_stream_pdf(), &[], None).unwrap();
    assert_eq!(page_labels(&load(&out)), ["Page 1", "Page 2"]);
}

#[test]
fn encrypted_input_refused() {
    let err = without_annotations(&fixtures::encrypted_pdf(), &[], None).unwrap_err();
    assert!(matches!(err, AppError::Encrypted(_)), "{err:?}");
}

#[test]
fn writes_the_target_and_leaves_the_source() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("a.pdf");
    let target = dir.path().join("a clean.pdf");
    let original = fixtures::pdf_with_foreign_annots();
    std::fs::write(&source, &original).unwrap();
    export_to_path(&source, &target, &[], None).unwrap();
    assert_eq!(std::fs::read(&source).unwrap(), original);
    assert_eq!(subtypes(&load(&std::fs::read(&target).unwrap()), 0), ["Link"]);
}

#[test]
fn unreadable_source_leaves_no_target() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("broken.pdf");
    let target = dir.path().join("out.pdf");
    std::fs::write(&source, b"not a pdf").unwrap();
    assert!(matches!(export_to_path(&source, &target, &[], None), Err(AppError::InvalidPdf(_))));
    assert!(!target.exists());
}

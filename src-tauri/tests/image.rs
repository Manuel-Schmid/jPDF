//! Pasted images: saved as `/Stamp` annotations drawing an image XObject.
#[allow(dead_code)]
mod fixtures;

use std::collections::HashMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use juliepdf_lib::error::AppError;
use juliepdf_lib::pdf::dto::{AnnotationDto, Common, ImageData};
use juliepdf_lib::pdf::reader::read_annotations;
use juliepdf_lib::pdf::writer::write_incremental;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream, dictionary};

/// A `w` x `h` PNG; RGBA when `alpha` is given (every pixel gets that alpha), else RGB.
fn png(w: u32, h: u32, alpha: Option<u8>) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(if alpha.is_some() { png::ColorType::Rgba } else { png::ColorType::Rgb });
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().unwrap();
        let mut data = Vec::new();
        for y in 0..h {
            for x in 0..w {
                data.extend([(x * 40) as u8, (y * 60) as u8, 200]);
                if let Some(a) = alpha {
                    data.push(a);
                }
            }
        }
        writer.write_image_data(&data).unwrap();
    }
    out
}

fn image(id: &str, rect: [f64; 4], png_bytes: &[u8], w: u32, h: u32) -> AnnotationDto {
    AnnotationDto::Image {
        common: Common {
            id: id.into(),
            page: 0,
            source_ref: None,
            modified_at: "2026-11-19T10:00:00Z".into(),
            author: "Jülie".into(),
            flattened: false,
        },
        rect,
        image: ImageData { width: w, height: h, png: STANDARD.encode(png_bytes) },
        rotation: 0.0,
    }
}

fn with_ref(mut a: AnnotationDto, r: &str) -> AnnotationDto {
    if let AnnotationDto::Image { common, .. } = &mut a {
        common.source_ref = Some(r.into());
    }
    a
}

fn write(original: &[u8], upserts: &[AnnotationDto]) -> Result<(Vec<u8>, HashMap<String, String>), AppError> {
    write_incremental(original, upserts, &[])
}

fn id_of(r: &str) -> ObjectId {
    let (num, generation) = r.split_once('R').unwrap();
    (num.parse().unwrap(), if generation.is_empty() { 0 } else { generation.parse().unwrap() })
}

fn ap_stream<'a>(doc: &'a Document, annot: &Dictionary) -> &'a Stream {
    let ap = annot.get(b"AP").unwrap().as_dict().unwrap().get(b"N").unwrap().as_reference().unwrap();
    doc.get_object(ap).unwrap().as_stream().unwrap()
}

fn plain(s: &Stream) -> Vec<u8> {
    s.decompressed_content().unwrap_or_else(|_| s.content.clone())
}

/// The image XObject `/Im0` of the annotation's appearance.
fn image_xobject(doc: &Document, annot: &Dictionary) -> (ObjectId, Stream) {
    let ap = ap_stream(doc, annot);
    let resources = ap.dict.get(b"Resources").unwrap().as_dict().unwrap();
    let id = resources.get(b"XObject").unwrap().as_dict().unwrap().get(b"Im0").unwrap().as_reference().unwrap();
    (id, doc.get_object(id).unwrap().as_stream().unwrap().clone())
}

fn floats(o: &Object) -> Vec<f32> {
    o.as_array().unwrap().iter().map(|v| v.as_float().unwrap()).collect()
}

const RECT: [f64; 4] = [100.5, 200.0, 250.0, 300.25];

#[test]
fn image_roundtrip() {
    let orig = fixtures::simple_pdf(1);
    let bytes = png(3, 2, None);
    let a = image("i", RECT, &bytes, 3, 2);
    let (out, refs) = write(&orig, std::slice::from_ref(&a)).unwrap();
    let got = read_annotations(&out).unwrap();
    assert_eq!(got, vec![with_ref(a, &refs["i"])]);
    // The exact PNG comes back.
    let AnnotationDto::Image { image, .. } = &got[0] else { panic!("not an image") };
    assert_eq!(STANDARD.decode(&image.png).unwrap(), bytes);

    let doc = Document::load_mem(&out).unwrap();
    let annot = doc.get_dictionary(id_of(&refs["i"])).unwrap();
    assert_eq!(annot.get(b"Subtype").unwrap().as_name().unwrap(), b"Stamp");
    assert_eq!(annot.get(b"Name").unwrap().as_name().unwrap(), b"Image");
    assert_eq!(annot.get(b"F").unwrap().as_i64().unwrap(), 4);
    let (_, im) = image_xobject(&doc, annot);
    assert_eq!(im.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Image");
    assert_eq!(im.dict.get(b"Width").unwrap().as_i64().unwrap(), 3);
    assert_eq!(im.dict.get(b"Height").unwrap().as_i64().unwrap(), 2);
    assert_eq!(im.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceRGB");
    assert_eq!(im.dict.get(b"BitsPerComponent").unwrap().as_i64().unwrap(), 8);
    let pixels = plain(&im);
    assert_eq!(pixels.len(), 3 * 2 * 3);
    assert_eq!(&pixels[..6], &[0, 0, 200, 40, 0, 200]);
}

#[test]
fn image_with_alpha_writes_smask() {
    let orig = fixtures::simple_pdf(1);
    let (out, refs) = write(&orig, &[image("i", RECT, &png(2, 2, Some(128)), 2, 2)]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let (_, im) = image_xobject(&doc, doc.get_dictionary(id_of(&refs["i"])).unwrap());
    let smask_id = im.dict.get(b"SMask").unwrap().as_reference().unwrap();
    let smask = doc.get_object(smask_id).unwrap().as_stream().unwrap();
    assert_eq!(smask.dict.get(b"ColorSpace").unwrap().as_name().unwrap(), b"DeviceGray");
    assert_eq!(smask.dict.get(b"Width").unwrap().as_i64().unwrap(), 2);
    assert_eq!(plain(smask), vec![128; 4]);
    assert_eq!(plain(&im).len(), 2 * 2 * 3);
}

#[test]
fn image_without_alpha_has_no_smask() {
    let orig = fixtures::simple_pdf(1);
    // Fully opaque RGBA counts as no alpha too.
    for bytes in [png(2, 2, None), png(2, 2, Some(255))] {
        let (out, refs) = write(&orig, &[image("i", RECT, &bytes, 2, 2)]).unwrap();
        let doc = Document::load_mem(&out).unwrap();
        let (_, im) = image_xobject(&doc, doc.get_dictionary(id_of(&refs["i"])).unwrap());
        assert!(im.dict.get(b"SMask").is_err());
    }
}

#[test]
fn image_appearance_draws_xobject() {
    let orig = fixtures::simple_pdf(1);
    let (out, refs) = write(&orig, &[image("i", RECT, &png(2, 2, None), 2, 2)]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let annot = doc.get_dictionary(id_of(&refs["i"])).unwrap();
    let content = String::from_utf8(plain(ap_stream(&doc, annot))).unwrap();
    assert!(content.contains("149.5 0 0 100.25 100.5 200 cm"), "{content}");
    assert!(content.contains("/Im0 Do"), "{content}");
    assert_eq!(floats(annot.get(b"Rect").unwrap()), RECT.map(|v| v as f32));
}

#[test]
fn image_on_rotated_page_is_counter_rotated() {
    let orig = fixtures::rotated_pdf();
    let a = image("i", RECT, &png(2, 2, None), 2, 2);
    let (out, refs) = write(&orig, std::slice::from_ref(&a)).unwrap();
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(a, &refs["i"])]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = doc.get_dictionary(id_of(&refs["i"])).unwrap();
    let matrix = floats(ap_stream(&doc, annot).dict.get(b"Matrix").unwrap());
    assert_eq!(&matrix[..4], &[0.0, 1.0, -1.0, 0.0]);
    assert_eq!(floats(annot.get(b"Rect").unwrap()), RECT.map(|v| v as f32));
}

#[test]
fn foreign_stamp_is_not_read_as_image() {
    assert_eq!(read_annotations(&fixtures::pdf_with_foreign_stamps()).unwrap(), vec![]);
}

#[test]
fn stamp_without_png_stream_is_not_read_as_image() {
    let mut doc = Document::load_mem(&fixtures::simple_pdf(1)).unwrap();
    let page = doc.page_iter().next().unwrap();
    let stamp = doc.add_object(dictionary! {
        "Type" => "Annot", "Subtype" => "Stamp",
        "Rect" => vec![1.into(), 1.into(), 50.into(), 50.into()],
        "JuliePDF" => dictionary! { "v" => 1, "kind" => "image", "png" => 3 },
    });
    doc.get_dictionary_mut(page).unwrap().set("Annots", vec![Object::Reference(stamp)]);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    assert_eq!(read_annotations(&out).unwrap(), vec![]);
}

#[test]
fn image_move_after_save_keeps_object() {
    let orig = fixtures::simple_pdf(1);
    let bytes = png(4, 4, Some(100));
    let (out1, refs1) = write(&orig, &[image("i", RECT, &bytes, 4, 4)]).unwrap();
    let doc1 = Document::load_mem(&out1).unwrap();
    let (im1, _) = image_xobject(&doc1, doc1.get_dictionary(id_of(&refs1["i"])).unwrap());

    let moved = with_ref(image("i", [10.0, 20.0, 159.5, 120.25], &bytes, 4, 4), &refs1["i"]);
    let (out2, refs2) = write(&out1, std::slice::from_ref(&moved)).unwrap();
    assert_eq!(refs2["i"], refs1["i"]);
    assert_eq!(read_annotations(&out2).unwrap(), vec![moved]);
    // The image data is not written again: the same image XObject, and the
    // update adds no image streams.
    let doc2 = Document::load_mem(&out2).unwrap();
    let (im2, _) = image_xobject(&doc2, doc2.get_dictionary(id_of(&refs2["i"])).unwrap());
    assert_eq!(im2, im1);
    let tail = String::from_utf8_lossy(&out2[out1.len()..]).into_owned();
    assert!(!tail.contains("/Subtype /Image") && !tail.contains("/Subtype/Image"), "{tail}");
    assert!(!tail.contains("IHDR"), "PNG written again");
}

#[test]
fn image_with_new_pixels_after_save_writes_new_data() {
    let orig = fixtures::simple_pdf(1);
    let (out1, refs1) = write(&orig, &[image("i", RECT, &png(2, 2, None), 2, 2)]).unwrap();
    let edited = with_ref(image("i", RECT, &png(3, 1, None), 3, 1), &refs1["i"]);
    let (out2, refs2) = write(&out1, std::slice::from_ref(&edited)).unwrap();
    assert_eq!(read_annotations(&out2).unwrap(), vec![edited]);
    let doc = Document::load_mem(&out2).unwrap();
    let (_, im) = image_xobject(&doc, doc.get_dictionary(id_of(&refs2["i"])).unwrap());
    assert_eq!(im.dict.get(b"Width").unwrap().as_i64().unwrap(), 3);
}

#[test]
fn invalid_image_is_an_error() {
    let orig = fixtures::simple_pdf(1);
    let mut bad_b64 = image("i", RECT, &png(2, 2, None), 2, 2);
    if let AnnotationDto::Image { image, .. } = &mut bad_b64 {
        image.png = "not base64!".into();
    }
    assert!(matches!(write(&orig, &[bad_b64]), Err(AppError::InvalidPdf(_))));
    let not_png = image("i", RECT, b"GIF89a....", 2, 2);
    assert!(matches!(write(&orig, &[not_png]), Err(AppError::InvalidPdf(_))));
    let zero = image("i", [10.0, 10.0, 10.0, 50.0], &png(2, 2, None), 2, 2);
    assert!(matches!(write(&orig, &[zero]), Err(AppError::InvalidPdf(_))));
    let nan = image("i", [f64::NAN, 10.0, 20.0, 50.0], &png(2, 2, None), 2, 2);
    assert!(matches!(write(&orig, &[nan]), Err(AppError::InvalidPdf(_))));
}

#[test]
fn turned_image_roundtrip() {
    let orig = fixtures::simple_pdf(1);
    let mut a = image("i", RECT, &png(3, 2, None), 3, 2);
    if let AnnotationDto::Image { rotation, .. } = &mut a {
        *rotation = 90.0;
    }
    let (out, refs) = write(&orig, std::slice::from_ref(&a)).unwrap();
    assert_eq!(read_annotations(&out).unwrap(), vec![with_ref(a, &refs["i"])]);
    let doc = Document::load_mem(&out).unwrap();
    let annot = doc.get_dictionary(id_of(&refs["i"])).unwrap();
    let matrix = floats(ap_stream(&doc, annot).dict.get(b"Matrix").unwrap());
    let rounded: Vec<f32> = matrix[..4].iter().map(|v| v.round()).collect();
    assert_eq!(rounded, [0.0, 1.0, -1.0, 0.0]);
    let private = annot.get(b"JuliePDF").unwrap().as_dict().unwrap();
    assert_eq!(floats(private.get(b"rect").unwrap()), RECT.map(|v| v as f32));
    // A quarter turn swaps the box's width and height around its centre.
    let r = floats(annot.get(b"Rect").unwrap());
    let (w, h) = (RECT[2] - RECT[0], RECT[3] - RECT[1]);
    assert!(((r[2] - r[0]) as f64 - h).abs() < 1e-3 && ((r[3] - r[1]) as f64 - w).abs() < 1e-3, "{r:?}");
}

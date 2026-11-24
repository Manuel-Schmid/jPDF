// Saving pipeline: annotation DTOs, appearance streams, the incremental writer
// and the annotation reader.
pub mod appearance;
mod date;
pub mod dto;
pub mod explanations;
pub mod export;
pub mod fmt;
pub mod image;
pub mod merge;
pub mod reader;
pub mod winansi;
pub mod writer;

use std::collections::{HashMap, HashSet};

use lopdf::{Dictionary, Document, Object, ObjectId, decode_text_string};

use crate::error::AppError;

/// Loads a PDF, mapping encryption to `Encrypted` and anything unparseable to `InvalidPdf`.
/// Documents that open with the empty user password still count as encrypted: an
/// incremental update would have to re-encrypt, which this app does not do.
pub(crate) fn load_document(bytes: &[u8]) -> Result<Document, AppError> {
    match Document::load_mem(bytes) {
        Ok(doc) if doc.was_encrypted() || doc.is_encrypted() => {
            Err(AppError::Encrypted("the PDF is encrypted".into()))
        }
        Ok(doc) => Ok(doc),
        Err(
            lopdf::Error::Decryption(_)
            | lopdf::Error::InvalidPassword
            | lopdf::Error::UnsupportedSecurityHandler(_)
            | lopdf::Error::AlreadyEncrypted,
        ) => Err(AppError::Encrypted("the PDF is encrypted".into())),
        Err(e) => Err(AppError::InvalidPdf(e.to_string())),
    }
}

/// pdf.js annotation id format: `"12R"` for generation 0, `"12R3"` otherwise.
pub(crate) fn format_source_ref((num, generation): ObjectId) -> String {
    if generation == 0 { format!("{num}R") } else { format!("{num}R{generation}") }
}

pub(crate) fn parse_source_ref(s: &str) -> Option<ObjectId> {
    let (num, generation) = s.split_once('R')?;
    let num: u32 = num.parse().ok()?;
    let generation: u16 = if generation.is_empty() { 0 } else { generation.parse().ok()? };
    (num > 0).then_some((num, generation))
}

/// Annotation objects in reading order as `(page index, object id)`: each
/// page's `/Annots` references, an object listed more than once (twice in one
/// array, or on several pages) only the first time. Inline dictionaries are
/// skipped (they cannot be addressed by ref).
pub(crate) fn annotation_refs(doc: &Document) -> Vec<(usize, ObjectId)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (index, page_id) in doc.page_iter().enumerate() {
        let Ok(page) = doc.get_dictionary(page_id) else {
            continue;
        };
        let Ok(annots) = page.get_deref(b"Annots", doc).and_then(Object::as_array) else {
            continue;
        };
        for id in annots.iter().filter_map(|o| o.as_reference().ok()) {
            if seen.insert(id) {
                out.push((index, id));
            }
        }
    }
    out
}

/// An annotation's non-empty `/NM`.
pub(crate) fn annotation_nm(doc: &Document, d: &Dictionary) -> Option<String> {
    let o = d.get(b"NM").ok()?;
    let o = doc.dereference(o).map(|(_, o)| o).unwrap_or(o);
    decode_text_string(o).ok().filter(|s| !s.is_empty())
}

/// For every `/NM`, the first annotation object (in `annotation_refs` order)
/// carrying it. Later carriers of the same `/NM` are read with a fresh id.
pub(crate) fn nm_owners(doc: &Document) -> HashMap<String, ObjectId> {
    let mut owners = HashMap::new();
    for (_, id) in annotation_refs(doc) {
        if let Some(nm) = doc.get_dictionary(id).ok().and_then(|d| annotation_nm(doc, d)) {
            owners.entry(nm).or_insert(id);
        }
    }
    owners
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_ref_roundtrip() {
        assert_eq!(format_source_ref((12, 0)), "12R");
        assert_eq!(format_source_ref((12, 3)), "12R3");
        assert_eq!(parse_source_ref("12R"), Some((12, 0)));
        assert_eq!(parse_source_ref("12R3"), Some((12, 3)));
        for bad in ["", "R", "12", "x12R", "12R-1", "0R", "12Rx", "12 0 R"] {
            assert_eq!(parse_source_ref(bad), None, "{bad}");
        }
    }

    #[test]
    fn garbage_is_invalid_pdf() {
        assert!(matches!(load_document(b"not a pdf"), Err(AppError::InvalidPdf(_))));
    }
}

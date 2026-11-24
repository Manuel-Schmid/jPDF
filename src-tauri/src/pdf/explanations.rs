//! Page explanations, stored as JuliePDF page-piece data (ISO 32000-1 §14.5),
//! the standard place for an application's private page data:
//!
//! ```text
//! /PieceInfo << /JuliePDF << /LastModified (D:…) /Private <stream> >> >>
//! ```
//!
//! `/Private` is a (Flate-compressed) stream of UTF-8 JSON, e.g.
//! `{ "version": 1, "text": "…", "model": "gemini-…", "createdAt": "…" }`.
//! Viewers ignore page-piece data: nothing is drawn and nothing shows in
//! comment lists. Other applications' `/PieceInfo` entries are kept as they are.
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};

use super::dto::ExplanationDto;

/// Key of JuliePDF's data dictionary in a page's `/PieceInfo`.
pub const PIECE_KEY: &[u8] = b"JuliePDF";

/// Version written into the JSON; readers accept any version that has `text`.
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    #[serde(default)]
    version: u32,
    text: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    created_at: String,
}

/// The JSON stored in the `/Private` stream for `e`.
pub fn encode(e: &ExplanationDto) -> Vec<u8> {
    let stored = Stored {
        version: VERSION,
        text: e.text.clone(),
        model: e.model.clone(),
        created_at: e.created_at.clone(),
    };
    serde_json::to_vec(&stored).expect("strings always serialize")
}

/// The explanation in a `/Private` stream's JSON; `None` if it is not one.
pub fn parse(bytes: &[u8]) -> Option<ExplanationDto> {
    let s: Stored = serde_json::from_slice(bytes).ok()?;
    Some(ExplanationDto { text: s.text, model: s.model, created_at: s.created_at })
}

/// `o`, or the object it refers to (looked up with `get`).
fn resolve<'a>(get: &impl Fn(ObjectId) -> Option<&'a Object>, o: &'a Object) -> Option<&'a Object> {
    match o {
        Object::Reference(id) => get(*id),
        o => Some(o),
    }
}

/// The explanation stored on a page dictionary, with `get` looking up
/// indirect objects (the writer resolves them in the document as it will be
/// saved). `None` when the page has none or it cannot be read.
pub(crate) fn decode<'a>(get: &impl Fn(ObjectId) -> Option<&'a Object>, page: &'a Dictionary) -> Option<ExplanationDto> {
    let piece = resolve(get, page.get(b"PieceInfo").ok()?)?.as_dict().ok()?;
    let data = resolve(get, piece.get(PIECE_KEY).ok()?)?.as_dict().ok()?;
    let stream = resolve(get, data.get(b"Private").ok()?)?.as_stream().ok()?;
    parse(&stream.get_plain_content().ok()?)
}

/// One slot per page, in page order: the page's explanation or `None`.
pub fn read_explanations(doc: &Document) -> Vec<Option<ExplanationDto>> {
    let get = |id: ObjectId| doc.objects.get(&id);
    doc.page_iter()
        .map(|id| doc.get_dictionary(id).ok().and_then(|page| decode(&get, page)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_parse_roundtrip() {
        let e = ExplanationDto { text: "Ä \"quoted\"\nline".into(), model: Some("m".into()), created_at: "t".into() };
        let bytes = encode(&e);
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(parse(&bytes), Some(e));
    }

    #[test]
    fn parse_rejects_other_data() {
        assert_eq!(parse(b"not json"), None);
        assert_eq!(parse(br#"{"version":1}"#), None);
        // A later version with extra fields still yields its text.
        let later = parse(br#"{"version":7,"text":"x","extra":[1]}"#).unwrap();
        assert_eq!(later.text, "x");
    }
}

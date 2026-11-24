//! Page pictures for one explanation run: decoding what the frontend sent
//! and handing it to the CLI. Claude Code takes pictures inline on stdin
//! (one stream-json user message); Codex reads files named by `--image`.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::json;

use crate::error::AppError;

/// More pictures than this in one request are refused (the frontend chunks
/// far below it; this only guards the backend).
pub const MAX_PICTURES: usize = 60;
/// Ceiling for all decoded pictures of one request together.
pub const MAX_PICTURE_BYTES: usize = 40 * 1024 * 1024;

/// One rendered page as sent by the frontend (`data` is base64).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageImage {
    pub page: u32,
    pub media_type: String,
    pub data: String,
}

fn too_many() -> AppError {
    AppError::AiCli("Too many page pictures in one request.".into())
}

fn unreadable() -> AppError {
    AppError::AiCli("A page picture could not be read.".into())
}

/// Decodes every picture, in order. Checks the count first and the running
/// size while decoding, so an oversized request is refused without
/// materialising all of it.
pub fn decode_all(images: &[PageImage]) -> Result<Vec<(u32, Vec<u8>)>, AppError> {
    if images.len() > MAX_PICTURES {
        return Err(too_many());
    }
    let mut total = 0usize;
    let mut out = Vec::with_capacity(images.len());
    for image in images {
        // The media type goes into the Claude message as is: only the two
        // formats the frontend can produce are let through.
        if !matches!(image.media_type.as_str(), "image/jpeg" | "image/png") {
            return Err(unreadable());
        }
        // A base64 string decodes to at most 3/4 of its length: refuse by
        // size before allocating the bytes.
        total = total.saturating_add(image.data.len() / 4 * 3);
        if total > MAX_PICTURE_BYTES + 3 * images.len() {
            return Err(too_many());
        }
        let bytes = STANDARD
            .decode(&image.data)
            .map_err(|_| unreadable())?;
        out.push((image.page, bytes));
    }
    let exact: usize = out.iter().map(|(_, b)| b.len()).sum();
    if exact > MAX_PICTURE_BYTES {
        return Err(too_many());
    }
    Ok(out)
}

/// The file name Codex finds a page picture under (in the run's temp dir).
pub fn file_name(page: u32) -> String {
    format!("page-{page}.jpg")
}

/// The single stdin line for Claude Code's `--input-format stream-json`: the
/// prompt, then each picture introduced by a caption naming its page. Built
/// with serde_json, so the prompt's quotes and newlines are escaped.
pub fn claude_input(user: &str, images: &[PageImage]) -> String {
    let mut content = vec![json!({ "type": "text", "text": user })];
    for image in images {
        content.push(json!({ "type": "text", "text": format!("Picture of page {}:", image.page) }));
        content.push(json!({
            "type": "image",
            "source": { "type": "base64", "media_type": image.media_type, "data": image.data }
        }));
    }
    let message = json!({ "type": "user", "message": { "role": "user", "content": content } });
    format!("{message}\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(page: u32, bytes: &[u8]) -> PageImage {
        PageImage { page, media_type: "image/jpeg".into(), data: STANDARD.encode(bytes) }
    }

    fn fails_with(r: Result<Vec<(u32, Vec<u8>)>, AppError>, text: &str) {
        match r {
            Err(AppError::AiCli(m)) => assert_eq!(m, text),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn claude_input_shape() {
        let line = claude_input("Explain \"this\"\nplease", &[image(3, b"abc")]);
        assert!(line.ends_with('\n') && line.matches('\n').count() == 1);
        let v: serde_json::Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["role"], "user");
        let c = &v["message"]["content"];
        assert_eq!(c[0], json!({ "type": "text", "text": "Explain \"this\"\nplease" }));
        assert_eq!(c[1], json!({ "type": "text", "text": "Picture of page 3:" }));
        assert_eq!(c[2]["type"], "image");
        assert_eq!(c[2]["source"]["type"], "base64");
        assert_eq!(c[2]["source"]["media_type"], "image/jpeg");
        assert_eq!(c[2]["source"]["data"], STANDARD.encode(b"abc"));
        assert_eq!(c.as_array().unwrap().len(), 3);
    }

    #[test]
    fn claude_input_without_pictures_is_just_the_prompt() {
        let v: serde_json::Value = serde_json::from_str(claude_input("hi", &[]).trim_end()).unwrap();
        assert_eq!(v["message"]["content"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn decodes_in_order() {
        let r = decode_all(&[image(2, b"one"), image(5, b"two")]).unwrap();
        assert_eq!(r, vec![(2, b"one".to_vec()), (5, b"two".to_vec())]);
        assert_eq!(file_name(2), "page-2.jpg");
    }

    #[test]
    fn too_many_pictures_rejected() {
        let images: Vec<PageImage> = (0..=MAX_PICTURES as u32).map(|p| image(p, b"x")).collect();
        assert_eq!(images.len(), 61);
        fails_with(decode_all(&images), "Too many page pictures in one request.");
        assert!(decode_all(&images[..MAX_PICTURES]).is_ok());
    }

    #[test]
    fn oversized_pictures_rejected() {
        let big = vec![0u8; MAX_PICTURE_BYTES / 2 + 1];
        fails_with(decode_all(&[image(1, &big), image(2, &big)]), "Too many page pictures in one request.");
    }

    #[test]
    fn only_jpeg_and_png_accepted() {
        let mut img = image(1, b"x");
        img.media_type = "image/png".into();
        assert!(decode_all(&[img.clone()]).is_ok());
        for t in ["image/gif", "text/html", ""] {
            img.media_type = t.into();
            fails_with(decode_all(&[img.clone()]), "A page picture could not be read.");
        }
    }

    #[test]
    fn bad_base64_rejected() {
        let bad = PageImage { page: 1, media_type: "image/jpeg".into(), data: "!!not base64!!".into() };
        fails_with(decode_all(&[bad]), "A page picture could not be read.");
    }
}

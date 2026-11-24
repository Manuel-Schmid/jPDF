//! Parsing an OpenAI-compatible streamed chat completion (server-sent
//! events) into the lines of the model's answer. Pure, so it is tested
//! without a network: the client feeds it the response body as it arrives.
use serde_json::Value;

use crate::error::AppError;

/// What one `data:` event of the stream carried.
#[derive(Debug, PartialEq)]
pub enum Event {
    /// A piece of the answer text.
    Content(String),
    /// The answer ended; `truncated` when the model hit its output limit.
    Finished { truncated: bool },
}

/// Splits the event stream into `data:` events. Bytes may arrive cut
/// anywhere (also inside a UTF-8 character or a line).
#[derive(Default)]
pub struct SseParser {
    pending: Vec<u8>,
}

impl SseParser {
    /// The events completed by `chunk`, in order.
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<Event>, AppError> {
        self.pending.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(end) = self.pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line);
            out.extend(parse_line(line.trim_end_matches(['\r', '\n']))?);
        }
        Ok(out)
    }

    /// Events of a last line that had no line break.
    pub fn finish(&mut self) -> Result<Vec<Event>, AppError> {
        let rest = String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned();
        Ok(parse_line(rest.trim())?.into_iter().collect())
    }
}

/// One SSE line: `data: {…}` carries a chunk, `data: [DONE]` ends the
/// stream; comments (`: …`), other fields and blank lines carry nothing.
fn parse_line(line: &str) -> Result<Option<Event>, AppError> {
    let Some(data) = line.strip_prefix("data:") else {
        return Ok(None);
    };
    let data = data.trim();
    if data.is_empty() {
        return Ok(None);
    }
    if data == "[DONE]" {
        return Ok(Some(Event::Finished { truncated: false }));
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        // A malformed event is skipped; the answer lines are checked later.
        return Ok(None);
    };
    if let Some(err) = v.get("error") {
        return Err(AppError::AiService(error_message(err)));
    }
    let choice = &v["choices"][0];
    if let Some(text) = choice["delta"]["content"].as_str()
        && !text.is_empty()
    {
        return Ok(Some(Event::Content(text.to_owned())));
    }
    match choice["finish_reason"].as_str() {
        Some("length") => Ok(Some(Event::Finished { truncated: true })),
        Some(_) => Ok(Some(Event::Finished { truncated: false })),
        None => Ok(None),
    }
}

/// The message of an API error object (`{"message": …}`, or a string).
pub fn error_message(err: &Value) -> String {
    err.get("message")
        .and_then(Value::as_str)
        .or_else(|| err.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| err.to_string())
}

/// Cuts the answer text into complete lines (the model writes one JSON
/// object per line); a line is handed out once its line break arrived.
#[derive(Default)]
pub struct LineSplitter {
    pending: String,
}

impl LineSplitter {
    /// The non-blank lines completed by `text`.
    pub fn feed(&mut self, text: &str) -> Vec<String> {
        self.pending.push_str(text);
        let mut out = Vec::new();
        while let Some(end) = self.pending.find('\n') {
            let line: String = self.pending.drain(..=end).collect();
            let line = line.trim();
            if !line.is_empty() {
                out.push(line.to_owned());
            }
        }
        out
    }

    /// The last line, if the answer did not end with a line break.
    pub fn finish(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.pending);
        let rest = rest.trim();
        (!rest.is_empty()).then(|| rest.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(s: &str) -> Event {
        Event::Content(s.into())
    }

    #[test]
    fn parses_chunks_cut_anywhere() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hä\"}}]}\r\n\r\n: keep-alive\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        // Byte by byte: lines and the two-byte 'ä' are cut in every place.
        let mut p = SseParser::default();
        let mut events = Vec::new();
        for b in body.as_bytes() {
            events.extend(p.feed(&[*b]).unwrap());
        }
        events.extend(p.finish().unwrap());
        assert_eq!(
            events,
            vec![
                content("Hä"),
                content("llo"),
                Event::Finished { truncated: false },
                Event::Finished { truncated: false },
            ]
        );
    }

    #[test]
    fn length_finish_is_truncated() {
        let mut p = SseParser::default();
        let e = p.feed(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n").unwrap();
        assert_eq!(e, vec![Event::Finished { truncated: true }]);
    }

    #[test]
    fn error_events_fail_and_garbage_is_skipped() {
        let mut p = SseParser::default();
        assert_eq!(p.feed(b"data: {not json\nevent: ping\n").unwrap(), vec![]);
        let err = p.feed(b"data: {\"error\":{\"message\":\"quota exceeded\"}}\n").unwrap_err();
        assert!(matches!(err, AppError::AiService(m) if m == "quota exceeded"));
    }

    #[test]
    fn last_line_without_break_is_parsed() {
        let mut p = SseParser::default();
        assert_eq!(p.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}").unwrap(), vec![]);
        assert_eq!(p.finish().unwrap(), vec![content("x")]);
    }

    #[test]
    fn splits_answer_into_lines() {
        let mut s = LineSplitter::default();
        assert_eq!(s.feed("{\"page\": 1, \"te"), Vec::<String>::new());
        assert_eq!(s.feed("xt\": \"a\"}\n\n{\"page\""), vec![r#"{"page": 1, "text": "a"}"#]);
        assert_eq!(s.feed(": 2}\r\n"), vec![r#"{"page": 2}"#]);
        assert_eq!(s.feed("tail"), Vec::<String>::new());
        assert_eq!(s.finish(), Some("tail".into()));
        assert_eq!(s.finish(), None);
    }
}

//! A generic OpenAI-compatible chat client (Gemini, OpenAI, Groq,
//! OpenRouter, Mistral and custom endpoints all speak it). The HTTP client is
//! created on first use, never at startup.
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};

use super::stream::{Event, LineSplitter, SseParser, error_message};
use crate::error::AppError;

/// Where and with which model to generate (from the AI settings).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// Provider preset id; names the stored API key.
    pub provider: String,
    /// OpenAI-compatible base URL, e.g. `https://api.groq.com/openai/v1`.
    pub base_url: String,
    pub model: String,
}

/// How a generation ended (an error is returned as `Err` instead).
#[derive(Debug, PartialEq, Eq, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Done,
    /// The model hit its output limit: later pages are missing.
    Truncated,
    Cancelled,
}

fn client() -> Result<&'static reqwest::Client, AppError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let c = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        // Thinking models may pause a while before the first token.
        .read_timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| AppError::AiNetwork(e.to_string()))?;
    Ok(CLIENT.get_or_init(|| c))
}

/// `base` + `/path`, with exactly one slash between them.
pub fn endpoint(base: &str, path: &str) -> Result<String, AppError> {
    let base = base.trim().trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://")) {
        return Err(AppError::AiService(format!("invalid base URL {base:?}")));
    }
    Ok(format!("{base}/{path}"))
}

fn network_error(e: reqwest::Error) -> AppError {
    AppError::AiNetwork(e.to_string())
}

/// Maps an unsuccessful HTTP status (and the body's error message) to an error.
pub fn status_error(status: u16, body: &str) -> AppError {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .map(|v| match v {
            // Some providers answer with a list of error objects.
            Value::Array(a) => a.into_iter().next().unwrap_or(Value::Null),
            v => v,
        })
        .and_then(|v| v.get("error").map(error_message))
        .unwrap_or_else(|| body.chars().take(300).collect());
    let detail = if detail.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {detail}") };
    match status {
        401 | 403 => AppError::AiKey(detail),
        429 => AppError::AiRateLimit(detail),
        502..=504 => AppError::AiUnavailable(detail),
        _ => AppError::AiService(detail),
    }
}

async fn check(resp: reqwest::Response) -> Result<reqwest::Response, AppError> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Err(status_error(status, &body))
}

/// Checks the key: lists the endpoint's models (costs no generation quota).
pub async fn test_key(config: &AiConfig, key: &str) -> Result<(), AppError> {
    let resp = client()?
        .get(endpoint(&config.base_url, "models")?)
        .bearer_auth(key)
        .send()
        .await
        .map_err(network_error)?;
    check(resp).await.map(|_| ())
}

/// Streams one chat completion and hands every complete line of the answer
/// to `on_line` as it arrives. Lines that arrived stay delivered when the
/// stream breaks (the error is returned afterwards).
pub async fn stream_chat(
    config: &AiConfig,
    key: &str,
    system: &str,
    user: &str,
    mut on_line: impl FnMut(String),
) -> Result<Outcome, AppError> {
    let body = json!({
        "model": config.model,
        "stream": true,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });
    let resp = client()?
        .post(endpoint(&config.base_url, "chat/completions")?)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(network_error)?;
    let resp = check(resp).await?;
    let mut sse = SseParser::default();
    let mut lines = LineSplitter::default();
    let mut outcome = Outcome::Done;
    let mut body = resp.bytes_stream();
    let mut handle = |events: Vec<Event>, lines: &mut LineSplitter, outcome: &mut Outcome| {
        for e in events {
            match e {
                Event::Content(text) => lines.feed(&text).into_iter().for_each(&mut on_line),
                Event::Finished { truncated: true } => *outcome = Outcome::Truncated,
                Event::Finished { truncated: false } => {}
            }
        }
    };
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(network_error)?;
        handle(sse.feed(&chunk)?, &mut lines, &mut outcome);
    }
    handle(sse.finish()?, &mut lines, &mut outcome);
    if let Some(last) = lines.finish() {
        on_line(last);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_join_with_one_slash() {
        assert_eq!(endpoint("https://a.b/v1/", "models").unwrap(), "https://a.b/v1/models");
        assert_eq!(endpoint(" https://a.b/v1 ", "chat/completions").unwrap(), "https://a.b/v1/chat/completions");
        assert!(endpoint("ftp://x", "models").is_err());
        assert!(endpoint("", "models").is_err());
    }

    #[test]
    fn statuses_map_to_error_kinds() {
        let e = status_error(401, r#"{"error":{"message":"Incorrect API key"}}"#);
        assert!(matches!(e, AppError::AiKey(m) if m == "HTTP 401: Incorrect API key"));
        let e = status_error(429, r#"[{"error":{"code":429,"message":"Quota exceeded"}}]"#);
        assert!(matches!(e, AppError::AiRateLimit(m) if m.contains("Quota exceeded")));
        let e = status_error(503, r#"{"error":{"message":"The model is overloaded. Please try again later."}}"#);
        assert!(matches!(e, AppError::AiUnavailable(m) if m.contains("overloaded")));
        let e = status_error(500, "");
        assert!(matches!(e, AppError::AiService(m) if m == "HTTP 500"));
        let e = status_error(404, "model not found");
        assert!(matches!(e, AppError::AiService(m) if m == "HTTP 404: model not found"));
    }
}

use serde::Serialize;

#[derive(Debug, Serialize, thiserror::Error)]
#[serde(tag = "code", content = "message")]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("locked: {0}")]
    Locked(String),
    #[error("read-only: {0}")]
    ReadOnly(String),
    #[error("encrypted: {0}")]
    Encrypted(String),
    #[error("invalid PDF: {0}")]
    InvalidPdf(String),
    #[error("io error: {0}")]
    Io(String),
    /// AI: no API key, or the provider rejected it.
    #[error("API key: {0}")]
    AiKey(String),
    /// AI: the provider's rate limit or free-tier quota was reached.
    #[error("rate limit: {0}")]
    AiRateLimit(String),
    /// AI: the provider could not be reached or the connection broke.
    #[error("network: {0}")]
    AiNetwork(String),
    /// AI: the provider is overloaded or briefly down (HTTP 502, 503, 504); worth retrying soon.
    #[error("unavailable: {0}")]
    AiUnavailable(String),
    /// AI: any other error the provider reported (bad model, server error …).
    #[error("AI service: {0}")]
    AiService(String),
}

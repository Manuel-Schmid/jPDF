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
    #[error("AI CLI: {0}")]
    AiCli(String),
}

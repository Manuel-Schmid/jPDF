//! AI explanations (Beta): the API-key generator's backend. The frontend
//! builds the prompt and parses the answer lines; this module only stores
//! keys and streams the request. Nothing here runs unless the user turned AI
//! features on and asked for it: no client, key access or task at startup.
pub mod client;
pub mod keys;
pub mod stream;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::Notify;

use client::{AiConfig, Outcome};
use crate::error::AppError;

/// Running generations by request id, for cancelling. A cancel that comes
/// before its generation registered leaves a stored notification, so it is
/// not lost.
#[derive(Default)]
pub struct AiRequests(Mutex<HashMap<u32, Arc<Notify>>>);

impl AiRequests {
    fn signal(&self, id: u32) -> Arc<Notify> {
        self.0.lock().unwrap().entry(id).or_default().clone()
    }

    fn forget(&self, id: u32) {
        self.0.lock().unwrap().remove(&id);
    }
}

fn require_key(provider: &str) -> Result<String, AppError> {
    keys::get_key(provider)?.ok_or_else(|| AppError::AiKey("no API key is set".into()))
}

#[tauri::command]
pub async fn ai_set_key(provider: String, key: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || keys::set_key(&provider, &key))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn ai_has_key(provider: String) -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(move || keys::get_key(&provider).map(|k| k.is_some()))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

/// Checks the stored key against the endpoint.
#[tauri::command]
pub async fn ai_test(config: AiConfig) -> Result<(), AppError> {
    let key = require_key(&config.provider)?;
    client::test_key(&config, &key).await
}

/// Streams one generation; every complete answer line goes to `on_line`.
/// Resolves when the answer ended, was cut off or `ai_cancel` stopped it.
#[tauri::command]
pub async fn ai_generate(
    requests: State<'_, AiRequests>,
    request_id: u32,
    config: AiConfig,
    system: String,
    user: String,
    on_line: Channel<String>,
) -> Result<Outcome, AppError> {
    let cancel = requests.signal(request_id);
    let run = async {
        let key = require_key(&config.provider)?;
        client::stream_chat(&config, &key, &system, &user, |line| {
            // The window may be gone; the generation then just runs out.
            let _ = on_line.send(line);
        })
        .await
    };
    let result = tokio::select! {
        _ = cancel.notified() => Ok(Outcome::Cancelled),
        r = run => r,
    };
    requests.forget(request_id);
    result
}

#[tauri::command]
pub fn ai_cancel(requests: State<'_, AiRequests>, request_id: u32) {
    requests.signal(request_id).notify_one();
}

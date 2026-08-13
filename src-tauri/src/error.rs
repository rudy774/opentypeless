use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Emitter;

/// Structured error sent to the frontend via Tauri events.
/// The frontend uses `code` to look up an i18n-translated message.
#[derive(Debug, Clone, Serialize)]
pub struct UserError {
    pub code: String,
    pub details: Option<String>,
    pub retry_count: u32,
}

/// Internal error type used throughout the Rust backend.
/// Provides `is_retryable()` for retry logic and `to_user_error()` for frontend display.
#[derive(Debug)]
pub enum AppError {
    Network(String),
    Timeout(Duration),
    Api { status: u16, body: String },
    Auth(String),
    Quota(String),
    LlmQuota(String),
    Output(String),
    Config(String),
    CloudSessionInvalid,
}

const CLOUD_SESSION_INVALID_EVENT: &str = "auth:session-invalid";

#[derive(Debug, Deserialize)]
struct ManagedCloudErrorEnvelope {
    error: ManagedCloudErrorBody,
}

#[derive(Debug, Deserialize)]
struct ManagedCloudErrorBody {
    code: String,
}

pub fn managed_cloud_error(status: u16, body: &str) -> Option<AppError> {
    if status != 401 {
        return None;
    }
    let envelope = serde_json::from_str::<ManagedCloudErrorEnvelope>(body).ok()?;
    (envelope.error.code == "AUTH_SESSION_INVALID").then_some(AppError::CloudSessionInvalid)
}

pub fn notify_cloud_session_invalid<F>(error: &AppError, notify: F) -> bool
where
    F: FnOnce(&'static str),
{
    if !matches!(error, AppError::CloudSessionInvalid) {
        return false;
    }
    notify(CLOUD_SESSION_INVALID_EVENT);
    true
}

pub fn emit_cloud_session_invalid(app_handle: &tauri::AppHandle, error: &AppError) -> bool {
    notify_cloud_session_invalid(error, |event| {
        let _ = app_handle.emit(event, ());
    })
}

impl AppError {
    pub fn is_retryable(&self) -> bool {
        match self {
            AppError::Network(_) => true,
            AppError::Timeout(_) => true,
            AppError::Api { status, .. } => *status >= 500,
            AppError::Auth(_) => false,
            AppError::Quota(_) => false,
            AppError::LlmQuota(_) => false,
            AppError::Output(_) => false,
            AppError::Config(_) => false,
            AppError::CloudSessionInvalid => false,
        }
    }

    pub fn to_user_error(&self) -> UserError {
        let (code, details) = match self {
            // Network libraries commonly include the full request URL in their
            // error text. Do not send that text across the Tauri boundary: a
            // custom provider URL may contain userinfo, query credentials, or
            // other sensitive request metadata.
            AppError::Network(_) => ("stt_timeout".to_string(), None),
            AppError::Timeout(_) => ("stt_timeout".to_string(), None),
            AppError::Api { status, body: _ } => {
                if *status == 401 || *status == 403 {
                    ("stt_invalid_key".to_string(), None)
                } else {
                    ("stt_failed".to_string(), Some(format!("HTTP {}", status)))
                }
            }
            AppError::Auth(msg) => ("stt_invalid_key".to_string(), Some(msg.clone())),
            AppError::Quota(msg) => ("stt_quota_exceeded".to_string(), Some(msg.clone())),
            AppError::LlmQuota(msg) => ("llm_quota_exceeded".to_string(), Some(msg.clone())),
            AppError::Output(msg) => ("output_fallback_clipboard".to_string(), Some(msg.clone())),
            AppError::Config(msg) => ("stt_failed".to_string(), Some(msg.clone())),
            AppError::CloudSessionInvalid => ("stt_failed".to_string(), None),
        };
        UserError {
            code,
            details,
            retry_count: 0,
        }
    }

    pub fn with_retry_count(self, count: u32) -> UserError {
        let mut ue = self.to_user_error();
        ue.retry_count = count;
        ue
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Keep Display safe because it is reused by retry events, logs, and
            // persisted failure descriptions throughout the pipeline.
            AppError::Network(_) => write!(f, "Network request failed"),
            AppError::Timeout(d) => write!(f, "Timeout after {:.1}s", d.as_secs_f64()),
            AppError::Api { status, .. } => write!(f, "API error {}", status),
            AppError::Auth(_) => write!(f, "Authentication failed"),
            AppError::Quota(_) => write!(f, "Speech quota exceeded"),
            AppError::LlmQuota(_) => write!(f, "LLM quota exceeded"),
            AppError::Output(msg) => write!(f, "Output error: {}", msg),
            AppError::Config(msg) => write!(f, "Config error: {}", msg),
            AppError::CloudSessionInvalid => write!(f, "Managed cloud session is invalid"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            AppError::Timeout(Duration::from_secs(30))
        } else if let Some(status) = e.status() {
            AppError::Api {
                status: status.as_u16(),
                // A reqwest error can retain the request URL. The response body
                // is not available here, so retaining Display text adds no
                // managed-error parsing value and can leak URL credentials.
                body: String::new(),
            }
        } else {
            // Never retain reqwest's Display text: it can include the complete
            // request URL, including userinfo and query parameters.
            AppError::Network("request failed".to_string())
        }
    }
}

/// Retry an async operation with exponential backoff.
///
/// - `max_retries`: number of retries (0 = no retry)
/// - `f`: closure returning a Future that produces Result<T, AppError>
///
/// Emits a `pipeline:retry` event on each retry attempt.
pub async fn with_retry<F, Fut, T>(
    app_handle: &tauri::AppHandle,
    max_retries: u32,
    f: F,
) -> Result<T, AppError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    let mut last_error: Option<AppError> = None;
    for attempt in 0..=max_retries {
        match f().await {
            Ok(result) => return Ok(result),
            Err(e) if e.is_retryable() && attempt < max_retries => {
                let delay_ms = 1000 * 2u64.pow(attempt);
                tracing::warn!(
                    "Retryable error (attempt {}/{}): {}, retrying in {}ms",
                    attempt + 1,
                    max_retries,
                    e,
                    delay_ms
                );
                let _ = app_handle.emit(
                    "pipeline:retry",
                    serde_json::json!({
                        "attempt": attempt + 1,
                        "max": max_retries,
                        "error": e.to_string(),
                    }),
                );
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                last_error = Some(e);
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_network_error_is_retryable() {
        let err = AppError::Network("connection reset".to_string());
        assert!(err.is_retryable());
    }

    #[test]
    fn test_timeout_is_retryable() {
        let err = AppError::Timeout(Duration::from_secs(30));
        assert!(err.is_retryable());
    }

    #[test]
    fn test_500_is_retryable() {
        let err = AppError::Api {
            status: 500,
            body: "internal error".to_string(),
        };
        assert!(err.is_retryable());
    }

    #[test]
    fn test_503_is_retryable() {
        let err = AppError::Api {
            status: 503,
            body: "service unavailable".to_string(),
        };
        assert!(err.is_retryable());
    }

    #[test]
    fn test_401_is_not_retryable() {
        let err = AppError::Api {
            status: 401,
            body: "unauthorized".to_string(),
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_403_is_not_retryable() {
        let err = AppError::Api {
            status: 403,
            body: "forbidden".to_string(),
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_auth_not_retryable() {
        let err = AppError::Auth("bad key".to_string());
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_output_not_retryable() {
        let err = AppError::Output("enigo failed".to_string());
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_config_not_retryable() {
        let err = AppError::Config("bad config".to_string());
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_quota_is_not_retryable() {
        let err = AppError::Quota("quota exceeded".to_string());
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_quota_maps_to_quota_code() {
        let err = AppError::Quota("quota exceeded".to_string());
        let ue = err.to_user_error();
        assert_eq!(ue.code, "stt_quota_exceeded");
        assert_eq!(ue.details.as_deref(), Some("quota exceeded"));
    }

    #[test]
    fn test_llm_quota_maps_to_llm_quota_code() {
        let err = AppError::LlmQuota("quota exceeded".to_string());
        let ue = err.to_user_error();
        assert_eq!(ue.code, "llm_quota_exceeded");
        assert_eq!(ue.details.as_deref(), Some("quota exceeded"));
    }

    #[test]
    fn test_401_maps_to_invalid_key_code() {
        let err = AppError::Api {
            status: 401,
            body: "".to_string(),
        };
        let ue = err.to_user_error();
        assert_eq!(ue.code, "stt_invalid_key");
    }

    #[test]
    fn cloud_session_invalid_envelope_requires_exact_401_code() {
        let body = r#"{"error":{"code":"AUTH_SESSION_INVALID","message":"Session expired"}}"#;

        assert!(matches!(
            managed_cloud_error(401, body),
            Some(AppError::CloudSessionInvalid)
        ));
        assert!(managed_cloud_error(403, body).is_none());
        assert!(managed_cloud_error(
            401,
            r#"{"error":{"code":"AUTH_REQUIRED","message":"Authentication required"}}"#
        )
        .is_none());
    }

    #[test]
    fn cloud_session_invalid_event_is_emitted_once_per_boundary_call() {
        let mut events = Vec::new();
        let emitted = notify_cloud_session_invalid(&AppError::CloudSessionInvalid, |event| {
            events.push(event.to_string());
        });

        assert!(emitted);
        assert_eq!(events, vec!["auth:session-invalid"]);

        let mut byok_events = Vec::new();
        let byok = AppError::Api {
            status: 401,
            body: "invalid provider key".to_string(),
        };
        assert!(!notify_cloud_session_invalid(&byok, |event| {
            byok_events.push(event.to_string());
        }));
        assert!(byok_events.is_empty());
    }

    #[test]
    fn test_403_maps_to_invalid_key_code() {
        let err = AppError::Api {
            status: 403,
            body: "".to_string(),
        };
        let ue = err.to_user_error();
        assert_eq!(ue.code, "stt_invalid_key");
    }

    #[test]
    fn test_500_maps_to_stt_failed_code() {
        let err = AppError::Api {
            status: 500,
            body: "".to_string(),
        };
        let ue = err.to_user_error();
        assert_eq!(ue.code, "stt_failed");
    }

    #[test]
    fn test_network_maps_to_timeout_code() {
        let err = AppError::Network("timeout".to_string());
        let ue = err.to_user_error();
        assert_eq!(ue.code, "stt_timeout");
        assert_eq!(ue.details, None);
    }

    #[test]
    fn test_timeout_maps_to_timeout_code() {
        let err = AppError::Timeout(Duration::from_secs(10));
        let ue = err.to_user_error();
        assert_eq!(ue.code, "stt_timeout");
    }

    #[test]
    fn test_output_maps_to_fallback_code() {
        let err = AppError::Output("keyboard failed".to_string());
        let ue = err.to_user_error();
        assert_eq!(ue.code, "output_fallback_clipboard");
    }

    #[test]
    fn test_with_retry_count() {
        let err = AppError::Timeout(Duration::from_secs(10));
        let ue = err.with_retry_count(2);
        assert_eq!(ue.retry_count, 2);
    }

    #[test]
    fn test_display_format() {
        let err = AppError::Network("timeout".to_string());
        assert!(err.to_string().contains("Network request failed"));

        let err = AppError::Timeout(Duration::from_secs(5));
        assert!(err.to_string().contains("Timeout"));

        let err = AppError::Api {
            status: 429,
            body: "rate limited".to_string(),
        };
        assert!(err.to_string().contains("429"));
        assert!(!err.to_string().contains("rate limited"));
    }

    #[test]
    fn network_error_hides_sensitive_request_details() {
        let sensitive =
            "request failed for https://user:password@example.test/stt?api_key=secret-token";
        let err = AppError::Network(sensitive.to_string());

        let displayed = err.to_string();
        assert_eq!(displayed, "Network request failed");
        assert!(!displayed.contains("example.test"));
        assert!(!displayed.contains("password"));
        assert!(!displayed.contains("secret-token"));

        let user_error = err.to_user_error();
        assert_eq!(user_error.code, "stt_timeout");
        assert_eq!(user_error.details, None);
        let serialized = serde_json::to_string(&user_error).unwrap();
        assert!(!serialized.contains("example.test"));
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("secret-token"));
    }

    #[test]
    fn reqwest_conversion_discards_sensitive_builder_error_text() {
        let sensitive = "https://user:password@example.test:not-a-port/stt?api_key=secret-token";
        let reqwest_error = reqwest::Client::new().get(sensitive).build().unwrap_err();
        let err = AppError::from(reqwest_error);

        match &err {
            AppError::Network(message) => assert_eq!(message, "request failed"),
            other => panic!("expected network error, got {other}"),
        }
        let displayed = err.to_string();
        assert_eq!(displayed, "Network request failed");
        let serialized = serde_json::to_string(&err.to_user_error()).unwrap();
        for secret in ["example.test", "password", "secret-token"] {
            assert!(!displayed.contains(secret));
            assert!(!serialized.contains(secret));
        }
    }

    #[test]
    fn api_error_hides_provider_body_from_display_and_user_error() {
        let sensitive = "provider rejected https://user:password@example.test?token=secret-token";
        let err = AppError::Api {
            status: 503,
            body: sensitive.to_string(),
        };

        let displayed = err.to_string();
        assert_eq!(displayed, "API error 503");
        assert!(!displayed.contains("example.test"));
        assert!(!displayed.contains("password"));
        assert!(!displayed.contains("secret-token"));

        let user_error = err.to_user_error();
        assert_eq!(user_error.code, "stt_failed");
        assert_eq!(user_error.details.as_deref(), Some("HTTP 503"));
        let serialized = serde_json::to_string(&user_error).unwrap();
        assert!(!serialized.contains("example.test"));
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("secret-token"));
    }
}

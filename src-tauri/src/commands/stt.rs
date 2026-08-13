use crate::credentials::{resolve_config_secret, SystemCredentialVault};
use crate::managed_service::SubscriptionStatus;
use crate::stt;
use crate::stt::SttProvider;
use crate::SessionTokenStore;
use crate::{api_base_url, with_desktop_client_version};

const STT_REQUEST_PREPARATION_ERROR: &str = "Could not prepare the STT connection check";
const STT_PROVIDER_NETWORK_ERROR: &str = "STT provider network request failed";

fn sanitized_reqwest_error(message: &'static str, _error: reqwest::Error) -> String {
    message.to_string()
}

fn build_upload_test_request(
    client: &reqwest::Client,
    cfg: &stt::whisper_compat::WhisperCompatConfig,
    api_key: &str,
) -> Result<reqwest::RequestBuilder, String> {
    // ElevenLabs requires at least 100 ms; use 200 ms to avoid boundary rounding.
    let silent_pcm = vec![0u8; 6400];
    let wav = stt::whisper_compat::WhisperCompatProvider::build_wav(&silent_pcm, 16000);
    let file_part = reqwest::multipart::Part::bytes(wav)
        .file_name("test.wav")
        .mime_str("audio/wav")
        .map_err(|error| sanitized_reqwest_error(STT_REQUEST_PREPARATION_ERROR, error))?;
    let mut form = reqwest::multipart::Form::new()
        .text(cfg.model_field, cfg.model.clone())
        .part("file", file_part);
    for (key, value) in &cfg.extra_fields {
        form = form.text(key.clone(), value.clone());
    }

    let request = client
        .post(&cfg.endpoint)
        .multipart(form)
        .timeout(std::time::Duration::from_secs(15));
    Ok(match cfg.auth {
        stt::whisper_compat::ApiKeyAuth::Bearer if !api_key.trim().is_empty() => {
            request.header("Authorization", format!("Bearer {}", api_key))
        }
        stt::whisper_compat::ApiKeyAuth::Header(name) if !api_key.trim().is_empty() => {
            request.header(name, api_key)
        }
        _ => request,
    })
}

async fn check_volcengine_doubao_connection(
    api_key: &str,
    resource_id: Option<String>,
) -> Result<(), String> {
    let mut provider = stt::volcengine::VolcengineDoubaoProvider::new();
    let config = stt::SttConfig {
        api_key: api_key.to_string(),
        language: Some("zh".to_string()),
        smart_format: true,
        sample_rate: 16000,
        resource_id,
        operation_id: None,
    };
    provider
        .connect(&config)
        .await
        .map_err(|_| STT_PROVIDER_NETWORK_ERROR.to_string())?;
    let _ = provider.disconnect().await;
    Ok(())
}

fn resolve_whisper_test_config(
    provider: &str,
    custom_base_url: Option<String>,
    custom_model: Option<String>,
) -> Result<stt::whisper_compat::WhisperCompatConfig, String> {
    if provider == stt::config::CUSTOM_WHISPER_PROVIDER {
        return stt::config::build_custom_whisper_config(
            custom_base_url.as_deref().unwrap_or_default(),
            custom_model.as_deref().unwrap_or_default(),
        );
    }

    stt::config::build_known_whisper_config(provider)
        .ok_or_else(|| format!("Unknown STT provider: {}", provider))
}

fn validate_custom_whisper_target_before_secret(
    provider: &str,
    custom_base_url: Option<&str>,
    custom_model: Option<&str>,
) -> Result<(), String> {
    if provider == stt::config::CUSTOM_WHISPER_PROVIDER {
        stt::config::build_custom_whisper_config(
            custom_base_url.unwrap_or_default(),
            custom_model.unwrap_or_default(),
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttProviderDiagnosticIssue {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttProviderDiagnostics {
    pub provider: String,
    pub kind: String,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub requires_api_key: bool,
    pub api_key_configured: bool,
    pub ready: bool,
    pub issues: Vec<SttProviderDiagnosticIssue>,
}

fn diagnostic_issue(code: &str, message: impl Into<String>) -> SttProviderDiagnosticIssue {
    SttProviderDiagnosticIssue {
        code: code.to_string(),
        message: message.into(),
    }
}

fn build_remote_stt_diagnostics(provider: &str, api_key: &str) -> SttProviderDiagnostics {
    let whisper_config = stt::config::build_known_whisper_config(provider);
    let (endpoint, model) = if let Some(cfg) = whisper_config {
        (Some(cfg.endpoint), Some(cfg.model))
    } else {
        match provider {
            "deepgram" => (Some("https://api.deepgram.com/v1/listen".to_string()), None),
            "assemblyai" => (
                Some("https://api.assemblyai.com/v2/transcript".to_string()),
                None,
            ),
            stt::volcengine::VOLCENGINE_DOUBAO_PROVIDER => (
                Some("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel".to_string()),
                None,
            ),
            _ => (None, None),
        }
    };

    let api_key_configured = !api_key.trim().is_empty();
    let mut issues = Vec::new();
    if !api_key_configured {
        issues.push(diagnostic_issue(
            "missing_api_key",
            "API key is required for this STT provider",
        ));
    }

    SttProviderDiagnostics {
        provider: provider.to_string(),
        kind: "byokRemote".to_string(),
        endpoint,
        model,
        requires_api_key: true,
        api_key_configured,
        ready: issues.is_empty(),
        issues,
    }
}

fn build_apple_speech_diagnostics(
    provider: &str,
    availability: stt::apple_speech::AppleSpeechAvailability,
) -> SttProviderDiagnostics {
    SttProviderDiagnostics {
        provider: provider.to_string(),
        kind: "builtinLocal".to_string(),
        endpoint: None,
        model: Some(
            availability
                .locale
                .as_ref()
                .map(|locale| format!("Apple Speech ({locale})"))
                .unwrap_or_else(|| "Apple Speech".to_string()),
        ),
        requires_api_key: false,
        api_key_configured: false,
        ready: availability.ready,
        issues: match (availability.issue_code, availability.issue_message) {
            (Some(code), Some(message)) => vec![diagnostic_issue(&code, message)],
            (Some(code), None) => vec![diagnostic_issue(&code, code.clone())],
            _ => Vec::new(),
        },
    }
}

fn build_stt_provider_diagnostics(
    provider: &str,
    api_key: &str,
    custom_base_url: Option<&str>,
    custom_model: Option<&str>,
) -> SttProviderDiagnostics {
    match provider {
        "" => SttProviderDiagnostics {
            provider: provider.to_string(),
            kind: "unknown".to_string(),
            endpoint: None,
            model: None,
            requires_api_key: false,
            api_key_configured: false,
            ready: false,
            issues: vec![diagnostic_issue(
                "missing_provider",
                "No STT provider selected",
            )],
        },
        "cloud" => {
            let ready = crate::managed_service_configured();
            SttProviderDiagnostics {
                provider: provider.to_string(),
                kind: "cloudManaged".to_string(),
                endpoint: ready.then(crate::api_base_url),
                model: None,
                requires_api_key: false,
                api_key_configured: false,
                ready,
                issues: if ready {
                    Vec::new()
                } else {
                    vec![diagnostic_issue(
                        "managed_service_unconfigured",
                        "Managed service is not configured in this build; choose a BYOK or local provider.",
                    )]
                },
            }
        }
        stt::config::APPLE_SPEECH_PROVIDER => build_apple_speech_diagnostics(
            provider,
            stt::apple_speech::apple_speech_availability(None),
        ),
        stt::config::CUSTOM_WHISPER_PROVIDER => {
            let api_key_configured = !api_key.trim().is_empty();
            match stt::config::build_custom_whisper_config(
                custom_base_url.unwrap_or_default(),
                custom_model.unwrap_or_default(),
            ) {
                Ok(cfg) => SttProviderDiagnostics {
                    provider: provider.to_string(),
                    kind: "localCompatible".to_string(),
                    endpoint: Some(cfg.endpoint),
                    model: Some(cfg.model),
                    requires_api_key: cfg.api_key_required,
                    api_key_configured,
                    ready: true,
                    issues: Vec::new(),
                },
                Err(err) => SttProviderDiagnostics {
                    provider: provider.to_string(),
                    kind: "localCompatible".to_string(),
                    endpoint: None,
                    model: custom_model
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string),
                    requires_api_key: false,
                    api_key_configured,
                    ready: false,
                    issues: vec![diagnostic_issue("invalid_custom_whisper_config", err)],
                },
            }
        }
        "deepgram" | "assemblyai" | stt::volcengine::VOLCENGINE_DOUBAO_PROVIDER => {
            build_remote_stt_diagnostics(provider, api_key)
        }
        _ if stt::config::build_known_whisper_config(provider).is_some() => {
            build_remote_stt_diagnostics(provider, api_key)
        }
        _ => SttProviderDiagnostics {
            provider: provider.to_string(),
            kind: "unknown".to_string(),
            endpoint: None,
            model: None,
            requires_api_key: false,
            api_key_configured: !api_key.trim().is_empty(),
            ready: false,
            issues: vec![diagnostic_issue(
                "unknown_provider",
                format!("Unknown STT provider: {}", provider),
            )],
        },
    }
}

async fn check_openai_whisper_model(client: &reqwest::Client, api_key: &str) -> Result<(), String> {
    let resp = client
        .get("https://api.openai.com/v1/models/whisper-1")
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    Ok(())
}

#[tauri::command]
pub fn get_stt_provider_diagnostics(
    api_key: String,
    provider: String,
    custom_base_url: Option<String>,
    custom_model: Option<String>,
) -> Result<SttProviderDiagnostics, String> {
    validate_custom_whisper_target_before_secret(
        &provider,
        custom_base_url.as_deref(),
        custom_model.as_deref(),
    )?;
    let resolved_api_key = if provider == "cloud" {
        String::new()
    } else {
        resolve_config_secret(&api_key, "stt", &provider, &SystemCredentialVault)
            .map_err(|e| e.to_string())?
    };

    Ok(build_stt_provider_diagnostics(
        &provider,
        &resolved_api_key,
        custom_base_url.as_deref(),
        custom_model.as_deref(),
    ))
}

#[tauri::command]
pub async fn test_stt_connection(
    api_key: String,
    provider: String,
    custom_base_url: Option<String>,
    custom_model: Option<String>,
    volcengine_resource_id: Option<String>,
    token_store: tauri::State<'_, SessionTokenStore>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<bool, String> {
    if provider.is_empty() {
        return Ok(false);
    }

    // Cloud provider: verify session token + managed cloud entitlement via API.
    if provider == "cloud" {
        if !crate::managed_service_configured() {
            return Err(crate::managed_service_unconfigured_error().to_string());
        }
        let token = token_store
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if token.is_empty() {
            return Ok(false);
        }
        let api_base = api_base_url();
        let resp = with_desktop_client_version(
            client.get(format!("{}/api/subscription/status", api_base)),
        )
        .header("Authorization", format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
        if !resp.status().is_success() {
            return Ok(false);
        }
        let status: SubscriptionStatus = resp
            .json()
            .await
            .map_err(|_| "Managed service returned an invalid subscription status".to_string())?;
        return Ok(status.has_cloud_access());
    }

    validate_custom_whisper_target_before_secret(
        &provider,
        custom_base_url.as_deref(),
        custom_model.as_deref(),
    )?;
    let api_key = resolve_config_secret(&api_key, "stt", &provider, &SystemCredentialVault)
        .map_err(|e| e.to_string())?;

    if stt::config::stt_provider_requires_api_key(&provider) && api_key.is_empty() {
        return Ok(false);
    }

    match provider.as_str() {
        "deepgram" => {
            let resp = client
                .get("https://api.deepgram.com/v1/projects")
                .header("Authorization", format!("Token {}", api_key))
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
                .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
            Ok(resp.status().is_success())
        }
        "assemblyai" => {
            let resp = client
                .get("https://api.assemblyai.com/v2/transcript?limit=1")
                .header("Authorization", api_key)
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
                .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
            Ok(resp.status().is_success())
        }
        stt::volcengine::VOLCENGINE_DOUBAO_PROVIDER => Ok(check_volcengine_doubao_connection(
            &api_key,
            volcengine_resource_id,
        )
        .await
        .is_ok()),
        stt::config::APPLE_SPEECH_PROVIDER => {
            let authorization = stt::apple_speech::request_apple_speech_authorization()
                .map_err(|e| e.to_string())?;
            if authorization != stt::apple_speech::AppleSpeechAuthorizationStatus::Authorized {
                return Ok(false);
            }
            Ok(stt::apple_speech::apple_speech_availability(None).ready)
        }
        "openai-whisper" => Ok(check_openai_whisper_model(&client, &api_key).await.is_ok()),
        _ => {
            let cfg = resolve_whisper_test_config(&provider, custom_base_url, custom_model)?;
            let resp = build_upload_test_request(&client, &cfg, &api_key)?
                .send()
                .await
                .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
            Ok(resp.status().is_success())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_custom_whisper_test_config() {
        let cfg = resolve_whisper_test_config(
            stt::config::CUSTOM_WHISPER_PROVIDER,
            Some("http://localhost:8000/v1".to_string()),
            Some("Systran/faster-whisper-large-v3".to_string()),
        )
        .unwrap();
        assert_eq!(
            cfg.endpoint,
            "http://localhost:8000/v1/audio/transcriptions"
        );
        assert!(!cfg.api_key_required);
    }

    #[test]
    fn custom_whisper_test_config_requires_model() {
        let err = resolve_whisper_test_config(
            stt::config::CUSTOM_WHISPER_PROVIDER,
            Some("http://localhost:8000/v1".to_string()),
            Some(" ".to_string()),
        )
        .unwrap_err();
        assert!(err.contains("Model is required"));
    }

    #[test]
    fn custom_whisper_diagnostics_exposes_local_endpoint() {
        let diagnostics = build_stt_provider_diagnostics(
            stt::config::CUSTOM_WHISPER_PROVIDER,
            "",
            Some("http://localhost:8000/v1"),
            Some("Systran/faster-whisper-large-v3"),
        );

        assert_eq!(diagnostics.provider, stt::config::CUSTOM_WHISPER_PROVIDER);
        assert_eq!(diagnostics.kind, "localCompatible");
        assert_eq!(
            diagnostics.endpoint.as_deref(),
            Some("http://localhost:8000/v1/audio/transcriptions")
        );
        assert_eq!(
            diagnostics.model.as_deref(),
            Some("Systran/faster-whisper-large-v3")
        );
        assert!(!diagnostics.requires_api_key);
        assert!(diagnostics.ready);
        assert!(diagnostics.issues.is_empty());
    }

    #[test]
    fn custom_whisper_diagnostics_reports_invalid_config() {
        let diagnostics = build_stt_provider_diagnostics(
            stt::config::CUSTOM_WHISPER_PROVIDER,
            "",
            Some("file:///tmp/server"),
            Some(" "),
        );

        assert_eq!(diagnostics.kind, "localCompatible");
        assert!(!diagnostics.ready);
        assert_eq!(diagnostics.issues.len(), 1);
        assert_eq!(diagnostics.issues[0].code, "invalid_custom_whisper_config");
    }

    #[test]
    fn remote_stt_diagnostics_requires_api_key() {
        let diagnostics = build_stt_provider_diagnostics("deepgram", "", None, None);

        assert_eq!(diagnostics.kind, "byokRemote");
        assert!(diagnostics.requires_api_key);
        assert!(!diagnostics.ready);
        assert_eq!(diagnostics.issues.len(), 1);
        assert_eq!(diagnostics.issues[0].code, "missing_api_key");
    }

    #[test]
    fn apple_speech_diagnostics_are_platform_gated_builtin_local() {
        let diagnostics = build_stt_provider_diagnostics("apple-speech", "", None, None);

        assert_eq!(diagnostics.provider, "apple-speech");
        assert_eq!(diagnostics.kind, "builtinLocal");
        assert!(!diagnostics.requires_api_key);
        assert!(!diagnostics.api_key_configured);
        assert_eq!(diagnostics.endpoint, None);
        assert_eq!(diagnostics.model.as_deref(), Some("Apple Speech"));

        #[cfg(target_os = "macos")]
        {
            if diagnostics.ready {
                assert!(diagnostics.issues.is_empty());
            } else {
                assert!(!diagnostics.issues.is_empty());
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            assert!(!diagnostics.ready);
            assert_eq!(diagnostics.issues[0].code, "unsupported_platform");
        }
    }

    #[test]
    fn apple_speech_diagnostics_reports_authorization_issue() {
        let diagnostics = build_apple_speech_diagnostics(
            "apple-speech",
            stt::apple_speech::AppleSpeechAvailability::from_parts(
                true,
                stt::apple_speech::AppleSpeechAuthorizationStatus::Denied,
                Some("en-US".to_string()),
                None,
            ),
        );

        assert!(!diagnostics.ready);
        assert_eq!(diagnostics.kind, "builtinLocal");
        assert_eq!(diagnostics.issues.len(), 1);
        assert_eq!(diagnostics.issues[0].code, "speech_permission_denied");
    }

    #[test]
    fn unconfigured_managed_cloud_diagnostics_fail_closed() {
        if crate::managed_service_configured() {
            return;
        }
        let diagnostics = build_stt_provider_diagnostics("cloud", "", None, None);
        assert!(!diagnostics.ready);
        assert_eq!(diagnostics.endpoint, None);
        assert_eq!(diagnostics.issues[0].code, "managed_service_unconfigured");
    }

    #[test]
    fn reqwest_errors_never_echo_custom_url_credentials_or_query() {
        let secret = "do-not-echo-this-token";
        let hostile_url = format!("http://user:{secret}@[::1?api_key={secret}");
        let source_error = reqwest::Client::new()
            .get(hostile_url)
            .build()
            .expect_err("the hostile URL must be rejected");

        let message = sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, source_error);

        assert_eq!(message, STT_PROVIDER_NETWORK_ERROR);
        assert!(!message.contains(secret));
        assert!(!message.contains("user:"));
        assert!(!message.contains("api_key"));
    }
}

#[tauri::command]
pub async fn bench_stt_connection(
    api_key: String,
    provider: String,
    custom_base_url: Option<String>,
    custom_model: Option<String>,
    volcengine_resource_id: Option<String>,
    token_store: tauri::State<'_, SessionTokenStore>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<u32, String> {
    if provider.is_empty() {
        return Err("No provider specified".to_string());
    }

    if provider == "cloud" {
        if !crate::managed_service_configured() {
            return Err(crate::managed_service_unconfigured_error().to_string());
        }
        let token = token_store
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if token.is_empty() {
            return Err("Not signed in".to_string());
        }
        let api_base = api_base_url();
        let t0 = std::time::Instant::now();
        let resp = with_desktop_client_version(
            client.get(format!("{}/api/subscription/status", api_base)),
        )
        .header("Authorization", format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
        let elapsed = t0.elapsed().as_millis() as u32;
        if !resp.status().is_success() {
            return Err("Request failed".to_string());
        }
        let status: SubscriptionStatus = resp
            .json()
            .await
            .map_err(|_| "Managed service returned an invalid subscription status".to_string())?;
        if !status.has_cloud_access() {
            return Err("Cloud plan required".to_string());
        }
        return Ok(elapsed);
    }

    validate_custom_whisper_target_before_secret(
        &provider,
        custom_base_url.as_deref(),
        custom_model.as_deref(),
    )?;
    let api_key = resolve_config_secret(&api_key, "stt", &provider, &SystemCredentialVault)
        .map_err(|e| e.to_string())?;

    if stt::config::stt_provider_requires_api_key(&provider) && api_key.is_empty() {
        return Err("API key is empty".to_string());
    }

    match provider.as_str() {
        "deepgram" => {
            let t0 = std::time::Instant::now();
            let resp = client
                .get("https://api.deepgram.com/v1/projects")
                .header("Authorization", format!("Token {}", api_key))
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
                .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
            let elapsed = t0.elapsed().as_millis() as u32;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            Ok(elapsed)
        }
        "assemblyai" => {
            let t0 = std::time::Instant::now();
            let resp = client
                .get("https://api.assemblyai.com/v2/transcript?limit=1")
                .header("Authorization", api_key)
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
                .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
            let elapsed = t0.elapsed().as_millis() as u32;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            Ok(elapsed)
        }
        stt::volcengine::VOLCENGINE_DOUBAO_PROVIDER => {
            let t0 = std::time::Instant::now();
            check_volcengine_doubao_connection(&api_key, volcengine_resource_id).await?;
            Ok(t0.elapsed().as_millis() as u32)
        }
        stt::config::APPLE_SPEECH_PROVIDER => {
            if stt::apple_speech::is_available_on_current_platform() {
                Ok(0)
            } else {
                Err("Apple Speech is only available on macOS".to_string())
            }
        }
        "openai-whisper" => {
            let t0 = std::time::Instant::now();
            check_openai_whisper_model(&client, &api_key).await?;
            Ok(t0.elapsed().as_millis() as u32)
        }
        _ => {
            let cfg = resolve_whisper_test_config(&provider, custom_base_url, custom_model)?;
            let t0 = std::time::Instant::now();
            let resp = build_upload_test_request(&client, &cfg, &api_key)?
                .send()
                .await
                .map_err(|error| sanitized_reqwest_error(STT_PROVIDER_NETWORK_ERROR, error))?;
            let elapsed = t0.elapsed().as_millis() as u32;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            Ok(elapsed)
        }
    }
}

use crate::credentials::{resolve_config_secret, SystemCredentialVault};
use crate::managed_service::SubscriptionStatus;
use crate::SessionTokenStore;
use crate::{api_base_url, with_desktop_client_version};

const LLM_PROVIDER_NETWORK_ERROR: &str = "LLM provider network request failed";
const LLM_MODELS_RESPONSE_ERROR: &str = "LLM provider returned an invalid model-list response";

fn sanitized_reqwest_error(message: &'static str, _error: reqwest::Error) -> String {
    message.to_string()
}

#[tauri::command]
pub fn get_llm_model_capability(
    provider: String,
    base_url: String,
    model: String,
) -> crate::llm::model_capabilities::ModelCapability {
    crate::llm::model_capabilities::model_capability(
        &provider,
        &base_url,
        &model,
        crate::llm::prompt::CONTEXT_PROMPT_VERSION,
    )
}

fn synthetic_operation_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (now >> 96) as u32,
        (now >> 80) as u16,
        (now >> 64) as u16,
        (now >> 48) as u16,
        now & 0x0000_ffff_ffff_ffff_ffffu128
    )
}

#[tauri::command]
pub async fn test_llm_connection(
    api_key: String,
    provider: String,
    base_url: String,
    model: String,
    token_store: tauri::State<'_, SessionTokenStore>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<bool, String> {
    if provider.is_empty() {
        return Ok(false);
    }
    crate::llm::validate_provider_base_url(&provider, &base_url)?;

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
        .map_err(|error| sanitized_reqwest_error(LLM_PROVIDER_NETWORK_ERROR, error))?;
        if !resp.status().is_success() {
            return Ok(false);
        }
        let status: SubscriptionStatus = resp
            .json()
            .await
            .map_err(|_| "Managed service returned an invalid subscription status".to_string())?;
        return Ok(status.has_cloud_access());
    }

    let api_key = resolve_config_secret(&api_key, "llm", &provider, &SystemCredentialVault)
        .map_err(|e| e.to_string())?;

    if base_url.is_empty() || !crate::llm::has_usable_provider_credentials(&provider, &api_key) {
        return Ok(false);
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1
    });

    let request = client.post(&url).header("Content-Type", "application/json");
    let resp = crate::llm::apply_provider_auth_header(request, &provider, &api_key)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| sanitized_reqwest_error(LLM_PROVIDER_NETWORK_ERROR, error))?;

    Ok(resp.status().is_success())
}

fn build_fetch_models_request(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    url: &str,
) -> reqwest::RequestBuilder {
    crate::llm::apply_provider_auth_header(client.get(url), provider, api_key)
}

#[tauri::command]
pub async fn fetch_llm_models(
    api_key: String,
    provider: String,
    base_url: String,
) -> Result<Vec<String>, String> {
    crate::llm::validate_provider_base_url(&provider, &base_url)?;
    if provider == "cloud" && !crate::managed_service_configured() {
        return Err(crate::managed_service_unconfigured_error().to_string());
    }
    if base_url.is_empty() {
        return Ok(vec![]);
    }
    if !crate::llm::has_usable_provider_credentials(&provider, &api_key) {
        return Ok(vec![]);
    }

    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));

    let resp = build_fetch_models_request(&client, &provider, &api_key, &url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| sanitized_reqwest_error(LLM_PROVIDER_NETWORK_ERROR, error))?;

    if !resp.status().is_success() {
        return Ok(vec![]);
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|error| sanitized_reqwest_error(LLM_MODELS_RESPONSE_ERROR, error))?;

    // OpenAI-compatible: { data: [{ id: "model-name" }] }
    // Ollama-compatible: { models: [{ name: "model-name" }] }
    let mut models: Vec<String> = Vec::new();

    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    } else if let Some(data) = body.get("models").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                models.push(name.to_string());
            }
        }
    }

    models.sort();
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_request_omits_authorization_for_keyless_ollama() {
        let request = build_fetch_models_request(
            &reqwest::Client::new(),
            "ollama",
            "",
            "http://localhost:11434/v1/models",
        )
        .build()
        .unwrap();

        assert!(request.headers().get("Authorization").is_none());
    }

    #[test]
    fn model_request_keeps_authorization_for_keyed_providers() {
        let request = build_fetch_models_request(
            &reqwest::Client::new(),
            "openai",
            "sk-test",
            "https://api.openai.com/v1/models",
        )
        .build()
        .unwrap();

        assert_eq!(
            request.headers().get("Authorization").unwrap(),
            "Bearer sk-test"
        );
    }

    #[test]
    fn request_policy_rejects_unsafe_url_before_builder_receives_secret() {
        let unsafe_url = "https://user:secret@proxy.example/v1?api_key=secret";
        let validation = crate::llm::validate_provider_base_url("openai", unsafe_url);

        assert!(validation.is_err());
        assert!(!validation.unwrap_err().contains("secret"));
    }

    #[test]
    fn reqwest_errors_never_echo_custom_url_credentials_or_query() {
        let secret = "do-not-echo-this-token";
        let hostile_url = format!("http://user:{secret}@[::1?api_key={secret}");
        let source_error = reqwest::Client::new()
            .get(hostile_url)
            .build()
            .expect_err("the hostile URL must be rejected");

        let message = sanitized_reqwest_error(LLM_PROVIDER_NETWORK_ERROR, source_error);

        assert_eq!(message, LLM_PROVIDER_NETWORK_ERROR);
        assert!(!message.contains(secret));
        assert!(!message.contains("user:"));
        assert!(!message.contains("api_key"));
    }
}

#[tauri::command]
pub async fn bench_llm_connection(
    api_key: String,
    provider: String,
    base_url: String,
    model: String,
    token_store: tauri::State<'_, SessionTokenStore>,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<u32, String> {
    if provider.is_empty() {
        return Err("No provider specified".to_string());
    }
    crate::llm::validate_provider_base_url(&provider, &base_url)?;

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
        let operation_id = synthetic_operation_id();
        let body = serde_json::json!({
            "messages": [{"role": "user", "content": "hi"}],
            "stream": false,
            "context": {
                "operationId": operation_id.clone(),
                "stageKey": format!("{operation_id}:llm"),
                "requestType": "connection_benchmark",
                "clientVersion": crate::desktop_client_version(),
                "rawTextChars": 2,
                "selectedTextChars": 0,
                "hasSelectedText": false,
                "translateEnabled": false
            }
        });
        let t0 = std::time::Instant::now();
        let resp = with_desktop_client_version(client.post(format!("{}/api/proxy/llm", api_base)))
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|error| sanitized_reqwest_error(LLM_PROVIDER_NETWORK_ERROR, error))?;
        let elapsed = t0.elapsed().as_millis() as u32;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        return Ok(elapsed);
    }

    let api_key = resolve_config_secret(&api_key, "llm", &provider, &SystemCredentialVault)
        .map_err(|e| e.to_string())?;

    if base_url.is_empty() || !crate::llm::has_usable_provider_credentials(&provider, &api_key) {
        return Err("API key or base URL is empty".to_string());
    }

    let parsed = url::Url::parse(&base_url).map_err(|e| format!("Invalid base URL: {e}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Base URL must use http or https scheme".to_string());
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1
    });

    let t0 = std::time::Instant::now();
    let request = client.post(&url).header("Content-Type", "application/json");
    let resp = crate::llm::apply_provider_auth_header(request, &provider, &api_key)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| sanitized_reqwest_error(LLM_PROVIDER_NETWORK_ERROR, error))?;
    let elapsed = t0.elapsed().as_millis() as u32;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    Ok(elapsed)
}

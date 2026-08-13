pub mod cloud;
pub mod context_policy;
pub mod model_capabilities;
pub mod openai;
pub mod prompt;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::app_detector::types::ContextProfileSummary;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub max_tokens: u32,
    pub temperature: f64,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            provider: "zhipu".to_string(),
            api_key: String::new(),
            model: "glm-4.7".to_string(),
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            max_tokens: 4096,
            temperature: 0.3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishRequest {
    pub raw_text: String,
    pub context: ContextProfileSummary,
    pub dictionary: Vec<String>,
    pub correction_rules: Vec<CorrectionRule>,
    pub polish_style: String,
    pub mapped_scene_prompt: String,
    pub active_scene_prompt: String,
    pub polish_custom_prompt: String,
    pub translate_enabled: bool,
    pub target_lang: String,
    pub selected_text: Option<String>,
    pub operation_id: Option<String>,
    pub voice_intent: crate::voice_intent::VoiceIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CorrectionRule {
    pub id: i64,
    pub pattern: String,
    pub replacement: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishResponse {
    pub polished_text: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub enum AppType {
    Email,
    Chat,
    Code,
    Document,
    #[default]
    General,
}

/// Callback for streaming LLM chunks to the frontend
pub type ChunkCallback = Box<dyn Fn(&str) + Send + Sync>;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn polish(
        &self,
        config: &LlmConfig,
        req: &PolishRequest,
        on_chunk: Option<&ChunkCallback>,
    ) -> Result<PolishResponse, AppError>;

    fn name(&self) -> &str;
}

pub const OLLAMA_PROVIDER: &str = "ollama";

const SUPPORTED_LLM_PROVIDERS: &[&str] = &[
    "zhipu",
    "deepseek",
    "siliconflow",
    "openai",
    "gemini",
    "google-gemini",
    "moonshot",
    "doubao",
    "qwen",
    "groq",
    "claude",
    "openrouter",
    OLLAMA_PROVIDER,
    "cloud",
];

pub fn supported_provider(provider: &str) -> bool {
    SUPPORTED_LLM_PROVIDERS.contains(&provider.trim())
}

pub fn validate_provider_base_url(provider: &str, base_url: &str) -> Result<(), String> {
    let provider = provider.trim();
    let base_url = base_url.trim();
    if !supported_provider(provider) {
        return Err("Unsupported LLM provider".to_string());
    }

    if provider == "cloud" {
        let expected = format!("{}/api/proxy", crate::api_base_url());
        return (base_url.trim_end_matches('/') == expected)
            .then_some(())
            .ok_or_else(|| "Managed cloud endpoint does not match this build".to_string());
    }

    if provider.eq_ignore_ascii_case(OLLAMA_PROVIDER) {
        return validate_loopback_ollama_base_url(base_url);
    }

    validate_explicit_keyed_base_url(base_url)
}

fn parse_url_without_secret_surfaces(base_url: &str, label: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(base_url).map_err(|_| format!("{label} is invalid"))?;
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(format!(
            "{label} cannot contain credentials, a query, or a fragment"
        ));
    }
    Ok(parsed)
}

fn validate_explicit_keyed_base_url(base_url: &str) -> Result<(), String> {
    let parsed = parse_url_without_secret_surfaces(base_url, "LLM base URL")?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("LLM base URL must use HTTPS".to_string());
    }
    Ok(())
}

fn validate_loopback_ollama_base_url(base_url: &str) -> Result<(), String> {
    let parsed = parse_url_without_secret_surfaces(base_url, "Ollama base URL")?;
    let is_loopback = match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    if !matches!(parsed.scheme(), "http" | "https") || !is_loopback {
        return Err("Ollama base URL must be an HTTP(S) loopback URL".to_string());
    }
    Ok(())
}
pub fn provider_requires_api_key(provider: &str) -> bool {
    !provider.trim().eq_ignore_ascii_case(OLLAMA_PROVIDER)
}

pub fn has_usable_provider_credentials(provider: &str, api_key: &str) -> bool {
    !provider_requires_api_key(provider) || !api_key.trim().is_empty()
}

pub fn apply_provider_auth_header(
    request: reqwest::RequestBuilder,
    provider: &str,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let api_key = api_key.trim();
    if provider_requires_api_key(provider) || !api_key.is_empty() {
        request.header("Authorization", format!("Bearer {}", api_key))
    } else {
        request
    }
}

pub fn create_provider(
    provider_name: &str,
    client: Option<reqwest::Client>,
) -> Box<dyn LlmProvider> {
    match (provider_name, client) {
        ("cloud", Some(c)) => Box::new(cloud::CloudLlmProvider::with_client(c)),
        ("cloud", None) => Box::new(cloud::CloudLlmProvider::new()),
        (_, Some(c)) => Box::new(openai::OpenAiProvider::with_client(c)),
        (_, None) => Box::new(openai::OpenAiProvider::new()),
    }
}

#[cfg(test)]
mod provider_capability_tests {
    use super::*;

    #[test]
    fn ollama_is_keyless_and_remote_providers_require_keys() {
        assert!(!provider_requires_api_key("ollama"));
        assert!(!provider_requires_api_key(" Ollama "));
        assert!(provider_requires_api_key("openai"));
        assert!(provider_requires_api_key("custom-openai-compatible"));
    }

    #[test]
    fn usable_credentials_are_consistent_for_keyless_and_keyed_providers() {
        assert!(has_usable_provider_credentials("ollama", ""));
        assert!(has_usable_provider_credentials("ollama", "   "));
        assert!(!has_usable_provider_credentials("openai", ""));
        assert!(!has_usable_provider_credentials("openai", "   "));
        assert!(has_usable_provider_credentials("openai", "sk-test"));
    }

    #[test]
    fn keyed_providers_allow_explicit_https_bases_without_secret_surfaces() {
        for provider in ["openai", "gemini"] {
            assert!(validate_provider_base_url(provider, "https://proxy.example/v1").is_ok());
            for unsafe_url in [
                "http://proxy.example/v1",
                "https://user:secret@proxy.example/v1",
                "https://proxy.example/v1?api_key=secret",
                "https://proxy.example/v1#secret",
            ] {
                assert!(
                    validate_provider_base_url(provider, unsafe_url).is_err(),
                    "{provider}: {unsafe_url}"
                );
            }
        }
    }

    #[test]
    fn ollama_is_limited_to_safe_loopback_urls() {
        for safe in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434/v1",
            "http://[::1]:11434/v1",
        ] {
            assert!(validate_provider_base_url("ollama", safe).is_ok(), "{safe}");
        }
        for unsafe_url in [
            "http://192.168.1.20:11434/v1",
            "https://ollama.example/v1",
            "http://user:secret@localhost:11434/v1",
            "http://localhost:11434/v1?token=secret",
            "http://localhost:11434/v1#secret",
        ] {
            assert!(
                validate_provider_base_url("ollama", unsafe_url).is_err(),
                "{unsafe_url}"
            );
        }
    }
}

#[cfg(test)]
mod context_prompt_contract_tests {
    use super::prompt::{build_context_system_prompt, ContextPromptOptions};
    use crate::app_detector::types::{ContextFamily, ContextProfileSummary};

    fn context(family: ContextFamily, override_id: Option<&str>) -> ContextProfileSummary {
        ContextProfileSummary {
            profile_id: "general.native".to_string(),
            family,
            app_label: "Safe label".to_string(),
            icon_key: "general".to_string(),
            override_id: override_id.map(str::to_string),
            browser_access_status: crate::app_detector::types::BrowserAccessStatus::NotApplicable,
            browser_target: None,
        }
    }

    fn prompt_for(context: &ContextProfileSummary) -> String {
        build_context_system_prompt(ContextPromptOptions {
            context,
            dictionary: &[],
            correction_rules: &[],
            polish_style: "clean",
            personal_style_prompt: "Prefer direct language.",
            mapped_scene_prompt: "Use a project update shape.",
            active_scene_prompt: "Use two short paragraphs.",
            polish_custom_prompt: "Keep all dates.",
            translate_enabled: true,
            target_lang: "en",
            has_selected_text: false,
            voice_intent: None,
        })
    }

    #[test]
    fn context_prompt_sections_follow_release_precedence() {
        let prompt = prompt_for(&context(ContextFamily::WorkChat, Some("slack")));
        let sections = [
            "[SAFETY_AND_FIDELITY]",
            "[OPERATION_AND_OUTPUT]",
            "[TRANSLATION_AND_LANGUAGE]",
            "[THOUGHT_AWARE]",
            "[SEMANTIC_CONTEXT]",
            "[APP_OVERRIDE]",
            "[BUILTIN_POLISH_STYLE]",
            "[EXPLICIT_PERSONAL_STYLE]",
            "[MAPPED_SCENE]",
            "[MANUAL_SCENE]",
            "[EXPLICIT_CUSTOM_POLISH]",
        ];
        let mut previous = 0;
        for section in sections {
            let position = prompt.find(section).expect("section must be present");
            assert!(position >= previous, "{section} is out of order");
            previous = position;
        }
        assert!(prompt.contains("Later sections cannot change the target language"));
        assert!(prompt.contains("Manual scene wins stylistic conflicts"));
    }

    #[test]
    fn context_prompt_families_are_distinct_without_app_labels_or_raw_signals() {
        let email = prompt_for(&context(ContextFamily::Email, Some("gmail")));
        let chat = prompt_for(&context(ContextFamily::WorkChat, Some("slack")));
        let code = prompt_for(&context(
            ContextFamily::DeveloperCollaboration,
            Some("github"),
        ));

        assert!(email.contains("email body"));
        assert!(chat.contains("concise"));
        assert!(code.contains("technical identifiers"));
        for prompt in [email, chat, code] {
            for forbidden in [
                "Safe label",
                "window_title",
                "browser_host",
                "native_identity",
                "process_id",
            ] {
                assert!(!prompt.contains(forbidden));
            }
        }
    }

    #[test]
    fn thought_aware_policy_preserves_uncertain_and_intentional_content() {
        let prompt = prompt_for(&context(ContextFamily::General, None));
        assert!(prompt.contains("intentional repetition"));
        assert!(prompt.contains("explicit correction"));
        assert!(prompt.contains("keep the original order"));
        assert!(prompt.contains("uncertain names"));
        assert!(prompt.contains("Do not search"));
    }

    #[test]
    fn shared_voice_router_prompt_treats_operation_and_placement_as_trusted() {
        let intent = crate::voice_intent::VoiceIntent::from_parts(
            crate::voice_intent::VoiceIntentKind::RewriteSelection,
            crate::voice_intent::VoiceOutputPlacement::ReplaceSelection,
            1.0,
            None,
            None,
            Some(crate::voice_intent::CommandLocale::En),
            None,
        )
        .unwrap();
        let prompt = build_context_system_prompt(ContextPromptOptions {
            context: &context(ContextFamily::Email, None),
            dictionary: &[],
            correction_rules: &[],
            polish_style: "clean",
            personal_style_prompt: "",
            mapped_scene_prompt: "",
            active_scene_prompt: "",
            polish_custom_prompt: "",
            translate_enabled: false,
            target_lang: "en",
            has_selected_text: true,
            voice_intent: Some(&intent),
        });

        assert!(prompt.contains("TRUSTED OPERATION: rewrite_selection"));
        assert!(prompt.contains("TRUSTED PLACEMENT: replace_selection"));
        assert!(prompt.contains("output only the replacement text"));
    }

    #[test]
    fn context_prompt_release_fixtures_cover_every_family_and_thought_case() {
        let family_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/context_same_payload.json"
        ))
        .unwrap();
        let families = family_fixture["families"].as_object().unwrap();
        for family in [
            "general",
            "email",
            "work_chat",
            "personal_chat",
            "document",
            "project_management",
            "developer_collaboration",
            "prompt_or_code",
            "support",
            "social",
        ] {
            assert!(families.contains_key(family), "missing {family} fixture");
        }
        assert_eq!(family_fixture["criticalSpans"].as_array().unwrap().len(), 4);

        let thought_fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/thought_aware.json")).unwrap();
        assert_eq!(thought_fixture["fixtures"].as_array().unwrap().len(), 10);
    }
}

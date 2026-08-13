use crate::app_detector::registry::AppRegistry;
use crate::app_detector::types::{BrowserAccessStatus, ContextFamily, ContextProfile};
use crate::credentials::{migrate_legacy_config_secrets, SystemCredentialVault};
use anyhow::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri_plugin_store::StoreExt;
use unicode_normalization::UnicodeNormalization;

const CUSTOM_SCENES_MAX_COUNT: usize = 100;
const SCENE_ID_MAX_CHARS: usize = 120;
const SCENE_SOURCE_MAX_CHARS: usize = 24;
const SCENE_NAME_MAX_CHARS: usize = 80;
const SCENE_DESCRIPTION_MAX_CHARS: usize = 240;
pub(crate) const SCENE_PROMPT_MAX_CHARS: usize = 4000;
pub const DEFAULT_HISTORY_MAX_ENTRIES: u32 = 5000;
pub const MAX_BACKUP_DICTIONARY_ENTRIES: usize = 10_000;
pub const MAX_BACKUP_CORRECTION_RULES: usize = 10_000;
pub const MAX_HISTORY_RETENTION_DAYS: u32 = 3650;
pub const MAX_HOTKEY_BINDINGS_PER_ROLE: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct CustomScene {
    pub id: String,
    pub name: String,
    pub description: String,
    pub prompt_template: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct ActiveScene {
    pub id: String,
    pub source: String,
    pub name: String,
    pub prompt_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct FamilySceneAssignment {
    pub family: ContextFamily,
    pub scene_id: String,
}

impl Default for FamilySceneAssignment {
    fn default() -> Self {
        Self {
            family: ContextFamily::General,
            scene_id: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct SystemSceneOverride {
    pub id: String,
    pub prompt_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ShortcutBinding {
    pub primary: String,
    pub modifiers: Vec<String>,
}

impl Default for ShortcutBinding {
    fn default() -> Self {
        binding_from_hotkey_string(default_dictation_hotkey()).unwrap_or_else(|| Self {
            primary: "/".to_string(),
            modifiers: vec!["Ctrl".to_string()],
        })
    }
}

impl ShortcutBinding {
    pub fn from_hotkey(value: &str) -> Option<Self> {
        binding_from_hotkey_string(value)
    }

    pub fn to_hotkey_string(&self) -> Option<String> {
        let mut binding = self.clone();
        if !binding.normalize() {
            return None;
        }

        let mut parts = binding.modifiers;
        parts.push(binding.primary);
        Some(parts.join("+"))
    }

    pub fn normalize(&mut self) -> bool {
        let Some(primary) = normalize_hotkey_primary(&self.primary) else {
            return false;
        };

        let mut seen_semantic = HashSet::new();
        let mut modifiers = Vec::new();
        for modifier in &self.modifiers {
            let Some((semantic, canonical)) = normalize_hotkey_modifier(modifier) else {
                return false;
            };
            if !seen_semantic.insert(semantic) {
                return false;
            }
            modifiers.push(canonical.to_string());
        }

        modifiers.sort_by_key(|modifier| hotkey_modifier_rank(modifier));
        self.primary = primary;
        self.modifiers = modifiers;
        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct HotkeyConfig {
    pub dictation: ShortcutBinding,
    pub ask: Option<ShortcutBinding>,
    pub translate: Option<ShortcutBinding>,
    #[serde(default)]
    pub dictation_bindings: Vec<ShortcutBinding>,
    #[serde(default)]
    pub ask_bindings: Vec<ShortcutBinding>,
    #[serde(default)]
    pub translate_bindings: Vec<ShortcutBinding>,
    pub edit_selection: Option<ShortcutBinding>,
    pub switch_scene: Option<ShortcutBinding>,
    pub open_app: Option<ShortcutBinding>,
    pub dictation_mode: String,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        let mut config = Self::from_legacy(
            default_dictation_hotkey(),
            default_ask_hotkey(),
            default_dictation_hotkey_mode(),
        );
        config.translate = default_translate_hotkey().and_then(ShortcutBinding::from_hotkey);
        config.translate_bindings = config.translate.clone().into_iter().collect();
        config
    }
}

impl HotkeyConfig {
    pub fn from_legacy(dictation_hotkey: &str, ask_hotkey: &str, dictation_mode: &str) -> Self {
        let dictation = ShortcutBinding::from_hotkey(dictation_hotkey)
            .unwrap_or_else(|| ShortcutBinding::from_hotkey(default_dictation_hotkey()).unwrap());
        let ask = if ask_hotkey.trim().is_empty() {
            None
        } else {
            ShortcutBinding::from_hotkey(ask_hotkey)
                .or_else(|| ShortcutBinding::from_hotkey(default_ask_hotkey()))
        };
        let dictation_mode = normalize_hotkey_mode(dictation_mode).to_string();

        Self {
            dictation_bindings: vec![dictation.clone()],
            ask_bindings: ask.clone().into_iter().collect(),
            translate_bindings: Vec::new(),
            dictation,
            ask,
            translate: None,
            edit_selection: None,
            switch_scene: None,
            open_app: None,
            dictation_mode,
        }
    }

    pub fn normalize(&mut self) {
        let had_dictation_list = !self.dictation_bindings.is_empty();
        let had_ask_list = !self.ask_bindings.is_empty();
        let had_translate_list = !self.translate_bindings.is_empty();

        normalize_binding_list(&mut self.dictation_bindings);
        normalize_binding_list(&mut self.ask_bindings);
        normalize_binding_list(&mut self.translate_bindings);

        if !had_dictation_list && self.dictation.normalize() {
            self.dictation_bindings.push(self.dictation.clone());
        }
        if self.dictation_bindings.is_empty() {
            self.dictation_bindings =
                vec![ShortcutBinding::from_hotkey(default_dictation_hotkey())
                    .expect("default dictation hotkey must be valid")];
        }

        if !had_ask_list {
            if let Some(mut ask) = self.ask.clone() {
                if ask.normalize() {
                    self.ask_bindings.push(ask);
                }
            }
        }
        if !had_translate_list {
            if let Some(mut translate) = self.translate.clone() {
                if translate.normalize() {
                    self.translate_bindings.push(translate);
                }
            }
        }

        self.dictation = self.dictation_bindings[0].clone();
        self.ask = self.ask_bindings.first().cloned();
        self.translate = self.translate_bindings.first().cloned();
        normalize_optional_binding(&mut self.edit_selection);
        normalize_optional_binding(&mut self.switch_scene);
        normalize_optional_binding(&mut self.open_app);
        self.dictation_mode = normalize_hotkey_mode(&self.dictation_mode).to_string();
    }
}

fn normalize_binding_list(bindings: &mut Vec<ShortcutBinding>) {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for mut binding in bindings.drain(..) {
        if !binding.normalize() {
            continue;
        }
        let identity = shortcut_binding_identity(&binding);
        if !seen.insert(identity) {
            continue;
        }
        normalized.push(binding);
        if normalized.len() == MAX_HOTKEY_BINDINGS_PER_ROLE {
            break;
        }
    }
    *bindings = normalized;
}

fn shortcut_binding_identity(binding: &ShortcutBinding) -> String {
    let mut parts: Vec<&str> = binding
        .modifiers
        .iter()
        .map(|modifier| match modifier.as_str() {
            "Option" | "Alt" => "Alt",
            "Command" | "Super" => "Super",
            value => value,
        })
        .collect();
    parts.push(&binding.primary);
    parts.join("+")
}

pub const SUPPORTED_TRANSLATION_LANGUAGES: &[&str] = &[
    "en", "zh", "ja", "ko", "fr", "de", "es", "pt", "ru", "ar", "hi", "th", "vi", "it", "nl", "tr",
    "pl", "uk", "id", "ms",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TranslationConfig {
    pub targets: Vec<String>,
    pub active_target: String,
}

impl Default for TranslationConfig {
    fn default() -> Self {
        Self {
            targets: vec!["en".to_string()],
            active_target: "en".to_string(),
        }
    }
}

impl TranslationConfig {
    fn from_legacy(target_lang: &str) -> Self {
        let target = normalize_translation_code(target_lang).unwrap_or_else(|| "en".to_string());
        Self {
            targets: vec![target.clone()],
            active_target: target,
        }
    }

    fn normalize(&mut self, legacy_target: &str) {
        let mut normalized = Vec::new();
        for target in &self.targets {
            let Some(target) = normalize_translation_code(target) else {
                continue;
            };
            if !normalized.contains(&target) {
                normalized.push(target);
            }
            if normalized.len() == 5 {
                break;
            }
        }

        let legacy = normalize_translation_code(legacy_target);
        if normalized.is_empty() {
            normalized.push(legacy.clone().unwrap_or_else(|| "en".to_string()));
        }
        if let Some(legacy) = legacy.as_ref() {
            if !normalized.contains(legacy) && normalized.len() < 5 {
                normalized.push(legacy.clone());
            }
        }

        let requested_active = normalize_translation_code(&self.active_target);
        let active_target = legacy
            .filter(|target| normalized.contains(target))
            .or_else(|| requested_active.filter(|target| normalized.contains(target)))
            .unwrap_or_else(|| normalized[0].clone());

        self.targets = normalized;
        self.active_target = active_target;
    }
}

fn normalize_translation_code(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    SUPPORTED_TRANSLATION_LANGUAGES
        .contains(&normalized.as_str())
        .then_some(normalized)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub stt_provider: String,
    pub stt_api_key: String,
    pub stt_custom_api_key: String,
    pub stt_language: String,
    pub stt_custom_preset: String,
    pub stt_custom_base_url: String,
    pub stt_custom_model: String,
    pub stt_volcengine_resource_id: String,
    pub llm_provider: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub llm_base_url: String,
    pub polish_enabled: bool,
    pub context_adaptation_enabled: bool,
    pub voice_routing_flags: crate::voice_intent::VoiceRoutingFlags,
    pub polish_style: String,
    pub polish_custom_prompt: String,
    pub polish_chinese_script: String,
    pub custom_scenes: Vec<CustomScene>,
    pub system_scene_overrides: Vec<SystemSceneOverride>,
    pub active_scene: Option<ActiveScene>,
    pub family_scene_assignments: Vec<FamilySceneAssignment>,
    pub translate_enabled: bool,
    pub target_lang: String,
    pub translation: TranslationConfig,
    pub hotkey: String,
    pub ask_hotkey: String,
    pub hotkey_mode: String,
    pub hotkeys: HotkeyConfig,
    pub output_mode: String,
    pub insertion_strategy: String,
    pub restore_clipboard_after_paste: bool,
    pub paste_shortcut: String,
    pub windows_sendinput_newline_mode: String,
    pub streaming_insert_enabled: bool,
    pub selected_text_enabled: bool,
    pub theme: String,
    pub auto_start: bool,
    pub close_to_tray: bool,
    pub start_minimized: bool,
    pub max_recording_seconds: u32,
    pub history_enabled: bool,
    pub history_retention_days: u32,
    pub history_max_entries: u32,
    pub ui_language: String,
    pub capsule_auto_hide: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            stt_provider: "glm-asr".to_string(),
            stt_api_key: String::new(),
            stt_custom_api_key: String::new(),
            stt_language: "multi".to_string(),
            stt_custom_preset: crate::stt::config::CUSTOM_WHISPER_PRESET_SPEACHES.to_string(),
            stt_custom_base_url: crate::stt::config::DEFAULT_CUSTOM_WHISPER_BASE_URL.to_string(),
            stt_custom_model: crate::stt::config::DEFAULT_CUSTOM_WHISPER_MODEL.to_string(),
            stt_volcengine_resource_id: crate::stt::volcengine::VOLCENGINE_SEEDASR_RESOURCE_ID
                .to_string(),
            llm_provider: "openrouter".to_string(),
            llm_api_key: String::new(),
            llm_model: "google/gemini-2.5-flash".to_string(),
            llm_base_url: "https://openrouter.ai/api/v1".to_string(),
            polish_enabled: true,
            context_adaptation_enabled: true,
            voice_routing_flags: crate::voice_intent::VoiceRoutingFlags::default(),
            polish_style: "clean".to_string(),
            polish_custom_prompt: String::new(),
            polish_chinese_script: "preserve".to_string(),
            custom_scenes: Vec::new(),
            system_scene_overrides: Vec::new(),
            active_scene: None,
            family_scene_assignments: Vec::new(),
            translate_enabled: false,
            target_lang: "en".to_string(),
            translation: TranslationConfig::default(),
            hotkey: default_dictation_hotkey().to_string(),
            ask_hotkey: default_ask_hotkey().to_string(),
            hotkey_mode: default_dictation_hotkey_mode().to_string(),
            hotkeys: HotkeyConfig::default(),
            output_mode: "keyboard".to_string(),
            insertion_strategy: "auto".to_string(),
            restore_clipboard_after_paste: true,
            paste_shortcut: "ctrlV".to_string(),
            windows_sendinput_newline_mode: "enter".to_string(),
            streaming_insert_enabled: false,
            selected_text_enabled: false,
            theme: "system".to_string(),
            auto_start: true,
            close_to_tray: true,
            start_minimized: false,
            max_recording_seconds: 30,
            history_enabled: true,
            history_retention_days: 0,
            history_max_entries: DEFAULT_HISTORY_MAX_ENTRIES,
            ui_language: "en".to_string(),
            capsule_auto_hide: false,
        }
    }
}

impl AppConfig {
    pub fn new_install_default() -> Self {
        Self {
            capsule_auto_hide: true,
            ..Self::default()
        }
    }

    fn migrate_legacy_platform_hotkeys(&mut self) {
        #[cfg(target_os = "macos")]
        if self.hotkey == "Alt+/" {
            self.hotkey = "Option+/".to_string();
        }
        #[cfg(target_os = "macos")]
        if self.hotkey == "Option+/" && self.hotkey_mode == "hold" {
            self.hotkey = "Fn".to_string();
            self.hotkey_mode = "toggle".to_string();
        }
        #[cfg(target_os = "windows")]
        if self.hotkey == "RightAlt" && self.hotkey_mode == "toggle" {
            self.hotkey = "Ctrl+/".to_string();
            self.hotkey_mode = "hold".to_string();
        }
        #[cfg(target_os = "macos")]
        if self.ask_hotkey == "Alt+Shift+/"
            || self.ask_hotkey == "Option+Shift+/"
            || self.ask_hotkey == "Command+Shift+/"
            || self.ask_hotkey == "Command+/"
            || self.ask_hotkey == "Command+。"
            || self.ask_hotkey == "Command+."
        {
            self.ask_hotkey = default_ask_hotkey().to_string();
        }
        #[cfg(not(target_os = "macos"))]
        if self.ask_hotkey == "Ctrl+Shift+/"
            || self.ask_hotkey == "Control+Shift+/"
            || self.ask_hotkey == "Ctrl+/"
            || self.ask_hotkey == "Control+/"
            || self.ask_hotkey == "Ctrl+."
            || self.ask_hotkey == "Control+."
            || self.ask_hotkey == "RightAlt+Space"
        {
            self.ask_hotkey = default_ask_hotkey().to_string();
        }
        #[cfg(target_os = "windows")]
        if self
            .hotkeys
            .translate
            .as_ref()
            .and_then(ShortcutBinding::to_hotkey_string)
            .as_deref()
            == Some("RightAlt+LeftShift")
        {
            self.hotkeys.translate = None;
            self.hotkeys.translate_bindings.clear();
        }
    }

    fn normalize_hotkey_settings(&mut self) {
        self.migrate_platform_typed_hotkeys();
        self.hotkeys.dictation_mode =
            normalize_hotkey_mode(&self.hotkeys.dictation_mode).to_string();
        self.sync_legacy_hotkey_fields_from_typed();
    }

    fn migrate_platform_typed_hotkeys(&mut self) {
        #[cfg(target_os = "windows")]
        {
            if self.hotkeys.dictation.to_hotkey_string().as_deref() == Some("RightAlt") {
                if let Some(binding) = ShortcutBinding::from_hotkey("Ctrl+/") {
                    self.hotkeys.dictation = binding.clone();
                    self.hotkeys.dictation_bindings = vec![binding];
                }
                self.hotkeys.dictation_mode = "hold".to_string();
            }
            if self
                .hotkeys
                .ask
                .as_ref()
                .and_then(ShortcutBinding::to_hotkey_string)
                .as_deref()
                == Some("RightAlt+Space")
            {
                self.hotkeys.ask = ShortcutBinding::from_hotkey("Ctrl+.");
                self.hotkeys.ask_bindings = self.hotkeys.ask.clone().into_iter().collect();
            }
            if self
                .hotkeys
                .translate
                .as_ref()
                .and_then(ShortcutBinding::to_hotkey_string)
                .as_deref()
                == Some("RightAlt+LeftShift")
            {
                self.hotkeys.translate = None;
                self.hotkeys.translate_bindings.clear();
            }
        }
    }

    fn sync_legacy_hotkey_fields_from_typed(&mut self) {
        self.hotkeys.normalize();
        self.hotkey = self
            .hotkeys
            .dictation
            .to_hotkey_string()
            .unwrap_or_else(|| default_dictation_hotkey().to_string());
        self.ask_hotkey = self
            .hotkeys
            .ask
            .as_ref()
            .and_then(ShortcutBinding::to_hotkey_string)
            .unwrap_or_default();
        self.hotkey_mode = self.hotkeys.dictation_mode.clone();
    }

    pub(crate) fn normalize_values(&mut self) {
        self.polish_style = normalize_polish_style(&self.polish_style).to_string();
        self.polish_custom_prompt = sanitize_polish_custom_prompt(&self.polish_custom_prompt);
        self.polish_chinese_script = "preserve".to_string();
        sanitize_custom_scenes(&mut self.custom_scenes);
        sanitize_system_scene_overrides(&mut self.system_scene_overrides);
        sanitize_active_scene(&mut self.active_scene);
        sanitize_family_scene_assignments(
            &mut self.family_scene_assignments,
            &self.custom_scenes,
            &self.system_scene_overrides,
        );
        self.translation.normalize(&self.target_lang);
        self.target_lang = self.translation.active_target.clone();
        self.normalize_insertion_strategy();
        self.normalize_paste_shortcut();
        self.normalize_windows_sendinput_newline_mode();
        self.normalize_hotkey_settings();
        self.normalize_recording_limit();
        self.normalize_history_settings();
    }

    pub(crate) fn validate_provider_endpoints(&self) -> Result<(), String> {
        if self.stt_provider == crate::stt::config::CUSTOM_WHISPER_PROVIDER {
            crate::stt::config::normalize_custom_whisper_endpoint(&self.stt_custom_base_url)?;
        } else if self.stt_provider != "cloud"
            && self.stt_provider != crate::stt::config::APPLE_SPEECH_PROVIDER
            && self.stt_provider != crate::stt::volcengine::VOLCENGINE_DOUBAO_PROVIDER
            && self.stt_provider != "deepgram"
            && self.stt_provider != "assemblyai"
            && crate::stt::config::get_whisper_config(&self.stt_provider).is_none()
        {
            return Err("Unsupported STT provider".to_string());
        }
        crate::llm::validate_provider_base_url(&self.llm_provider, &self.llm_base_url)
    }

    fn normalize_recording_limit(&mut self) {
        // Zero means recording continues until the user explicitly stops it.
        if self.max_recording_seconds != 0 {
            self.max_recording_seconds = self.max_recording_seconds.clamp(5, 720);
        }
    }

    fn normalize_insertion_strategy(&mut self) {
        if !matches!(
            self.insertion_strategy.as_str(),
            "auto" | "keyboard" | "clipboardPaste" | "clipboardCopyOnly" | "windowsSendInput"
        ) {
            self.insertion_strategy = "auto".to_string();
        }

        self.output_mode =
            legacy_output_mode_for_insertion_strategy(&self.insertion_strategy).to_string();
    }

    fn normalize_paste_shortcut(&mut self) {
        if !matches!(
            self.paste_shortcut.as_str(),
            "ctrlV" | "ctrlShiftV" | "shiftInsert"
        ) {
            self.paste_shortcut = "ctrlV".to_string();
        }
    }

    fn normalize_windows_sendinput_newline_mode(&mut self) {
        if !matches!(
            self.windows_sendinput_newline_mode.as_str(),
            "enter" | "shiftEnter" | "crlf"
        ) {
            self.windows_sendinput_newline_mode = "enter".to_string();
        }
    }

    fn normalize_history_settings(&mut self) {
        self.history_retention_days = self.history_retention_days.min(MAX_HISTORY_RETENTION_DAYS);
        self.history_max_entries = self
            .history_max_entries
            .clamp(1, DEFAULT_HISTORY_MAX_ENTRIES);
    }

    pub fn history_retention_policy(&self) -> HistoryRetentionPolicy {
        HistoryRetentionPolicy {
            enabled: self.history_enabled,
            max_entries: self.history_max_entries,
            retention_days: self.history_retention_days,
        }
    }

    pub fn from_stored_value(value: serde_json::Value) -> Result<Self, serde_json::Error> {
        let mut value = value;
        if let Some(object) = value.as_object_mut() {
            if object
                .get("system_scene_overrides")
                .is_some_and(serde_json::Value::is_null)
            {
                object.insert(
                    "system_scene_overrides".to_string(),
                    serde_json::Value::Array(Vec::new()),
                );
            }
        }
        let has_capsule_auto_hide = value
            .as_object()
            .is_some_and(|object| object.contains_key("capsule_auto_hide"));
        let has_insertion_strategy = value
            .as_object()
            .is_some_and(|object| object.contains_key("insertion_strategy"));
        let has_hotkeys = value
            .as_object()
            .is_some_and(|object| object.contains_key("hotkeys"));
        let has_translation = value
            .as_object()
            .is_some_and(|object| object.contains_key("translation"));
        let has_legacy_target = value
            .as_object()
            .is_some_and(|object| object.contains_key("target_lang"));
        let mut config: Self = serde_json::from_value(value)?;
        if !has_translation {
            config.translation = TranslationConfig::from_legacy(&config.target_lang);
        } else if !has_legacy_target {
            config.target_lang = config.translation.active_target.clone();
        }
        if !has_capsule_auto_hide {
            config.capsule_auto_hide = false;
        }
        if !has_insertion_strategy {
            config.insertion_strategy =
                insertion_strategy_from_legacy_output_mode(&config.output_mode).to_string();
        }
        if !has_hotkeys {
            config.migrate_legacy_platform_hotkeys();
            config.hotkeys =
                HotkeyConfig::from_legacy(&config.hotkey, &config.ask_hotkey, &config.hotkey_mode);
        } else {
            config.sync_legacy_hotkey_fields_from_typed();
        }
        config.normalize_values();
        Ok(config)
    }
}

fn default_dictation_hotkey() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Fn"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Ctrl+/"
    }
}

fn default_dictation_hotkey_mode() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "toggle"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "hold"
    }
}

fn default_ask_hotkey() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Fn+Space"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Ctrl+."
    }
}

fn default_translate_hotkey() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        Some("Fn+LeftShift")
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some("Ctrl+Shift+/")
    }
}

fn normalize_hotkey_mode(value: &str) -> &'static str {
    if value == "toggle" {
        "toggle"
    } else {
        "hold"
    }
}

fn binding_from_hotkey_string(value: &str) -> Option<ShortcutBinding> {
    let parts: Vec<&str> = value
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }

    let primary = normalize_hotkey_primary(parts.last()?)?;
    let mut modifiers = Vec::new();
    let mut seen_semantic = HashSet::new();
    for part in &parts[..parts.len() - 1] {
        let (semantic, canonical) = normalize_hotkey_modifier(part)?;
        if !seen_semantic.insert(semantic) {
            return None;
        }
        modifiers.push(canonical.to_string());
    }

    modifiers.sort_by_key(|modifier| hotkey_modifier_rank(modifier));
    Some(ShortcutBinding { primary, modifiers })
}

fn normalize_optional_binding(binding: &mut Option<ShortcutBinding>) {
    if let Some(value) = binding.as_mut() {
        if !value.normalize() {
            *binding = None;
        }
    }
}

fn normalize_hotkey_modifier(value: &str) -> Option<(&'static str, &'static str)> {
    match value.trim().to_lowercase().as_str() {
        "fn" | "function" => Some(("fn", "Fn")),
        "rightalt" | "right_alt" | "right-alt" | "altright" | "alt_right" | "alt-right" => {
            Some(("rightalt", "RightAlt"))
        }
        "ctrl" | "control" => Some(("ctrl", "Ctrl")),
        "shift" => Some(("shift", "Shift")),
        "alt" => Some(("alt", "Alt")),
        "option" => Some(("alt", "Option")),
        "meta" | "super" | "win" => Some(("super", "Super")),
        "cmd" | "command" => Some(("super", "Command")),
        _ => None,
    }
}

fn hotkey_modifier_rank(value: &str) -> u8 {
    match value {
        "Fn" | "RightAlt" => 0,
        "Command" | "Super" => 0,
        "Ctrl" => 1,
        "Option" | "Alt" => 2,
        "Shift" => 3,
        _ => 9,
    }
}

fn normalize_hotkey_primary(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = match trimmed.to_lowercase().as_str() {
        "space" => "Space".to_string(),
        "tab" => "Tab".to_string(),
        "enter" | "return" => "Enter".to_string(),
        "backspace" => "Backspace".to_string(),
        "escape" | "esc" => "Escape".to_string(),
        "delete" => "Delete".to_string(),
        "insert" => "Insert".to_string(),
        "home" => "Home".to_string(),
        "end" => "End".to_string(),
        "leftshift" | "left_shift" | "left-shift" | "shiftleft" | "shift_left" | "shift-left" => {
            "LeftShift".to_string()
        }
        "pageup" => "PageUp".to_string(),
        "pagedown" => "PageDown".to_string(),
        "arrowup" | "up" => "Up".to_string(),
        "arrowdown" | "down" => "Down".to_string(),
        "arrowleft" | "left" => "Left".to_string(),
        "arrowright" | "right" => "Right".to_string(),
        "fn" | "function" => "Fn".to_string(),
        "rightalt" | "right_alt" | "right-alt" | "altright" | "alt_right" | "alt-right" => {
            "RightAlt".to_string()
        }
        "slash" | "/" => "/".to_string(),
        "backslash" | "\\" => "\\".to_string(),
        "period" | "." | "。" => ".".to_string(),
        "comma" | "," => ",".to_string(),
        "semicolon" | ";" => ";".to_string(),
        "quote" | "'" => "'".to_string(),
        "backquote" | "`" => "`".to_string(),
        "minus" | "-" => "-".to_string(),
        "equal" | "=" => "=".to_string(),
        "bracketleft" | "[" => "[".to_string(),
        "bracketright" | "]" => "]".to_string(),
        other
            if matches!(
                other,
                "f1" | "f2"
                    | "f3"
                    | "f4"
                    | "f5"
                    | "f6"
                    | "f7"
                    | "f8"
                    | "f9"
                    | "f10"
                    | "f11"
                    | "f12"
            ) =>
        {
            other.to_uppercase()
        }
        other if other.len() == 1 => {
            let ch = other.chars().next()?;
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase().to_string()
            } else {
                return None;
            }
        }
        _ => return None,
    };

    Some(normalized)
}

fn insertion_strategy_from_legacy_output_mode(output_mode: &str) -> &'static str {
    if output_mode == "clipboard" {
        "clipboardPaste"
    } else {
        "auto"
    }
}

fn legacy_output_mode_for_insertion_strategy(strategy: &str) -> &'static str {
    match strategy {
        "clipboardPaste" | "clipboardCopyOnly" => "clipboard",
        _ => "keyboard",
    }
}

const POLISH_CUSTOM_PROMPT_MAX_CHARS: usize = 2000;

fn normalize_polish_style(value: &str) -> &'static str {
    match value.trim() {
        "minimal" => "minimal",
        "clean" => "clean",
        "structured" => "structured",
        "professional" => "professional",
        _ => "clean",
    }
}

fn sanitize_polish_custom_prompt(value: &str) -> String {
    value
        .replace('\0', "")
        .trim()
        .chars()
        .take(POLISH_CUSTOM_PROMPT_MAX_CHARS)
        .collect()
}

fn sanitize_scene_string(value: &str, max_chars: usize) -> String {
    value
        .replace('\0', "")
        .trim()
        .chars()
        .take(max_chars)
        .collect()
}

fn sanitize_custom_scenes(scenes: &mut Vec<CustomScene>) {
    for scene in scenes.iter_mut() {
        scene.id = sanitize_scene_string(&scene.id, SCENE_ID_MAX_CHARS);
        scene.name = sanitize_scene_string(&scene.name, SCENE_NAME_MAX_CHARS);
        scene.description = sanitize_scene_string(&scene.description, SCENE_DESCRIPTION_MAX_CHARS);
        scene.prompt_template =
            sanitize_scene_string(&scene.prompt_template, SCENE_PROMPT_MAX_CHARS);
        scene.created_at = sanitize_scene_string(&scene.created_at, SCENE_ID_MAX_CHARS);
        scene.updated_at = sanitize_scene_string(&scene.updated_at, SCENE_ID_MAX_CHARS);
    }
    scenes.retain(|scene| {
        !scene.id.is_empty() && !scene.name.is_empty() && !scene.prompt_template.is_empty()
    });
    scenes.truncate(CUSTOM_SCENES_MAX_COUNT);
}

fn system_scene_prompt(scene_id: &str) -> Option<&'static str> {
    match scene_id {
        "system_email" => Some(
            "Email system mode: produce an email body when there is enough content. Use a greeting when the recipient is spoken, concise body paragraphs, and a light closing when appropriate. Do not generate a subject unless explicitly requested.",
        ),
        "system_work_chat" => Some(
            "Work chat system mode: keep it casual and concise. Use short sentences or simple line breaks when helpful. No greeting or sign-off.",
        ),
        "system_personal_chat" => Some(
            "Personal chat system mode: keep the user's casual voice and short-message rhythm; do not turn it into business writing.",
        ),
        "system_document" => Some(
            "Document system mode: use coherent paragraphs. Use short headings or bullet points when the spoken structure has sections, takeaways, or multiple items.",
        ),
        "system_project_management" => Some(
            "Project update system mode: format as a compact update with bullets for progress, blockers, and next steps when spoken. Do not invent owners, deadlines, or ticket fields.",
        ),
        "system_developer_collaboration" => Some(
            "Engineering note system mode: format as a concise review or engineering note. Use bullets for issue, impact, and suggestion when helpful. Preserve technical identifiers exactly.",
        ),
        "system_prompt_or_code" => Some(
            "Prompt/code system mode: make the spoken request explicit and usable. Use compact bullets for goal, constraints, and output shape when implied, but never invent code or unstated requirements.",
        ),
        "system_support" => Some(
            "Support reply system mode: write a clear, empathetic reply. Use short paragraphs or numbered steps when next actions are spoken. Do not invent policy, refund, or resolution claims.",
        ),
        "system_social" => Some(
            "Social post system mode: keep the user's voice and make it readable as a short post. No hashtags, emoji, or calls to action unless spoken.",
        ),
        _ => None,
    }
}

fn sanitize_system_scene_overrides(overrides: &mut Vec<SystemSceneOverride>) {
    let mut seen = HashSet::new();
    for item in overrides.iter_mut() {
        item.id = sanitize_scene_string(&item.id, SCENE_ID_MAX_CHARS);
        item.prompt_template = sanitize_scene_string(&item.prompt_template, SCENE_PROMPT_MAX_CHARS);
    }
    overrides.retain(|item| {
        !item.prompt_template.is_empty()
            && system_scene_prompt(&item.id).is_some()
            && seen.insert(item.id.clone())
    });
}

fn sanitize_active_scene(active_scene: &mut Option<ActiveScene>) {
    if let Some(scene) = active_scene.as_mut() {
        scene.id = sanitize_scene_string(&scene.id, SCENE_ID_MAX_CHARS);
        scene.source = sanitize_scene_string(&scene.source, SCENE_SOURCE_MAX_CHARS);
        scene.name = sanitize_scene_string(&scene.name, SCENE_NAME_MAX_CHARS);
        scene.prompt_template =
            sanitize_scene_string(&scene.prompt_template, SCENE_PROMPT_MAX_CHARS);

        if scene.id.is_empty()
            || scene.source.is_empty()
            || scene.name.is_empty()
            || scene.prompt_template.is_empty()
        {
            *active_scene = None;
        }
    }
}

fn builtin_scene_prompt(scene_id: &str) -> Option<&'static str> {
    match scene_id {
        "builtin_clean_dictation" => Some(
            "Lightly clean the transcript for readability while preserving the speaker meaning, wording choices, and factual content. Do not add new information.",
        ),
        "builtin_meeting_notes" => Some(
            "Rewrite the transcript as concise meeting notes with clear bullets, decisions, and action items. Preserve factual content and do not invent details.",
        ),
        "builtin_professional_email" => Some(
            "Rewrite the transcript as a concise professional email body. Use a greeting when the recipient is spoken, clear body paragraphs, and a light closing when appropriate. Do not add facts or generate a subject unless requested.",
        ),
        "builtin_support_reply" => Some(
            "Rewrite the transcript as a helpful customer support reply. Acknowledge the issue, give clear next steps, and avoid promising anything not stated.",
        ),
        "builtin_technical_explanation" => Some(
            "Rewrite the transcript as a clear technical explanation. Preserve precise terms, organize the reasoning, and avoid oversimplifying important details.",
        ),
        "builtin_code_comment" => Some(
            "Rewrite the transcript as a concise code review comment or inline engineering note. Keep it specific, actionable, and respectful.",
        ),
        "builtin_product_spec_notes" => Some(
            "Rewrite the transcript as product spec notes with goals, requirements, edge cases, and open questions. Do not invent decisions that were not spoken.",
        ),
        _ => None,
    }
}

pub(crate) fn scene_prompt_for_id(config: &AppConfig, scene_id: &str) -> Option<String> {
    let scene_id = scene_id.trim();
    config
        .system_scene_overrides
        .iter()
        .find(|scene| scene.id == scene_id)
        .map(|scene| scene.prompt_template.clone())
        .or_else(|| system_scene_prompt(scene_id).map(str::to_string))
        .or_else(|| builtin_scene_prompt(scene_id).map(str::to_string))
        .or_else(|| {
            config
                .custom_scenes
                .iter()
                .find(|scene| scene.id == scene_id)
                .map(|scene| scene.prompt_template.clone())
        })
}

fn default_system_scene_id_for_family(family: ContextFamily) -> Option<&'static str> {
    match family {
        ContextFamily::Email => Some("system_email"),
        ContextFamily::WorkChat => Some("system_work_chat"),
        ContextFamily::PersonalChat => Some("system_personal_chat"),
        ContextFamily::Document => Some("system_document"),
        ContextFamily::ProjectManagement => Some("system_project_management"),
        ContextFamily::DeveloperCollaboration => Some("system_developer_collaboration"),
        ContextFamily::PromptOrCode => Some("system_prompt_or_code"),
        ContextFamily::Support => Some("system_support"),
        ContextFamily::Social => Some("system_social"),
        ContextFamily::General => None,
    }
}

pub(crate) fn family_scene_prompt(config: &AppConfig, family: ContextFamily) -> Option<String> {
    let scene_id = config
        .family_scene_assignments
        .iter()
        .find(|assignment| assignment.family == family)
        .map(|assignment| assignment.scene_id.as_str())
        .or_else(|| default_system_scene_id_for_family(family))?;
    scene_prompt_for_id(config, scene_id)
}

pub(crate) fn automatic_scene_prompt(
    config: &AppConfig,
    family: ContextFamily,
    mapped_scene_id: Option<&str>,
) -> Option<String> {
    if config.active_scene.is_some() {
        return None;
    }

    mapped_scene_id
        .and_then(|scene_id| scene_prompt_for_id(config, scene_id))
        .or_else(|| family_scene_prompt(config, family))
}

fn sanitize_family_scene_assignments(
    assignments: &mut Vec<FamilySceneAssignment>,
    custom_scenes: &[CustomScene],
    system_scene_overrides: &[SystemSceneOverride],
) {
    let valid_custom_ids: HashSet<&str> = custom_scenes
        .iter()
        .map(|scene| scene.id.as_str())
        .collect();
    let mut seen_families = HashSet::new();

    for assignment in assignments.iter_mut() {
        assignment.scene_id = sanitize_scene_string(&assignment.scene_id, SCENE_ID_MAX_CHARS);
    }
    assignments.retain(|assignment| {
        !assignment.scene_id.is_empty()
            && (builtin_scene_prompt(&assignment.scene_id).is_some()
                || system_scene_prompt(&assignment.scene_id).is_some()
                || system_scene_overrides
                    .iter()
                    .any(|scene| scene.id == assignment.scene_id)
                || valid_custom_ids.contains(assignment.scene_id.as_str()))
            && seen_families.insert(assignment.family)
    });
}

// ─── ConfigManager (tauri-plugin-store backed) ───

pub struct ConfigManager {
    app_handle: tauri::AppHandle,
    cache: Mutex<Option<AppConfig>>,
}

impl ConfigManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            app_handle,
            cache: Mutex::new(None),
        }
    }

    pub async fn load(&self) -> Result<AppConfig> {
        if let Some(config) = self.cache.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            return Ok(config);
        }

        let mut config = match self.app_handle.store("settings.json") {
            Ok(store) => match store.get("app_config") {
                Some(val) => AppConfig::from_stored_value(val.clone())
                    .unwrap_or_else(|_| AppConfig::new_install_default()),
                None => AppConfig::new_install_default(),
            },
            Err(_) => AppConfig::new_install_default(),
        };

        self.migrate_legacy_config_secrets_on_load(&mut config);

        *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(config.clone());
        Ok(config)
    }

    pub async fn save(&self, config: &AppConfig) -> Result<()> {
        let mut config = config.clone();
        config.normalize_values();
        config
            .validate_provider_endpoints()
            .map_err(anyhow::Error::msg)?;
        let report = migrate_legacy_config_secrets(&mut config, &SystemCredentialVault)?;
        if !report.migrated.is_empty() {
            tracing::info!(
                migrated_credentials = report.migrated.len(),
                "Migrated legacy config credentials before saving settings"
            );
        }
        *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(config.clone());

        self.persist_config(&config)?;

        Ok(())
    }

    fn migrate_legacy_config_secrets_on_load(&self, config: &mut AppConfig) {
        match migrate_legacy_config_secrets(config, &SystemCredentialVault) {
            Ok(report) if !report.migrated.is_empty() => {
                tracing::info!(
                    migrated_credentials = report.migrated.len(),
                    "Migrated legacy config credentials to system credential vault"
                );
                if let Err(error) = self.persist_config(config) {
                    tracing::warn!("Failed to persist sanitized settings after migration: {error}");
                }
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(
                    "Failed to migrate legacy config credentials; keeping plaintext settings until a later retry: {error}"
                );
            }
        }
    }

    fn persist_config(&self, config: &AppConfig) -> Result<()> {
        let store = self
            .app_handle
            .store("settings.json")
            .map_err(|e| anyhow::anyhow!("Failed to open store: {}", e))?;
        let val = serde_json::to_value(config)?;
        store.set("app_config", val);
        store.save().map_err(|e| anyhow::anyhow!("{}", e))?;

        Ok(())
    }
}

// ─── HistoryStore (SQLite backed) ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub created_at: String,
    pub context_profile_id: String,
    pub context_label: String,
    pub context_icon_key: String,
    pub context_family: ContextFamily,
    pub browser_access_status: BrowserAccessStatus,
    pub provider_kind: HistoryProviderKind,
    pub raw_text: String,
    pub polished_text: String,
    pub language: Option<String>,
    pub duration_ms: Option<i64>,
    pub stt_ms: Option<i64>,
    pub llm_ms: Option<i64>,
    pub total_ms: Option<i64>,
    pub active_scene_id: Option<String>,
    pub active_scene_source: Option<String>,
    pub active_scene_name: Option<String>,
    pub active_scene_prompt_chars: Option<i64>,
    pub active_scene_prompt_truncated: bool,
    pub output_status: Option<String>,
    pub output_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRangeMetrics {
    pub recording_ms: i64,
    pub saved_transcriptions: u64,
    /// Unicode code points, including whitespace, in retained output that was
    /// classified as automatically inserted or delivered through a fallback.
    pub output_chars: i64,
    pub active_days: u64,
    /// Non-empty output with an explicit inserted/completed/success status
    /// and no recorded error. Legacy null statuses remain unclassified.
    pub successful_automatic_insertions: u64,
    pub recorded_fallbacks: u64,
    /// Explicit failed/prevented/cancelled outcomes, or a diagnostic outcome
    /// that produced no application output.
    pub recorded_failures: u64,
    /// Rows whose stored output fields are sufficient to classify as an
    /// automatic insertion, fallback, or failure.
    pub output_outcome_sample_count: u64,
    pub transformed_outputs: u64,
    /// Saved History rows with a positive duration no longer than the
    /// implausible-duration ceiling.
    pub valid_duration_sample_count: u64,
    /// Saved History rows whose duration is missing, non-positive, or longer
    /// than the implausible-duration ceiling.
    pub excluded_duration_count: u64,
    pub average_total_ms: Option<f64>,
    /// Nearest-rank percentiles of bounded stop-to-output latency samples.
    pub p50_total_ms: Option<i64>,
    pub p95_total_ms: Option<i64>,
    pub timing_sample_count: u64,
    pub excluded_timing_count: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalActivityMetricsSummary {
    pub day: ActivityRangeMetrics,
    pub week: ActivityRangeMetrics,
    pub month: ActivityRangeMetrics,
    pub total_recordings: u64,
    /// Valid duration samples across all retained History, not only the
    /// current month.
    pub valid_duration_sample_count: u64,
    /// Missing, non-positive, and implausibly long durations across all
    /// retained History, not only the current month.
    pub excluded_duration_count: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionTimeStats {
    pub day_ms: i64,
    pub week_ms: i64,
    pub month_ms: i64,
    pub excluded_count: i64,
}

/// Durations longer than this are preserved in History for investigation but
/// excluded from the homepage aggregate. A background or stuck session must
/// not turn one recording into an implausible multi-day usage total.
pub const MAX_COUNTED_TRANSCRIPTION_DURATION_MS: i64 = 12 * 60 * 60 * 1_000;

/// Stop-to-output timing values above one hour remain in History for
/// diagnostics, but are not allowed to distort Home latency percentiles.
pub const MAX_COUNTED_TURNAROUND_MS: i64 = 60 * 60 * 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryProviderKind {
    ManagedCloud,
    Byok,
    Local,
}

impl HistoryProviderKind {
    fn as_db_value(self) -> &'static str {
        match self {
            Self::ManagedCloud => "managed_cloud",
            Self::Byok => "byok",
            Self::Local => "local",
        }
    }

    fn from_db_value(value: &str) -> Self {
        match value {
            "managed_cloud" => Self::ManagedCloud,
            "byok" => Self::Byok,
            _ => Self::Local,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryRetentionPolicy {
    pub enabled: bool,
    pub max_entries: u32,
    /// 0 means keep indefinitely by age.
    pub retention_days: u32,
}

impl Default for HistoryRetentionPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_entries: DEFAULT_HISTORY_MAX_ENTRIES,
            retention_days: 0,
        }
    }
}

pub struct HistoryStore {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone)]
pub struct BackupSnapshot {
    pub history: Vec<HistoryEntry>,
    pub dictionary: Vec<DictionaryEntry>,
    pub correction_rules: Vec<CorrectionRule>,
}

/// Runs the exact size and dictionary/rule validators used by restore without
/// opening a write transaction or mutating any persisted data.
pub fn validate_backup_restore_data(
    history: Option<&[HistoryEntry]>,
    dictionary: Option<&[DictionaryEntry]>,
    correction_rules: Option<&[CorrectionRule]>,
) -> Result<()> {
    if history.is_some_and(|entries| entries.len() > DEFAULT_HISTORY_MAX_ENTRIES as usize) {
        anyhow::bail!("backup_history_too_large");
    }
    if let Some(entries) = dictionary {
        prepare_backup_dictionary(entries.to_vec())?;
    }
    if let Some(entries) = correction_rules {
        prepare_backup_correction_rules(entries.to_vec())?;
    }
    Ok(())
}

impl HistoryStore {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                app_name TEXT NOT NULL DEFAULT '',
                app_type TEXT NOT NULL DEFAULT '',
                context_profile_id TEXT NOT NULL DEFAULT 'general.native',
                context_label TEXT NOT NULL DEFAULT 'General',
                context_icon_key TEXT NOT NULL DEFAULT 'general',
                context_family TEXT NOT NULL DEFAULT 'general',
                browser_access_status TEXT,
                provider_kind TEXT NOT NULL DEFAULT 'local',
                raw_text TEXT NOT NULL DEFAULT '',
                polished_text TEXT NOT NULL DEFAULT '',
                language TEXT,
                duration_ms INTEGER,
                stt_ms INTEGER,
                llm_ms INTEGER,
                total_ms INTEGER,
                active_scene_id TEXT,
                active_scene_source TEXT,
                active_scene_name TEXT,
                active_scene_prompt_chars INTEGER,
                active_scene_prompt_truncated INTEGER NOT NULL DEFAULT 0,
                output_status TEXT,
                output_error TEXT
            );",
        )?;
        ensure_history_optional_columns(&conn)?;
        migrate_legacy_history_context(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn add(&self, entry: HistoryEntry) -> Result<()> {
        self.add_with_policy(entry, &HistoryRetentionPolicy::default())
            .await
    }

    pub async fn add_with_policy(
        &self,
        entry: HistoryEntry,
        policy: &HistoryRetentionPolicy,
    ) -> Result<()> {
        if !policy.enabled {
            return Ok(());
        }

        let now_iso = entry.created_at.clone();
        {
            let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            conn.execute(
                "INSERT INTO history (
                    created_at,
                    app_name,
                    app_type,
                    context_profile_id,
                    context_label,
                    context_icon_key,
                    context_family,
                    browser_access_status,
                    provider_kind,
                    raw_text,
                    polished_text,
                    language,
                    duration_ms,
                    stt_ms,
                    llm_ms,
                    total_ms,
                    active_scene_id,
                    active_scene_source,
                    active_scene_name,
                    active_scene_prompt_chars,
                    active_scene_prompt_truncated,
                    output_status,
                    output_error
                )
             VALUES (?1, '', '', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                rusqlite::params![
                    entry.created_at,
                    entry.context_profile_id,
                    entry.context_label,
                    entry.context_icon_key,
                    context_family_db_value(entry.context_family),
                    entry.browser_access_status.as_history_value(),
                    entry.provider_kind.as_db_value(),
                    entry.raw_text,
                    entry.polished_text,
                    entry.language,
                    entry.duration_ms,
                    entry.stt_ms,
                    entry.llm_ms,
                    entry.total_ms,
                    entry.active_scene_id,
                    entry.active_scene_source,
                    entry.active_scene_name,
                    entry.active_scene_prompt_chars,
                    entry.active_scene_prompt_truncated,
                    entry.output_status,
                    entry.output_error,
                ],
            )?;
        }

        self.prune_with_policy(policy, &now_iso).await?;
        Ok(())
    }

    pub async fn prune_with_policy(
        &self,
        policy: &HistoryRetentionPolicy,
        now_iso: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if !policy.enabled {
            conn.execute("DELETE FROM history", [])?;
            return Ok(());
        }

        let max_entries = policy.max_entries.clamp(1, DEFAULT_HISTORY_MAX_ENTRIES);
        conn.execute(
            "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?1)",
            rusqlite::params![max_entries],
        )?;

        if policy.retention_days > 0 {
            if let Ok(now) = chrono::NaiveDateTime::parse_from_str(now_iso, "%Y-%m-%dT%H:%M:%S") {
                let cutoff = now - chrono::Duration::days(policy.retention_days as i64);
                let cutoff_iso = cutoff.format("%Y-%m-%dT%H:%M:%S").to_string();
                conn.execute(
                    "DELETE FROM history WHERE created_at < ?1",
                    rusqlite::params![cutoff_iso],
                )?;
            }
        }

        Ok(())
    }

    pub async fn list(&self, limit: u32, offset: u32) -> Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT
                id,
                created_at,
                context_profile_id,
                context_label,
                context_icon_key,
                context_family,
                browser_access_status,
                provider_kind,
                raw_text,
                polished_text,
                language,
                duration_ms,
                stt_ms,
                llm_ms,
                total_ms,
                active_scene_id,
                active_scene_source,
                active_scene_name,
                active_scene_prompt_chars,
                active_scene_prompt_truncated,
                output_status,
                output_error
             FROM history ORDER BY id DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit, offset], history_entry_from_row)?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub async fn count(&self) -> Result<u64> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let count = conn.query_row("SELECT COUNT(*) FROM history", [], |row| {
            row.get::<_, u64>(0)
        })?;
        Ok(count)
    }

    /// Reads every cloud-backup section from one SQLite read transaction.
    ///
    /// History, dictionary entries, and correction rules share this database.
    /// Keeping the reads in one transaction prevents a concurrent write from
    /// producing a mixed-generation backup. Explicit caps and exact-count
    /// checks fail closed instead of silently uploading a partial snapshot.
    pub async fn export_backup_snapshot(&self) -> Result<BackupSnapshot> {
        let mut conn = self.conn.lock().unwrap_or_else(|error| error.into_inner());
        let transaction = conn.transaction()?;

        let history_count = backup_snapshot_count(&transaction, "SELECT COUNT(*) FROM history")?;
        let dictionary_count =
            backup_snapshot_count(&transaction, "SELECT COUNT(*) FROM dictionary")?;
        let correction_count =
            backup_snapshot_count(&transaction, "SELECT COUNT(*) FROM correction_rules")?;

        ensure_backup_snapshot_bound(
            history_count,
            DEFAULT_HISTORY_MAX_ENTRIES as usize,
            "backup_history_too_large",
        )?;
        ensure_backup_snapshot_bound(
            dictionary_count,
            MAX_BACKUP_DICTIONARY_ENTRIES,
            "backup_dictionary_too_large",
        )?;
        ensure_backup_snapshot_bound(
            correction_count,
            MAX_BACKUP_CORRECTION_RULES,
            "backup_corrections_too_large",
        )?;

        let history = read_backup_history(&transaction, history_count)?;
        let dictionary = read_backup_dictionary(&transaction, dictionary_count)?;
        let correction_rules = read_backup_corrections(&transaction, correction_count)?;
        transaction.commit()?;

        Ok(BackupSnapshot {
            history,
            dictionary,
            correction_rules,
        })
    }

    pub async fn local_activity_metrics(
        &self,
        day_start: &str,
        week_start: &str,
        month_start: &str,
        now: &str,
    ) -> Result<LocalActivityMetricsSummary> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let day = activity_range_metrics(&conn, day_start, now)?;
        let week = activity_range_metrics(&conn, week_start, now)?;
        let month = activity_range_metrics(&conn, month_start, now)?;
        let (total_recordings, valid_duration_sample_count, excluded_duration_count) = conn
            .query_row(
                "SELECT
                    COUNT(*),
                    COALESCE(SUM(CASE
                        WHEN duration_ms > 0 AND duration_ms <= ?1 THEN 1
                        ELSE 0
                    END), 0),
                    COALESCE(SUM(CASE
                        WHEN duration_ms IS NULL OR duration_ms <= 0 OR duration_ms > ?1 THEN 1
                        ELSE 0
                    END), 0)
                 FROM history",
                rusqlite::params![MAX_COUNTED_TRANSCRIPTION_DURATION_MS],
                |row| {
                    Ok((
                        row.get::<_, u64>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, u64>(2)?,
                    ))
                },
            )?;

        Ok(LocalActivityMetricsSummary {
            day,
            week,
            month,
            total_recordings,
            valid_duration_sample_count,
            excluded_duration_count,
        })
    }

    pub async fn transcription_time_stats(
        &self,
        day_start: &str,
        week_start: &str,
        month_start: &str,
    ) -> Result<TranscriptionTimeStats> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let stats = conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN created_at >= ?1 AND duration_ms > 0 AND duration_ms <= ?4 THEN duration_ms ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN created_at >= ?2 AND duration_ms > 0 AND duration_ms <= ?4 THEN duration_ms ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN created_at >= ?3 AND duration_ms > 0 AND duration_ms <= ?4 THEN duration_ms ELSE 0 END), 0),
                COALESCE(SUM(CASE
                    WHEN created_at >= ?3
                        AND (duration_ms IS NULL OR duration_ms <= 0 OR duration_ms > ?4)
                    THEN 1 ELSE 0
                END), 0)
             FROM history",
            rusqlite::params![
                day_start,
                week_start,
                month_start,
                MAX_COUNTED_TRANSCRIPTION_DURATION_MS
            ],
            |row| {
                Ok(TranscriptionTimeStats {
                    day_ms: row.get(0)?,
                    week_ms: row.get(1)?,
                    month_ms: row.get(2)?,
                    excluded_count: row.get(3)?,
                })
            },
        )?;
        if stats.excluded_count > 0 {
            tracing::warn!(
                excluded_count = stats.excluded_count,
                maximum_counted_ms = MAX_COUNTED_TRANSCRIPTION_DURATION_MS,
                "Excluded missing, invalid, or implausibly long durations from transcription-time statistics"
            );
        }
        Ok(stats)
    }

    pub async fn clear(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    /// Restores cloud backup sections in one SQLite transaction. Dictionary and
    /// correction rows live in the same database, so using the history
    /// connection here prevents a partially restored local data set.
    pub async fn restore_backup_data(
        &self,
        history: Option<Vec<HistoryEntry>>,
        dictionary: Option<Vec<DictionaryEntry>>,
        correction_rules: Option<Vec<CorrectionRule>>,
        policy: &HistoryRetentionPolicy,
        now_iso: &str,
    ) -> Result<()> {
        validate_backup_restore_data(
            history.as_deref(),
            dictionary.as_deref(),
            correction_rules.as_deref(),
        )?;
        let dictionary = dictionary.map(prepare_backup_dictionary).transpose()?;
        let correction_rules = correction_rules
            .map(prepare_backup_correction_rules)
            .transpose()?;

        let mut conn = self.conn.lock().unwrap_or_else(|error| error.into_inner());
        let transaction = conn.transaction()?;

        if let Some(entries) = history {
            transaction.execute("DELETE FROM history", [])?;
            if policy.enabled {
                let max_entries = policy.max_entries.clamp(1, DEFAULT_HISTORY_MAX_ENTRIES) as usize;
                let cutoff = if policy.retention_days > 0 {
                    chrono::NaiveDateTime::parse_from_str(now_iso, "%Y-%m-%dT%H:%M:%S")
                        .ok()
                        .map(|now| now - chrono::Duration::days(policy.retention_days as i64))
                } else {
                    None
                };
                let mut entries = entries
                    .into_iter()
                    .filter(|entry| {
                        cutoff.is_none_or(|cutoff| {
                            chrono::NaiveDateTime::parse_from_str(
                                &entry.created_at,
                                "%Y-%m-%dT%H:%M:%S",
                            )
                            .is_ok_and(|created_at| created_at >= cutoff)
                        })
                    })
                    .take(max_entries)
                    .collect::<Vec<_>>();
                entries.reverse();
                for entry in entries {
                    transaction.execute(
                        "INSERT INTO history (
                            created_at,
                            app_name,
                            app_type,
                            context_profile_id,
                            context_label,
                            context_icon_key,
                            context_family,
                            browser_access_status,
                            provider_kind,
                            raw_text,
                            polished_text,
                            language,
                            duration_ms,
                            stt_ms,
                            llm_ms,
                            total_ms,
                            active_scene_id,
                            active_scene_source,
                            active_scene_name,
                            active_scene_prompt_chars,
                            active_scene_prompt_truncated,
                            output_status,
                            output_error
                        ) VALUES (?1, '', '', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                        rusqlite::params![
                            entry.created_at,
                            entry.context_profile_id,
                            entry.context_label,
                            entry.context_icon_key,
                            context_family_db_value(entry.context_family),
                            entry.browser_access_status.as_history_value(),
                            entry.provider_kind.as_db_value(),
                            entry.raw_text,
                            entry.polished_text,
                            entry.language,
                            entry.duration_ms,
                            entry.stt_ms,
                            entry.llm_ms,
                            entry.total_ms,
                            entry.active_scene_id,
                            entry.active_scene_source,
                            entry.active_scene_name,
                            entry.active_scene_prompt_chars,
                            entry.active_scene_prompt_truncated,
                            entry.output_status,
                            entry.output_error,
                        ],
                    )?;
                }
            }
        }

        if let Some(entries) = dictionary {
            transaction.execute("DELETE FROM dictionary", [])?;
            for (word, pronunciation) in entries {
                transaction.execute(
                    "INSERT INTO dictionary (word, pronunciation) VALUES (?1, ?2)",
                    rusqlite::params![word, pronunciation],
                )?;
            }
        }

        if let Some(rules) = correction_rules {
            transaction.execute("DELETE FROM correction_rules", [])?;
            for (pattern, replacement, enabled) in rules {
                transaction.execute(
                    "INSERT INTO correction_rules (pattern, replacement, enabled) VALUES (?1, ?2, ?3)",
                    rusqlite::params![pattern, replacement, if enabled { 1 } else { 0 }],
                )?;
            }
        }

        transaction.commit()?;
        Ok(())
    }
}

fn history_entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        created_at: row.get(1)?,
        context_profile_id: row.get(2)?,
        context_label: row.get(3)?,
        context_icon_key: row.get(4)?,
        context_family: context_family_from_db(&row.get::<_, String>(5)?),
        browser_access_status: BrowserAccessStatus::from_history_value(
            row.get::<_, Option<String>>(6)?.as_deref(),
        ),
        provider_kind: HistoryProviderKind::from_db_value(&row.get::<_, String>(7)?),
        raw_text: row.get(8)?,
        polished_text: row.get(9)?,
        language: row.get(10)?,
        duration_ms: row.get(11)?,
        stt_ms: row.get(12)?,
        llm_ms: row.get(13)?,
        total_ms: row.get(14)?,
        active_scene_id: row.get(15)?,
        active_scene_source: row.get(16)?,
        active_scene_name: row.get(17)?,
        active_scene_prompt_chars: row.get(18)?,
        active_scene_prompt_truncated: row.get(19)?,
        output_status: row.get(20)?,
        output_error: row.get(21)?,
    })
}

fn backup_snapshot_count(conn: &Connection, query: &str) -> Result<usize> {
    let count = conn.query_row(query, [], |row| row.get::<_, u64>(0))?;
    Ok(usize::try_from(count)?)
}

fn ensure_backup_snapshot_bound(count: usize, maximum: usize, error: &str) -> Result<()> {
    if count > maximum {
        anyhow::bail!("{}", error);
    }
    Ok(())
}

fn read_backup_history(conn: &Connection, expected_count: usize) -> Result<Vec<HistoryEntry>> {
    let mut statement = conn.prepare(
        "SELECT
            id,
            created_at,
            context_profile_id,
            context_label,
            context_icon_key,
            context_family,
            browser_access_status,
            provider_kind,
            raw_text,
            polished_text,
            language,
            duration_ms,
            stt_ms,
            llm_ms,
            total_ms,
            active_scene_id,
            active_scene_source,
            active_scene_name,
            active_scene_prompt_chars,
            active_scene_prompt_truncated,
            output_status,
            output_error
         FROM history
         ORDER BY id DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(
        rusqlite::params![DEFAULT_HISTORY_MAX_ENTRIES],
        history_entry_from_row,
    )?;
    let entries = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    ensure_backup_snapshot_complete(entries.len(), expected_count)?;
    Ok(entries)
}

fn read_backup_dictionary(
    conn: &Connection,
    expected_count: usize,
) -> Result<Vec<DictionaryEntry>> {
    let mut statement = conn.prepare(
        "SELECT id, word, pronunciation
         FROM dictionary
         ORDER BY id ASC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(
        rusqlite::params![MAX_BACKUP_DICTIONARY_ENTRIES as i64],
        |row| {
            Ok(DictionaryEntry {
                id: row.get(0)?,
                word: row.get(1)?,
                pronunciation: row.get(2)?,
            })
        },
    )?;
    let entries = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    ensure_backup_snapshot_complete(entries.len(), expected_count)?;
    Ok(entries)
}

fn read_backup_corrections(
    conn: &Connection,
    expected_count: usize,
) -> Result<Vec<CorrectionRule>> {
    let mut statement = conn.prepare(
        "SELECT id, pattern, replacement, enabled
         FROM correction_rules
         ORDER BY id ASC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(
        rusqlite::params![MAX_BACKUP_CORRECTION_RULES as i64],
        |row| {
            Ok(CorrectionRule {
                id: row.get(0)?,
                pattern: row.get(1)?,
                replacement: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
            })
        },
    )?;
    let entries = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    ensure_backup_snapshot_complete(entries.len(), expected_count)?;
    Ok(entries)
}

fn ensure_backup_snapshot_complete(actual: usize, expected: usize) -> Result<()> {
    if actual != expected {
        anyhow::bail!("backup_snapshot_incomplete");
    }
    Ok(())
}

fn activity_range_metrics(
    conn: &Connection,
    start: &str,
    now: &str,
) -> Result<ActivityRangeMetrics> {
    let mut metrics = conn.query_row(
        "WITH classified AS (
            SELECT
                *,
                CASE
                    WHEN length(trim(polished_text)) > 0
                        AND output_error IS NULL
                        AND (
                            lower(trim(output_status)) IN ('inserted', 'completed', 'success')
                        ) THEN 1
                    ELSE 0
                END AS automatic_success,
                CASE
                    WHEN lower(trim(COALESCE(output_status, ''))) IN (
                            'failed', 'prevented', 'cancelled'
                        )
                        OR (
                            length(trim(polished_text)) = 0
                            AND (output_status IS NOT NULL OR output_error IS NOT NULL)
                        ) THEN 1
                    ELSE 0
                END AS recorded_failure
            FROM history
            WHERE created_at >= ?1 AND created_at <= ?2
         ), outcomes AS (
            SELECT
                *,
                CASE
                    WHEN length(trim(polished_text)) > 0
                        AND automatic_success = 0
                        AND recorded_failure = 0
                        AND (output_status IS NOT NULL OR output_error IS NOT NULL) THEN 1
                    ELSE 0
                END AS recorded_fallback
            FROM classified
         )
         SELECT
            COALESCE(SUM(CASE
                WHEN duration_ms > 0 AND duration_ms <= ?3 THEN duration_ms
                ELSE 0
            END), 0),
            COUNT(*),
            COALESCE(SUM(CASE
                WHEN automatic_success = 1 OR recorded_fallback = 1
                    THEN length(polished_text)
                ELSE 0
            END), 0),
            COUNT(DISTINCT substr(created_at, 1, 10)),
            COALESCE(SUM(automatic_success), 0),
            COALESCE(SUM(recorded_fallback), 0),
            COALESCE(SUM(recorded_failure), 0),
            COALESCE(SUM(automatic_success + recorded_fallback + recorded_failure), 0),
            COALESCE(SUM(CASE
                WHEN automatic_success = 1
                    AND length(trim(polished_text)) > 0
                    AND trim(raw_text) <> trim(polished_text) THEN 1
                ELSE 0
            END), 0),
            COALESCE(SUM(CASE
                WHEN duration_ms > 0 AND duration_ms <= ?3 THEN 1
                ELSE 0
            END), 0),
            COALESCE(SUM(CASE
                WHEN duration_ms IS NULL OR duration_ms <= 0 OR duration_ms > ?3 THEN 1
                ELSE 0
            END), 0),
            AVG(CASE
                WHEN length(trim(polished_text)) > 0
                    AND recorded_failure = 0
                    AND total_ms >= 0
                    AND total_ms <= ?4 THEN total_ms
            END),
            COALESCE(SUM(CASE
                WHEN length(trim(polished_text)) > 0
                    AND recorded_failure = 0
                    AND total_ms >= 0
                    AND total_ms <= ?4 THEN 1
                ELSE 0
            END), 0),
            COALESCE(SUM(CASE
                WHEN length(trim(polished_text)) > 0
                    AND recorded_failure = 0
                    AND total_ms IS NOT NULL
                    AND (total_ms < 0 OR total_ms > ?4) THEN 1
                ELSE 0
            END), 0)
         FROM outcomes",
        rusqlite::params![
            start,
            now,
            MAX_COUNTED_TRANSCRIPTION_DURATION_MS,
            MAX_COUNTED_TURNAROUND_MS
        ],
        |row| {
            Ok(ActivityRangeMetrics {
                recording_ms: row.get(0)?,
                saved_transcriptions: row.get(1)?,
                output_chars: row.get(2)?,
                active_days: row.get(3)?,
                successful_automatic_insertions: row.get(4)?,
                recorded_fallbacks: row.get(5)?,
                recorded_failures: row.get(6)?,
                output_outcome_sample_count: row.get(7)?,
                transformed_outputs: row.get(8)?,
                valid_duration_sample_count: row.get(9)?,
                excluded_duration_count: row.get(10)?,
                average_total_ms: row.get(11)?,
                p50_total_ms: None,
                p95_total_ms: None,
                timing_sample_count: row.get(12)?,
                excluded_timing_count: row.get(13)?,
            })
        },
    )?;

    (metrics.p50_total_ms, metrics.p95_total_ms) =
        bounded_turnaround_percentiles(conn, start, now)?;
    Ok(metrics)
}

fn bounded_turnaround_percentiles(
    conn: &Connection,
    start: &str,
    now: &str,
) -> Result<(Option<i64>, Option<i64>)> {
    let mut statement = conn.prepare(
        "SELECT total_ms
         FROM history
         WHERE created_at >= ?1
            AND created_at <= ?2
            AND length(trim(polished_text)) > 0
            AND lower(trim(COALESCE(output_status, ''))) NOT IN (
                'failed', 'prevented', 'cancelled'
            )
            AND total_ms >= 0
            AND total_ms <= ?3
         ORDER BY total_ms ASC",
    )?;
    let samples = statement
        .query_map(
            rusqlite::params![start, now, MAX_COUNTED_TURNAROUND_MS],
            |row| row.get::<_, i64>(0),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok((
        nearest_rank_percentile(&samples, 50),
        nearest_rank_percentile(&samples, 95),
    ))
}

fn nearest_rank_percentile(sorted_samples: &[i64], percentile: usize) -> Option<i64> {
    if sorted_samples.is_empty() {
        return None;
    }

    let rank = sorted_samples
        .len()
        .saturating_mul(percentile)
        .saturating_add(99)
        / 100;
    sorted_samples.get(rank.saturating_sub(1)).copied()
}

fn prepare_backup_dictionary(
    entries: Vec<DictionaryEntry>,
) -> Result<Vec<(String, Option<String>)>> {
    if entries.len() > MAX_BACKUP_DICTIONARY_ENTRIES {
        anyhow::bail!("backup_dictionary_too_large");
    }
    let mut seen = HashSet::new();
    let mut prepared = Vec::with_capacity(entries.len());
    for entry in entries {
        let word = validate_dictionary_text(&entry.word, 100, "dictionary_word")?;
        let pronunciation = entry
            .pronunciation
            .as_deref()
            .map(|value| validate_dictionary_text(value, 100, "dictionary_pronunciation"))
            .transpose()?
            .filter(|value| !value.is_empty());
        if seen.insert(normalized_dictionary_identity(&word)) {
            prepared.push((word, pronunciation));
        }
    }
    Ok(prepared)
}

fn prepare_backup_correction_rules(
    entries: Vec<CorrectionRule>,
) -> Result<Vec<(String, String, bool)>> {
    if entries.len() > MAX_BACKUP_CORRECTION_RULES {
        anyhow::bail!("backup_corrections_too_large");
    }
    let mut seen = HashSet::new();
    let mut prepared = Vec::with_capacity(entries.len());
    for entry in entries {
        let pattern = validate_dictionary_text(&entry.pattern, 120, "correction_pattern")?;
        let replacement =
            validate_dictionary_text(&entry.replacement, 120, "correction_replacement")?;
        if seen.insert(normalized_correction_identity(&pattern, &replacement)) {
            prepared.push((pattern, replacement, entry.enabled));
        }
    }
    Ok(prepared)
}

fn ensure_history_optional_columns(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(history)")?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<std::collections::HashSet<_>, _>>()?;

    for (name, ddl) in [
        ("active_scene_id", "ALTER TABLE history ADD COLUMN active_scene_id TEXT"),
        (
            "active_scene_source",
            "ALTER TABLE history ADD COLUMN active_scene_source TEXT",
        ),
        (
            "active_scene_name",
            "ALTER TABLE history ADD COLUMN active_scene_name TEXT",
        ),
        (
            "active_scene_prompt_chars",
            "ALTER TABLE history ADD COLUMN active_scene_prompt_chars INTEGER",
        ),
        (
            "active_scene_prompt_truncated",
            "ALTER TABLE history ADD COLUMN active_scene_prompt_truncated INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "output_status",
            "ALTER TABLE history ADD COLUMN output_status TEXT",
        ),
        (
            "output_error",
            "ALTER TABLE history ADD COLUMN output_error TEXT",
        ),
        (
            "context_profile_id",
            "ALTER TABLE history ADD COLUMN context_profile_id TEXT NOT NULL DEFAULT 'general.native'",
        ),
        (
            "context_label",
            "ALTER TABLE history ADD COLUMN context_label TEXT NOT NULL DEFAULT 'General'",
        ),
        (
            "context_icon_key",
            "ALTER TABLE history ADD COLUMN context_icon_key TEXT NOT NULL DEFAULT 'general'",
        ),
        (
            "context_family",
            "ALTER TABLE history ADD COLUMN context_family TEXT NOT NULL DEFAULT 'general'",
        ),
        (
            "browser_access_status",
            "ALTER TABLE history ADD COLUMN browser_access_status TEXT",
        ),
        (
            "provider_kind",
            "ALTER TABLE history ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'local'",
        ),
        ("stt_ms", "ALTER TABLE history ADD COLUMN stt_ms INTEGER"),
        ("llm_ms", "ALTER TABLE history ADD COLUMN llm_ms INTEGER"),
        ("total_ms", "ALTER TABLE history ADD COLUMN total_ms INTEGER"),
    ] {
        if !columns.contains(name) {
            conn.execute(ddl, [])?;
        }
    }

    Ok(())
}

fn migrate_legacy_history_context(conn: &Connection) -> Result<()> {
    let registry = AppRegistry::builtin().map_err(anyhow::Error::msg)?;
    let rows = {
        let mut statement = conn.prepare(
            "SELECT id, app_name, app_type FROM history WHERE app_name <> '' OR app_type <> ''",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    if rows.is_empty() {
        return Ok(());
    }

    let transaction = conn.unchecked_transaction()?;
    for (id, app_name, _app_type) in rows {
        let profile = legacy_profile_for_name(&registry, &app_name)
            .unwrap_or_else(ContextProfile::general_native);
        transaction.execute(
            "UPDATE history SET
                context_profile_id = ?1,
                context_label = ?2,
                context_icon_key = ?3,
                context_family = ?4,
                provider_kind = 'local',
                app_name = '',
                app_type = ''
             WHERE id = ?5",
            rusqlite::params![
                profile.id,
                profile.app_label,
                profile.icon_key,
                context_family_db_value(profile.family),
                id,
            ],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

fn legacy_profile_for_name(registry: &AppRegistry, app_name: &str) -> Option<ContextProfile> {
    let normalized = app_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }

    registry.definitions().iter().find_map(|definition| {
        let matches = definition.app_label.eq_ignore_ascii_case(&normalized)
            || definition
                .native_identities
                .iter()
                .chain(definition.process_aliases.iter())
                .any(|value| value.eq_ignore_ascii_case(&normalized));
        matches.then(|| registry.profile(&definition.id)).flatten()
    })
}

fn context_family_db_value(family: ContextFamily) -> &'static str {
    match family {
        ContextFamily::Email => "email",
        ContextFamily::WorkChat => "work_chat",
        ContextFamily::PersonalChat => "personal_chat",
        ContextFamily::Document => "document",
        ContextFamily::ProjectManagement => "project_management",
        ContextFamily::DeveloperCollaboration => "developer_collaboration",
        ContextFamily::PromptOrCode => "prompt_or_code",
        ContextFamily::Support => "support",
        ContextFamily::Social => "social",
        ContextFamily::General => "general",
    }
}

fn context_family_from_db(value: &str) -> ContextFamily {
    match value {
        "email" => ContextFamily::Email,
        "work_chat" => ContextFamily::WorkChat,
        "personal_chat" => ContextFamily::PersonalChat,
        "document" => ContextFamily::Document,
        "project_management" => ContextFamily::ProjectManagement,
        "developer_collaboration" => ContextFamily::DeveloperCollaboration,
        "prompt_or_code" => ContextFamily::PromptOrCode,
        "support" => ContextFamily::Support,
        "social" => ContextFamily::Social,
        _ => ContextFamily::General,
    }
}

// ─── DictionaryStore (SQLite backed) ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub id: i64,
    pub word: String,
    pub pronunciation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CorrectionRule {
    pub id: i64,
    pub pattern: String,
    pub replacement: String,
    pub enabled: bool,
}

pub struct DictionaryStore {
    conn: Mutex<Connection>,
}

impl DictionaryStore {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS dictionary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT NOT NULL,
                pronunciation TEXT
            );
            CREATE TABLE IF NOT EXISTS correction_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern TEXT NOT NULL,
                replacement TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn add(&self, word: &str, pronunciation: Option<&str>) -> Result<()> {
        let word = validate_dictionary_text(word, 100, "dictionary_word")?;
        let pronunciation = pronunciation
            .map(|value| validate_dictionary_text(value, 100, "dictionary_pronunciation"))
            .transpose()?
            .filter(|value| !value.is_empty());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if dictionary_identity_exists(&conn, &normalized_dictionary_identity(&word), None)? {
            anyhow::bail!("dictionary_duplicate");
        }
        conn.execute(
            "INSERT INTO dictionary (word, pronunciation) VALUES (?1, ?2)",
            rusqlite::params![word, pronunciation],
        )?;
        Ok(())
    }

    pub async fn update(&self, id: i64, word: &str, pronunciation: Option<&str>) -> Result<()> {
        let word = validate_dictionary_text(word, 100, "dictionary_word")?;
        let pronunciation = pronunciation
            .map(|value| validate_dictionary_text(value, 100, "dictionary_pronunciation"))
            .transpose()?
            .filter(|value| !value.is_empty());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if dictionary_identity_exists(&conn, &normalized_dictionary_identity(&word), Some(id))? {
            anyhow::bail!("dictionary_duplicate");
        }
        let updated = conn.execute(
            "UPDATE dictionary SET word = ?2, pronunciation = ?3 WHERE id = ?1",
            rusqlite::params![id, word, pronunciation],
        )?;
        if updated == 0 {
            anyhow::bail!("dictionary_entry_not_found");
        }
        Ok(())
    }

    pub async fn remove(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "DELETE FROM dictionary WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<DictionaryEntry>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt =
            conn.prepare("SELECT id, word, pronunciation FROM dictionary ORDER BY id ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(DictionaryEntry {
                id: row.get(0)?,
                word: row.get(1)?,
                pronunciation: row.get(2)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub async fn words(&self) -> Vec<String> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = match conn.prepare("SELECT word FROM dictionary") {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };
        rows.filter_map(|r| r.ok()).collect()
    }

    pub async fn add_correction(&self, pattern: &str, replacement: &str) -> Result<()> {
        let pattern = validate_dictionary_text(pattern, 120, "correction_pattern")?;
        let replacement = validate_dictionary_text(replacement, 120, "correction_replacement")?;
        let identity = normalized_correction_identity(&pattern, &replacement);
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if correction_identity_exists(&conn, &identity, None)? {
            anyhow::bail!("correction_duplicate");
        }
        conn.execute(
            "INSERT INTO correction_rules (pattern, replacement, enabled) VALUES (?1, ?2, 1)",
            rusqlite::params![pattern, replacement],
        )?;
        Ok(())
    }

    pub async fn update_correction(
        &self,
        id: i64,
        pattern: &str,
        replacement: &str,
        enabled: bool,
    ) -> Result<()> {
        let pattern = validate_dictionary_text(pattern, 120, "correction_pattern")?;
        let replacement = validate_dictionary_text(replacement, 120, "correction_replacement")?;
        let identity = normalized_correction_identity(&pattern, &replacement);
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if correction_identity_exists(&conn, &identity, Some(id))? {
            anyhow::bail!("correction_duplicate");
        }
        let updated = conn.execute(
            "UPDATE correction_rules
             SET pattern = ?2, replacement = ?3, enabled = ?4
             WHERE id = ?1",
            rusqlite::params![id, pattern, replacement, if enabled { 1 } else { 0 }],
        )?;
        if updated == 0 {
            anyhow::bail!("correction_rule_not_found");
        }
        Ok(())
    }

    pub async fn remove_correction(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "DELETE FROM correction_rules WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub async fn set_correction_enabled(&self, id: i64, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "UPDATE correction_rules SET enabled = ?2 WHERE id = ?1",
            rusqlite::params![id, if enabled { 1 } else { 0 }],
        )?;
        Ok(())
    }

    pub async fn correction_rules(&self) -> Result<Vec<CorrectionRule>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, pattern, replacement, enabled FROM correction_rules ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(CorrectionRule {
                id: row.get(0)?,
                pattern: row.get(1)?,
                replacement: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub async fn enabled_correction_rules(&self) -> Vec<CorrectionRule> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = match conn.prepare(
            "SELECT id, pattern, replacement, enabled FROM correction_rules WHERE enabled = 1 ORDER BY id ASC LIMIT 100",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map([], |row| {
            Ok(CorrectionRule {
                id: row.get(0)?,
                pattern: row.get(1)?,
                replacement: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
            })
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };
        rows.filter_map(|r| r.ok()).collect()
    }

    pub(crate) fn with_transaction<T>(
        &self,
        operation: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        let mut conn = self.conn.lock().unwrap_or_else(|error| error.into_inner());
        let transaction = conn.transaction()?;
        let result = operation(&transaction)?;
        transaction.commit()?;
        Ok(result)
    }

    #[cfg(test)]
    pub(crate) fn execute_batch_for_test(&self, sql: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|error| error.into_inner());
        conn.execute_batch(sql)?;
        Ok(())
    }
}

pub(crate) fn normalized_dictionary_identity(value: &str) -> String {
    value.nfkc().collect::<String>().trim().to_lowercase()
}

pub(crate) fn normalized_correction_identity(pattern: &str, replacement: &str) -> (String, String) {
    (
        normalized_dictionary_identity(pattern),
        normalized_dictionary_identity(replacement),
    )
}

fn validate_dictionary_text(value: &str, max_chars: usize, field: &str) -> Result<String> {
    let value = value.replace('\0', "").trim().to_string();
    if value.is_empty() {
        anyhow::bail!("{field}_empty");
    }
    if value.chars().count() > max_chars {
        anyhow::bail!("{field}_too_long");
    }
    Ok(value)
}

fn dictionary_identity_exists(
    conn: &Connection,
    identity: &str,
    excluding_id: Option<i64>,
) -> Result<bool> {
    let mut statement = conn.prepare("SELECT id, word FROM dictionary")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (id, word) = row?;
        if Some(id) != excluding_id && normalized_dictionary_identity(&word) == identity {
            return Ok(true);
        }
    }
    Ok(false)
}

fn correction_identity_exists(
    conn: &Connection,
    identity: &(String, String),
    excluding_id: Option<i64>,
) -> Result<bool> {
    let mut statement = conn.prepare("SELECT id, pattern, replacement FROM correction_rules")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (id, pattern, replacement) = row?;
        if Some(id) != excluding_id
            && normalized_correction_identity(&pattern, &replacement) == *identity
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_config_defaults_missing_custom_stt_api_key() {
        let value = serde_json::json!({
            "stt_provider": "deepgram",
            "stt_api_key": "hosted-secret"
        });

        let config: AppConfig = serde_json::from_value(value).unwrap();

        assert_eq!(config.stt_provider, "deepgram");
        assert_eq!(config.stt_api_key, "hosted-secret");
        assert_eq!(config.stt_custom_api_key, "");
        assert_eq!(
            config.stt_volcengine_resource_id,
            crate::stt::volcengine::VOLCENGINE_SEEDASR_RESOURCE_ID
        );
    }

    #[test]
    fn app_config_defaults_missing_polish_preferences() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "stt_api_key": "",
            "stt_language": "multi",
            "llm_provider": "openrouter",
            "llm_api_key": "",
            "llm_model": "google/gemini-2.5-flash",
            "llm_base_url": "https://openrouter.ai/api/v1",
            "polish_enabled": true,
            "translate_enabled": false,
            "target_lang": "en",
            "hotkey": "Ctrl+/",
            "hotkey_mode": "hold",
            "output_mode": "keyboard",
            "selected_text_enabled": false,
            "theme": "system",
            "auto_start": false,
            "close_to_tray": true,
            "start_minimized": false,
            "max_recording_seconds": 30,
            "ui_language": "en"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.polish_custom_prompt, "");
        assert_eq!(config.polish_chinese_script, "preserve");
        assert_eq!(config.polish_style, "clean");
    }

    #[test]
    fn app_config_voice_routing_flags_migrate_on_and_preserve_independent_kill_switches() {
        let missing = AppConfig::from_stored_value(serde_json::json!({})).unwrap();
        assert_eq!(
            missing.voice_routing_flags,
            crate::voice_intent::VoiceRoutingFlags::default()
        );

        let mut partial_value = serde_json::to_value(AppConfig::default()).unwrap();
        partial_value["voice_routing_flags"] = serde_json::json!({
            "draft_insert": false
        });
        let partial = AppConfig::from_stored_value(partial_value).unwrap();
        assert_eq!(
            partial.voice_routing_flags,
            crate::voice_intent::VoiceRoutingFlags {
                draft_insert: false,
                rewrite_selection: true,
                translate_selection: true,
                search: true,
            }
        );
    }

    #[test]
    fn translation_config_migrates_legacy_target_and_enforces_ordered_invariants() {
        let legacy = AppConfig::from_stored_value(serde_json::json!({
            "target_lang": "ja"
        }))
        .unwrap();
        assert_eq!(
            legacy.translation,
            TranslationConfig {
                targets: vec!["ja".to_string()],
                active_target: "ja".to_string(),
            }
        );
        assert_eq!(legacy.target_lang, "ja");

        let normalized = AppConfig::from_stored_value(serde_json::json!({
            "target_lang": "de",
            "translation": {
                "targets": [" FR ", "fr", "xx", "ja", "de", "es", "pt", "it"],
                "active_target": "ko"
            }
        }))
        .unwrap();
        assert_eq!(
            normalized.translation.targets,
            ["fr", "ja", "de", "es", "pt"]
        );
        assert_eq!(normalized.translation.active_target, "de");
        assert_eq!(normalized.target_lang, "de");

        let empty = AppConfig::from_stored_value(serde_json::json!({
            "target_lang": "xx",
            "translation": {
                "targets": [],
                "active_target": "xx"
            }
        }))
        .unwrap();
        assert_eq!(empty.translation.targets, ["en"]);
        assert_eq!(empty.translation.active_target, "en");
        assert_eq!(serde_json::to_value(&empty).unwrap()["target_lang"], "en");
    }

    #[test]
    fn app_config_preserves_valid_polish_style() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["polish_style"] = serde_json::json!("structured");

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.polish_style, "structured");
    }

    #[test]
    fn app_config_normalizes_invalid_polish_style_to_clean() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["polish_style"] = serde_json::json!("marketplace-pack");

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.polish_style, "clean");
    }

    #[test]
    fn app_config_defaults_missing_clipboard_restore_preferences() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "output_mode": "clipboard"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert!(config.restore_clipboard_after_paste);
        assert_eq!(config.paste_shortcut, "ctrlV");
    }

    #[test]
    fn app_config_defaults_and_normalizes_history_privacy_settings() {
        let default_value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter"
        });
        let default_config = AppConfig::from_stored_value(default_value).unwrap();
        assert!(default_config.history_enabled);
        assert_eq!(default_config.history_retention_days, 0);
        assert_eq!(default_config.history_max_entries, 5000);

        let invalid_value = serde_json::json!({
            "history_enabled": true,
            "history_retention_days": 99999,
            "history_max_entries": 99999
        });
        let invalid_config = AppConfig::from_stored_value(invalid_value).unwrap();
        assert_eq!(invalid_config.history_retention_days, 3650);
        assert_eq!(invalid_config.history_max_entries, 5000);
    }

    #[test]
    fn shortcut_binding_accepts_native_single_key_triggers() {
        let fn_binding = ShortcutBinding::from_hotkey("Fn").expect("Fn parses");
        assert_eq!(fn_binding.primary, "Fn");
        assert!(fn_binding.modifiers.is_empty());
        assert_eq!(fn_binding.to_hotkey_string().as_deref(), Some("Fn"));

        let right_alt = ShortcutBinding::from_hotkey("RightAlt").expect("RightAlt parses");
        assert_eq!(right_alt.primary, "RightAlt");
        assert!(right_alt.modifiers.is_empty());
        assert_eq!(right_alt.to_hotkey_string().as_deref(), Some("RightAlt"));
    }

    #[test]
    fn shortcut_binding_accepts_native_mode_shortcuts() {
        let ask = ShortcutBinding::from_hotkey("Fn+Space").expect("Fn+Space parses");
        assert_eq!(ask.primary, "Space");
        assert_eq!(ask.modifiers, vec!["Fn".to_string()]);
        assert_eq!(ask.to_hotkey_string().as_deref(), Some("Fn+Space"));

        let translate =
            ShortcutBinding::from_hotkey("RightAlt+LeftShift").expect("RightAlt+LeftShift parses");
        assert_eq!(translate.primary, "LeftShift");
        assert_eq!(translate.modifiers, vec!["RightAlt".to_string()]);
        assert_eq!(
            translate.to_hotkey_string().as_deref(),
            Some("RightAlt+LeftShift")
        );
    }

    #[test]
    fn app_config_defaults_streaming_insert_to_disabled() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert!(!config.streaming_insert_enabled);
    }

    #[test]
    fn app_config_migrates_legacy_keyboard_output_to_auto_insertion_strategy() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "output_mode": "keyboard"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.insertion_strategy, "auto");
        assert_eq!(config.output_mode, "keyboard");
    }

    #[test]
    fn app_config_migrates_legacy_clipboard_output_to_clipboard_paste_strategy() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "output_mode": "clipboard"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.insertion_strategy, "clipboardPaste");
        assert_eq!(config.output_mode, "clipboard");
    }

    #[test]
    fn app_config_migrates_legacy_hotkeys_to_typed_config() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "hotkey": "Ctrl+Shift+;",
            "ask_hotkey": "Ctrl+Alt+.",
            "hotkey_mode": "toggle"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(
            config.hotkeys.dictation,
            ShortcutBinding {
                primary: ";".to_string(),
                modifiers: vec!["Ctrl".to_string(), "Shift".to_string()],
            }
        );
        assert_eq!(
            config.hotkeys.ask,
            Some(ShortcutBinding {
                primary: ".".to_string(),
                modifiers: vec!["Ctrl".to_string(), "Alt".to_string()],
            })
        );
        assert_eq!(config.hotkeys.dictation_mode, "toggle");
        assert_eq!(config.hotkey, "Ctrl+Shift+;");
        assert_eq!(config.ask_hotkey, "Ctrl+Alt+.");
        assert_eq!(config.hotkey_mode, "toggle");
    }

    #[test]
    fn app_config_uses_typed_hotkeys_when_present() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "hotkey": "Ctrl+/",
            "ask_hotkey": "Ctrl+.",
            "hotkey_mode": "hold",
            "hotkeys": {
                "dictation": { "primary": "-", "modifiers": ["Ctrl", "Shift"] },
                "ask": { "primary": ".", "modifiers": ["Ctrl"] },
                "translate": null,
                "editSelection": null,
                "switchScene": null,
                "openApp": null,
                "dictationMode": "toggle"
            }
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.hotkey, "Ctrl+Shift+-");
        assert_eq!(config.ask_hotkey, "Ctrl+.");
        assert_eq!(config.hotkey_mode, "toggle");
        assert_eq!(config.hotkeys.dictation.primary, "-");
        assert_eq!(config.hotkeys.dictation.modifiers, vec!["Ctrl", "Shift"]);
    }

    #[test]
    fn app_config_preserves_extended_typed_hotkey_roles_when_present() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "hotkey": "Ctrl+/",
            "ask_hotkey": "Ctrl+.",
            "hotkey_mode": "hold",
            "hotkeys": {
                "dictation": { "primary": "-", "modifiers": ["Ctrl", "Shift"] },
                "ask": null,
                "translate": { "primary": "T", "modifiers": ["Ctrl", "Shift"] },
                "editSelection": { "primary": "E", "modifiers": ["Ctrl", "Shift"] },
                "switchScene": { "primary": "S", "modifiers": ["Ctrl", "Shift"] },
                "openApp": { "primary": "O", "modifiers": ["Ctrl", "Shift"] },
                "dictationMode": "toggle"
            }
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.hotkey, "Ctrl+Shift+-");
        assert_eq!(config.ask_hotkey, "");
        assert_eq!(config.hotkeys.ask, None);
        assert_eq!(
            config.hotkeys.translate,
            Some(ShortcutBinding {
                primary: "T".to_string(),
                modifiers: vec!["Ctrl".to_string(), "Shift".to_string()],
            })
        );
        assert_eq!(
            config.hotkeys.edit_selection,
            Some(ShortcutBinding {
                primary: "E".to_string(),
                modifiers: vec!["Ctrl".to_string(), "Shift".to_string()],
            })
        );
        assert_eq!(
            config.hotkeys.switch_scene,
            Some(ShortcutBinding {
                primary: "S".to_string(),
                modifiers: vec!["Ctrl".to_string(), "Shift".to_string()],
            })
        );
        assert_eq!(
            config.hotkeys.open_app,
            Some(ShortcutBinding {
                primary: "O".to_string(),
                modifiers: vec!["Ctrl".to_string(), "Shift".to_string()],
            })
        );
    }

    #[test]
    fn hotkey_binding_lists_migrate_legacy_scalars_and_mirror_primaries() {
        let config = AppConfig::from_stored_value(serde_json::json!({
            "hotkey": "Ctrl+Shift+;",
            "ask_hotkey": "Ctrl+Alt+.",
            "hotkey_mode": "toggle"
        }))
        .unwrap();

        assert_eq!(
            config.hotkeys.dictation_bindings,
            vec![config.hotkeys.dictation.clone()]
        );
        assert_eq!(
            config.hotkeys.ask_bindings,
            vec![config.hotkeys.ask.clone().unwrap()]
        );
        assert!(config.hotkeys.translate_bindings.is_empty());
        assert_eq!(config.hotkey, "Ctrl+Shift+;");
        assert_eq!(config.ask_hotkey, "Ctrl+Alt+.");
    }

    #[test]
    fn hotkey_binding_lists_normalize_dedupe_clamp_and_preserve_order() {
        let config = AppConfig::from_stored_value(serde_json::json!({
            "hotkey": "Ctrl+/",
            "ask_hotkey": "Ctrl+.",
            "hotkeys": {
                "dictation": { "primary": "/", "modifiers": ["Ctrl"] },
                "ask": { "primary": ".", "modifiers": ["Ctrl"] },
                "translate": null,
                "dictationBindings": [
                    { "primary": ";", "modifiers": ["shift", "control"] },
                    { "primary": ";", "modifiers": ["Ctrl", "Shift"] },
                    { "primary": "D", "modifiers": ["Alt"] },
                    { "primary": "F8", "modifiers": [] },
                    { "primary": "F9", "modifiers": [] }
                ],
                "askBindings": [
                    { "primary": "A", "modifiers": ["Option"] },
                    { "primary": "A", "modifiers": ["Alt"] }
                ],
                "translateBindings": [],
                "editSelection": null,
                "switchScene": null,
                "openApp": null,
                "dictationMode": "hold"
            }
        }))
        .unwrap();

        assert_eq!(config.hotkeys.dictation_bindings.len(), 3);
        assert_eq!(
            config.hotkeys.dictation_bindings[0]
                .to_hotkey_string()
                .as_deref(),
            Some("Ctrl+Shift+;")
        );
        assert_eq!(
            config.hotkeys.dictation_bindings[1]
                .to_hotkey_string()
                .as_deref(),
            Some("Alt+D")
        );
        assert_eq!(
            config.hotkeys.dictation_bindings[2]
                .to_hotkey_string()
                .as_deref(),
            Some("F8")
        );
        assert_eq!(config.hotkey, "Ctrl+Shift+;");
        assert_eq!(config.hotkeys.ask_bindings.len(), 1);
        assert_eq!(config.ask_hotkey, "Option+A");
        assert_eq!(
            config.hotkeys.dictation,
            config.hotkeys.dictation_bindings[0]
        );
        assert_eq!(
            config.hotkeys.ask.as_ref(),
            config.hotkeys.ask_bindings.first()
        );
    }

    #[test]
    fn hotkey_binding_lists_drop_corruption_and_keep_dictation_nonempty() {
        let config = AppConfig::from_stored_value(serde_json::json!({
            "hotkey": "Ctrl+/",
            "ask_hotkey": "Ctrl+.",
            "hotkeys": {
                "dictation": { "primary": "/", "modifiers": ["Ctrl"] },
                "ask": { "primary": ".", "modifiers": ["Ctrl"] },
                "translate": null,
                "dictationBindings": [
                    { "primary": "", "modifiers": ["Ctrl"] }
                ],
                "askBindings": [
                    { "primary": ".", "modifiers": ["Ctrl", "Ctrl"] }
                ],
                "translateBindings": [
                    { "primary": "T", "modifiers": ["shift", "control"] }
                ],
                "editSelection": null,
                "switchScene": null,
                "openApp": null,
                "dictationMode": "hold"
            }
        }))
        .unwrap();

        assert_eq!(config.hotkeys.dictation_bindings.len(), 1);
        assert_eq!(
            config.hotkeys.dictation_bindings[0]
                .to_hotkey_string()
                .as_deref(),
            Some(default_dictation_hotkey())
        );
        assert!(config.hotkeys.ask_bindings.is_empty());
        assert_eq!(config.ask_hotkey, "");
        assert_eq!(
            config.hotkeys.translate_bindings[0]
                .to_hotkey_string()
                .as_deref(),
            Some("Ctrl+Shift+T")
        );
    }

    #[test]
    fn hotkey_binding_lists_survive_restart_and_export_legacy_primary_fields() {
        let mut original = AppConfig::default();
        original.hotkeys.dictation_bindings = vec![
            ShortcutBinding::from_hotkey("Ctrl+Shift+D").unwrap(),
            ShortcutBinding::from_hotkey("F8").unwrap(),
        ];
        original.hotkeys.ask_bindings = Vec::new();
        original.hotkeys.ask = None;
        original.hotkeys.translate_bindings = vec![
            ShortcutBinding::from_hotkey("Ctrl+Shift+T").unwrap(),
            ShortcutBinding::from_hotkey("F9").unwrap(),
        ];
        original.normalize_values();

        let stored = serde_json::to_value(&original).unwrap();
        assert_eq!(stored["hotkey"], "Ctrl+Shift+D");
        assert_eq!(stored["ask_hotkey"], "");
        assert_eq!(stored["hotkeys"]["dictation"]["primary"], "D");
        assert_eq!(
            stored["hotkeys"]["dictationBindings"]
                .as_array()
                .unwrap()
                .len(),
            2
        );

        let restarted = AppConfig::from_stored_value(stored).unwrap();
        assert_eq!(
            restarted.hotkeys.dictation_bindings,
            original.hotkeys.dictation_bindings
        );
        assert_eq!(
            restarted.hotkeys.ask_bindings,
            original.hotkeys.ask_bindings
        );
        assert_eq!(
            restarted.hotkeys.translate_bindings,
            original.hotkeys.translate_bindings
        );
    }

    #[test]
    fn app_config_preserves_explicit_copy_only_insertion_strategy() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "output_mode": "keyboard",
            "insertion_strategy": "clipboardCopyOnly"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.insertion_strategy, "clipboardCopyOnly");
        assert_eq!(config.output_mode, "clipboard");
    }

    #[test]
    fn app_config_defaults_and_normalizes_windows_sendinput_newline_mode() {
        let default_value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter"
        });
        let default_config = AppConfig::from_stored_value(default_value).unwrap();
        assert_eq!(default_config.windows_sendinput_newline_mode, "enter");

        let explicit_value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "windows_sendinput_newline_mode": "shiftEnter"
        });
        let explicit_config = AppConfig::from_stored_value(explicit_value).unwrap();
        assert_eq!(explicit_config.windows_sendinput_newline_mode, "shiftEnter");

        let invalid_value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter",
            "windows_sendinput_newline_mode": "invalid"
        });
        let invalid_config = AppConfig::from_stored_value(invalid_value).unwrap();
        assert_eq!(invalid_config.windows_sendinput_newline_mode, "enter");
    }

    #[test]
    fn app_config_normalizes_recording_limit_and_preserves_manual_stop() {
        let mut manual = AppConfig {
            max_recording_seconds: 0,
            ..Default::default()
        };
        manual.normalize_values();
        assert_eq!(manual.max_recording_seconds, 0);

        let mut too_short = AppConfig {
            max_recording_seconds: 1,
            ..Default::default()
        };
        too_short.normalize_values();
        assert_eq!(too_short.max_recording_seconds, 5);

        let mut too_long = AppConfig {
            max_recording_seconds: 10_000,
            ..Default::default()
        };
        too_long.normalize_values();
        assert_eq!(too_long.max_recording_seconds, 720);
    }

    #[test]
    fn app_config_defaults_missing_custom_scenes() {
        let value = serde_json::json!({
            "stt_provider": "glm-asr",
            "llm_provider": "openrouter"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert!(config.custom_scenes.is_empty());
        assert!(config.active_scene.is_none());
        assert!(config.family_scene_assignments.is_empty());
    }

    #[test]
    fn app_config_sanitizes_family_scene_assignments_against_available_scenes() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["custom_scenes"] = serde_json::json!([
            {
                "id": "custom_focus",
                "name": "Focus",
                "description": "",
                "prompt_template": "Use short status bullets.",
                "created_at": "",
                "updated_at": ""
            }
        ]);
        value["family_scene_assignments"] = serde_json::json!([
            { "family": "email", "scene_id": "  builtin_professional_email  " },
            { "family": "email", "scene_id": "builtin_clean_dictation" },
            { "family": "work_chat", "scene_id": "custom_focus" },
            { "family": "support", "scene_id": "missing_scene" },
            { "family": "general", "scene_id": "\0" }
        ]);

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(
            config.family_scene_assignments,
            vec![
                FamilySceneAssignment {
                    family: ContextFamily::Email,
                    scene_id: "builtin_professional_email".to_string(),
                },
                FamilySceneAssignment {
                    family: ContextFamily::WorkChat,
                    scene_id: "custom_focus".to_string(),
                },
            ]
        );
    }

    #[test]
    fn scene_prompt_resolution_supports_builtins_custom_scenes_and_compat_family_lookup() {
        let mut config = AppConfig::default();
        config.custom_scenes.push(CustomScene {
            id: "custom_focus".to_string(),
            name: "Focus".to_string(),
            description: String::new(),
            prompt_template: "Use short status bullets.".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
        });
        config.family_scene_assignments = vec![FamilySceneAssignment {
            family: ContextFamily::WorkChat,
            scene_id: "custom_focus".to_string(),
        }];
        config.normalize_values();

        assert_eq!(
            scene_prompt_for_id(&config, "builtin_professional_email").as_deref(),
            Some(
                "Rewrite the transcript as a concise professional email body. Use a greeting when the recipient is spoken, clear body paragraphs, and a light closing when appropriate. Do not add facts or generate a subject unless requested."
            )
        );
        assert_eq!(
            scene_prompt_for_id(&config, "custom_focus").as_deref(),
            Some("Use short status bullets.")
        );
        assert_eq!(
            family_scene_prompt(&config, ContextFamily::WorkChat).as_deref(),
            Some("Use short status bullets.")
        );
        assert_eq!(
            family_scene_prompt(&config, ContextFamily::Email).as_deref(),
            Some(
                "Email system mode: produce an email body when there is enough content. Use a greeting when the recipient is spoken, concise body paragraphs, and a light closing when appropriate. Do not generate a subject unless explicitly requested."
            )
        );
        assert_eq!(scene_prompt_for_id(&config, "missing_scene"), None);

        assert_eq!(
            automatic_scene_prompt(
                &config,
                ContextFamily::WorkChat,
                Some("builtin_professional_email")
            )
            .as_deref(),
            scene_prompt_for_id(&config, "builtin_professional_email").as_deref()
        );
        assert_eq!(
            automatic_scene_prompt(&config, ContextFamily::WorkChat, Some("custom_focus"))
                .as_deref(),
            Some("Use short status bullets.")
        );
        assert_eq!(
            automatic_scene_prompt(&config, ContextFamily::WorkChat, None).as_deref(),
            Some("Use short status bullets.")
        );

        config.active_scene = Some(ActiveScene {
            id: "builtin_meeting_notes".to_string(),
            source: "builtin".to_string(),
            name: "Meeting Notes".to_string(),
            prompt_template: "Manual scene wins.".to_string(),
        });
        assert_eq!(
            automatic_scene_prompt(
                &config,
                ContextFamily::WorkChat,
                Some("builtin_professional_email")
            ),
            None
        );
    }

    #[test]
    fn system_scene_overrides_replace_default_system_prompts() {
        let mut config = AppConfig {
            system_scene_overrides: vec![SystemSceneOverride {
                id: "system_email".to_string(),
                prompt_template: "Use a warm email body with concise bullets.".to_string(),
            }],
            family_scene_assignments: vec![FamilySceneAssignment {
                family: ContextFamily::Email,
                scene_id: "system_email".to_string(),
            }],
            ..Default::default()
        };
        config.normalize_values();

        assert_eq!(
            scene_prompt_for_id(&config, "system_email").as_deref(),
            Some("Use a warm email body with concise bullets.")
        );
        assert_eq!(
            automatic_scene_prompt(&config, ContextFamily::Email, None).as_deref(),
            Some("Use a warm email body with concise bullets.")
        );
    }

    #[test]
    fn app_config_treats_null_system_scene_overrides_as_empty() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["system_scene_overrides"] = serde_json::Value::Null;

        let config = AppConfig::from_stored_value(value).unwrap();

        assert!(config.system_scene_overrides.is_empty());
    }

    #[test]
    fn app_config_sanitizes_custom_scenes_and_active_scene() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["custom_scenes"] = serde_json::json!([
            {
                "id": "  custom_keep  ",
                "name": format!("  Scene\0{}  ", "x".repeat(100)),
                "description": format!("  Desc\0{}  ", "y".repeat(300)),
                "prompt_template": format!("  Prompt\0{}  ", "z".repeat(5000)),
                "created_at": "  2026-06-30T00:00:00.000Z  ",
                "updated_at": "  2026-06-30T00:00:00.000Z  "
            }
        ]);
        value["active_scene"] = serde_json::json!({
            "id": "  custom_keep  ",
            "source": "custom",
            "name": "  Active\0 Scene  ",
            "prompt_template": "  Use bullets.\0  "
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.custom_scenes.len(), 1);
        let scene = &config.custom_scenes[0];
        assert_eq!(scene.id, "custom_keep");
        assert_eq!(scene.name.chars().count(), 80);
        assert!(scene.name.starts_with("Scene"));
        assert!(!scene.name.contains('\0'));
        assert_eq!(scene.description.chars().count(), 240);
        assert_eq!(scene.prompt_template.chars().count(), 4000);

        let active_scene = config
            .active_scene
            .expect("active scene should remain valid");
        assert_eq!(active_scene.id, "custom_keep");
        assert_eq!(active_scene.name, "Active Scene");
        assert_eq!(active_scene.prompt_template, "Use bullets.");
    }

    #[test]
    fn app_config_clears_empty_active_scene() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["active_scene"] = serde_json::json!({
            "id": "custom_empty",
            "source": "custom",
            "name": "Empty",
            "prompt_template": "   \0  "
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert!(config.active_scene.is_none());
    }

    #[test]
    fn app_config_sanitizes_custom_polish_prompt_and_clears_chinese_script() {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value["polish_custom_prompt"] = serde_json::json!("  use formal tone\0  ");
        value["polish_chinese_script"] = serde_json::json!("traditional");

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.polish_custom_prompt, "use formal tone");
        assert_eq!(config.polish_chinese_script, "preserve");
    }

    #[test]
    fn app_config_new_install_defaults_capsule_auto_hide_true() {
        let config = AppConfig::new_install_default();
        assert!(config.capsule_auto_hide);
        assert!(config.auto_start);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_config_new_install_uses_fn_toggle_on_macos() {
        let config = AppConfig::new_install_default();
        assert_eq!(config.hotkey, "Fn");
        assert_eq!(config.hotkeys.dictation.primary, "Fn");
        assert_eq!(config.hotkeys.dictation.modifiers, Vec::<String>::new());
        assert_eq!(config.hotkey_mode, "toggle");
        assert_eq!(config.hotkeys.dictation_mode, "toggle");
        assert_eq!(config.ask_hotkey, "Fn+Space");
        assert_eq!(
            config
                .hotkeys
                .ask
                .as_ref()
                .and_then(ShortcutBinding::to_hotkey_string),
            Some("Fn+Space".to_string())
        );
        assert_eq!(
            config
                .hotkeys
                .translate
                .as_ref()
                .and_then(ShortcutBinding::to_hotkey_string),
            Some("Fn+LeftShift".to_string())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn app_config_new_install_keeps_ctrl_slash_on_windows() {
        let config = AppConfig::new_install_default();
        assert_eq!(config.hotkey, "Ctrl+/");
        assert_eq!(config.hotkeys.dictation.primary, "/");
        assert_eq!(config.hotkeys.dictation.modifiers, vec!["Ctrl".to_string()]);
        assert_eq!(config.hotkey_mode, "hold");
        assert_eq!(config.hotkeys.dictation_mode, "hold");
        assert_eq!(config.ask_hotkey, "Ctrl+.");
        assert_eq!(
            config
                .hotkeys
                .ask
                .as_ref()
                .and_then(ShortcutBinding::to_hotkey_string),
            Some("Ctrl+.".to_string())
        );
        assert_eq!(
            config
                .hotkeys
                .translate
                .as_ref()
                .and_then(ShortcutBinding::to_hotkey_string),
            Some("Ctrl+Shift+/".to_string())
        );
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    #[test]
    fn app_config_new_install_keeps_ctrl_slash_on_linux() {
        let config = AppConfig::new_install_default();
        assert_eq!(config.hotkey, "Ctrl+/");
        assert_eq!(config.hotkey_mode, "hold");
        assert_eq!(config.ask_hotkey, "Ctrl+.");
        assert_eq!(
            config
                .hotkeys
                .translate
                .as_ref()
                .and_then(ShortcutBinding::to_hotkey_string),
            Some("Ctrl+Shift+/".to_string())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_config_migrates_old_mac_default_hotkey_to_fn() {
        let value = serde_json::json!({
            "hotkey": "Option+/",
            "ask_hotkey": "Command+.",
            "hotkey_mode": "hold"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.hotkey, "Fn");
        assert_eq!(config.hotkeys.dictation.primary, "Fn");
        assert_eq!(config.hotkeys.dictation.modifiers, Vec::<String>::new());
        assert_eq!(config.hotkey_mode, "toggle");
        assert_eq!(config.hotkeys.dictation_mode, "toggle");
    }

    #[test]
    fn app_config_preserves_custom_hotkey_during_native_default_migration() {
        let value = serde_json::json!({
            "hotkey": "Ctrl+Shift+;",
            "ask_hotkey": "Ctrl+.",
            "hotkey_mode": "hold"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.hotkey, "Ctrl+Shift+;");
        assert_eq!(config.hotkeys.dictation.primary, ";");
        assert_eq!(
            config.hotkeys.dictation.modifiers,
            vec!["Ctrl".to_string(), "Shift".to_string()]
        );
        assert_eq!(config.hotkey_mode, "hold");
        assert_eq!(config.hotkeys.dictation_mode, "hold");
    }

    #[test]
    fn app_config_existing_missing_capsule_auto_hide_defaults_false() {
        let value = serde_json::json!({
            "stt_provider": "deepgram",
            "stt_api_key": "hosted-secret"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.stt_provider, "deepgram");
        assert_eq!(config.stt_api_key, "hosted-secret");
        assert!(!config.capsule_auto_hide);
    }

    #[test]
    fn app_config_existing_explicit_capsule_auto_hide_is_preserved() {
        let value = serde_json::json!({
            "capsule_auto_hide": true
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert!(config.capsule_auto_hide);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_config_migrates_legacy_mac_alt_slash_label() {
        let value = serde_json::json!({
            "hotkey": "Alt+/"
        });

        let config = AppConfig::from_stored_value(value).unwrap();

        assert_eq!(config.hotkey, "Option+/");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_config_migrates_legacy_mac_ask_hotkey_defaults() {
        for legacy in [
            "Alt+Shift+/",
            "Option+Shift+/",
            "Command+Shift+/",
            "Command+/",
            "Command+。",
        ] {
            let value = serde_json::json!({
                "ask_hotkey": legacy
            });

            let config = AppConfig::from_stored_value(value).unwrap();

            assert_eq!(config.ask_hotkey, "Fn+Space");
        }
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn app_config_migrates_legacy_non_macos_ask_hotkey_defaults() {
        for legacy in ["Ctrl+Shift+/", "Control+Shift+/", "Ctrl+/", "Control+/"] {
            let value = serde_json::json!({
                "ask_hotkey": legacy
            });

            let config = AppConfig::from_stored_value(value).unwrap();

            #[cfg(not(target_os = "macos"))]
            assert_eq!(config.ask_hotkey, "Ctrl+.");
        }
    }

    fn test_history_entry(id: i64, created_at: &str) -> HistoryEntry {
        HistoryEntry {
            id,
            created_at: created_at.to_string(),
            context_profile_id: "general.native".to_string(),
            context_label: "General".to_string(),
            context_icon_key: "general".to_string(),
            context_family: ContextFamily::General,
            browser_access_status: BrowserAccessStatus::NotApplicable,
            provider_kind: HistoryProviderKind::Local,
            raw_text: format!("raw {id}"),
            polished_text: format!("polished {id}"),
            language: None,
            duration_ms: None,
            stt_ms: None,
            llm_ms: None,
            total_ms: None,
            active_scene_id: None,
            active_scene_source: None,
            active_scene_name: None,
            active_scene_prompt_chars: None,
            active_scene_prompt_truncated: false,
            output_status: None,
            output_error: None,
        }
    }

    fn temp_history_store(name: &str) -> HistoryStore {
        let path = std::env::temp_dir().join(format!(
            "opentypeless-history-test-{}-{}.sqlite",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        HistoryStore::new(path).unwrap()
    }

    fn temp_dictionary_store(name: &str) -> DictionaryStore {
        let path = std::env::temp_dir().join(format!(
            "opentypeless-dictionary-test-{}-{}.sqlite",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        DictionaryStore::new(path).unwrap()
    }

    fn temp_backup_stores(name: &str) -> (HistoryStore, DictionaryStore) {
        let path = std::env::temp_dir().join(format!(
            "opentypeless-backup-test-{}-{}.sqlite",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let history = HistoryStore::new(path.clone()).unwrap();
        let dictionary = DictionaryStore::new(path).unwrap();
        (history, dictionary)
    }

    #[tokio::test]
    async fn history_store_respects_disabled_policy() {
        let store = temp_history_store("disabled");
        let policy = HistoryRetentionPolicy {
            enabled: false,
            max_entries: 5000,
            retention_days: 0,
        };

        store
            .add_with_policy(test_history_entry(1, "2026-07-01T00:00:00"), &policy)
            .await
            .unwrap();

        assert!(store.list(10, 0).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn history_store_prunes_by_max_entries_policy() {
        let store = temp_history_store("max");
        let policy = HistoryRetentionPolicy {
            enabled: true,
            max_entries: 2,
            retention_days: 0,
        };

        for id in 1..=3 {
            store
                .add_with_policy(
                    test_history_entry(id, &format!("2026-07-0{id}T00:00:00")),
                    &policy,
                )
                .await
                .unwrap();
        }

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].polished_text, "polished 3");
        assert_eq!(entries[1].polished_text, "polished 2");
    }

    #[tokio::test]
    async fn history_store_count_is_not_limited_by_page_size() {
        let store = temp_history_store("count");
        for id in 1..=3 {
            store
                .add(test_history_entry(id, &format!("2026-07-0{id}T00:00:00")))
                .await
                .unwrap();
        }

        assert_eq!(store.list(2, 0).await.unwrap().len(), 2);
        assert_eq!(store.count().await.unwrap(), 3);
    }

    #[tokio::test]
    async fn history_store_aggregates_transcription_time_by_calendar_cutoff() {
        let store = temp_history_store("transcription-time");
        for (id, created_at, duration_ms) in [
            (1, "2026-07-01T09:00:00", 1_000),
            (2, "2026-07-14T09:00:00", 2_000),
            (3, "2026-07-19T09:00:00", 3_000),
            (4, "2026-07-19T10:00:00", -500),
        ] {
            let mut entry = test_history_entry(id, created_at);
            entry.duration_ms = Some(duration_ms);
            store.add(entry).await.unwrap();
        }

        let stats = store
            .transcription_time_stats(
                "2026-07-19T00:00:00",
                "2026-07-13T00:00:00",
                "2026-07-01T00:00:00",
            )
            .await
            .unwrap();

        assert_eq!(
            stats,
            TranscriptionTimeStats {
                day_ms: 3_000,
                week_ms: 5_000,
                month_ms: 6_000,
                excluded_count: 1,
            }
        );
    }

    #[tokio::test]
    async fn transcription_time_stats_preserve_but_exclude_implausible_durations() {
        let store = temp_history_store("transcription-time-outlier");
        let mut normal = test_history_entry(1, "2026-07-19T09:00:00");
        normal.duration_ms = Some(30_000);
        store.add(normal).await.unwrap();

        let mut outlier = test_history_entry(2, "2026-07-19T10:00:00");
        outlier.duration_ms = Some(MAX_COUNTED_TRANSCRIPTION_DURATION_MS + 1);
        store.add(outlier).await.unwrap();

        let stats = store
            .transcription_time_stats(
                "2026-07-19T00:00:00",
                "2026-07-13T00:00:00",
                "2026-07-01T00:00:00",
            )
            .await
            .unwrap();

        assert_eq!(
            stats,
            TranscriptionTimeStats {
                day_ms: 30_000,
                week_ms: 30_000,
                month_ms: 30_000,
                excluded_count: 1,
            }
        );
        assert_eq!(store.list(10, 0).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn history_store_aggregates_privacy_safe_local_activity_metrics() {
        let store = temp_history_store("local-activity");

        let mut month_only = test_history_entry(1, "2026-07-01T09:00:00");
        month_only.raw_text = "a b".to_string();
        month_only.polished_text = "a b".to_string();
        month_only.duration_ms = Some(1_000);
        month_only.total_ms = Some(100);
        month_only.output_status = Some("inserted".to_string());
        store.add(month_only).await.unwrap();

        let mut week = test_history_entry(2, "2026-07-14T09:00:00");
        week.raw_text = "hi".to_string();
        week.polished_text = " hi ".to_string();
        week.duration_ms = Some(2_000);
        week.total_ms = Some(300);
        week.output_status = Some("clipboard_fallback".to_string());
        store.add(week).await.unwrap();

        let mut day = test_history_entry(3, "2026-07-19T09:00:00");
        day.raw_text = "hello".to_string();
        day.polished_text = "Hello!".to_string();
        day.duration_ms = Some(3_000);
        day.total_ms = Some(500);
        day.output_status = Some("inserted".to_string());
        store.add(day).await.unwrap();

        let mut invalid_duration = test_history_entry(4, "2026-07-19T10:00:00");
        invalid_duration.raw_text = "bad".to_string();
        invalid_duration.polished_text = "bad".to_string();
        invalid_duration.duration_ms = Some(-500);
        invalid_duration.output_status = Some("clipboard_fallback".to_string());
        store.add(invalid_duration).await.unwrap();

        let mut current_outlier = test_history_entry(5, "2026-07-19T11:00:00");
        current_outlier.raw_text = "x".to_string();
        current_outlier.polished_text = "x".to_string();
        current_outlier.duration_ms = Some(MAX_COUNTED_TRANSCRIPTION_DURATION_MS + 1);
        current_outlier.total_ms = Some(700);
        current_outlier.output_status = Some("inserted".to_string());
        store.add(current_outlier).await.unwrap();

        let mut prior_outlier = test_history_entry(6, "2026-06-30T11:00:00");
        prior_outlier.duration_ms = Some(MAX_COUNTED_TRANSCRIPTION_DURATION_MS + 2);
        store.add(prior_outlier).await.unwrap();

        let mut future = test_history_entry(7, "2026-07-20T09:00:00");
        future.polished_text = "future".to_string();
        future.duration_ms = Some(9_000);
        future.total_ms = Some(900);
        store.add(future).await.unwrap();

        let mut failed = test_history_entry(8, "2026-07-19T12:00:00");
        failed.raw_text = "failure raw".to_string();
        failed.polished_text = String::new();
        failed.output_status = Some("failed".to_string());
        failed.output_error = Some("Automatic output failed".to_string());
        failed.total_ms = Some(450);
        store.add(failed).await.unwrap();

        let mut timing_outlier = test_history_entry(9, "2026-07-19T13:00:00");
        timing_outlier.raw_text = "lag".to_string();
        timing_outlier.polished_text = "lag".to_string();
        timing_outlier.duration_ms = Some(0);
        timing_outlier.total_ms = Some(MAX_COUNTED_TURNAROUND_MS + 1);
        timing_outlier.output_status = Some("inserted".to_string());
        store.add(timing_outlier).await.unwrap();

        let mut legacy_unclassified = test_history_entry(10, "2026-07-19T14:00:00");
        legacy_unclassified.raw_text = "legacy".to_string();
        legacy_unclassified.polished_text = "legacy".to_string();
        legacy_unclassified.total_ms = Some(600);
        store.add(legacy_unclassified).await.unwrap();

        let mut cancelled = test_history_entry(11, "2026-07-19T15:00:00");
        cancelled.raw_text = "cancelled".to_string();
        cancelled.polished_text = "cancelled".to_string();
        cancelled.total_ms = Some(650);
        cancelled.output_status = Some("cancelled".to_string());
        cancelled.output_error =
            Some("Dictation was cancelled before automatic output".to_string());
        store.add(cancelled).await.unwrap();

        let summary = store
            .local_activity_metrics(
                "2026-07-19T00:00:00",
                "2026-07-13T00:00:00",
                "2026-07-01T00:00:00",
                "2026-07-19T23:59:59",
            )
            .await
            .unwrap();

        assert_eq!(summary.total_recordings, 11);
        assert_eq!(summary.valid_duration_sample_count, 4);
        assert_eq!(summary.excluded_duration_count, 7);
        assert_eq!(
            summary.day,
            ActivityRangeMetrics {
                recording_ms: 3_000,
                saved_transcriptions: 7,
                output_chars: 13,
                active_days: 1,
                successful_automatic_insertions: 3,
                recorded_fallbacks: 1,
                recorded_failures: 2,
                output_outcome_sample_count: 6,
                transformed_outputs: 1,
                valid_duration_sample_count: 1,
                average_total_ms: Some(600.0),
                p50_total_ms: Some(600),
                p95_total_ms: Some(700),
                timing_sample_count: 3,
                excluded_timing_count: 1,
                excluded_duration_count: 6,
            }
        );
        assert_eq!(
            summary.week,
            ActivityRangeMetrics {
                recording_ms: 5_000,
                saved_transcriptions: 8,
                output_chars: 17,
                active_days: 2,
                successful_automatic_insertions: 3,
                recorded_fallbacks: 2,
                recorded_failures: 2,
                output_outcome_sample_count: 7,
                transformed_outputs: 1,
                valid_duration_sample_count: 2,
                average_total_ms: Some(525.0),
                p50_total_ms: Some(500),
                p95_total_ms: Some(700),
                timing_sample_count: 4,
                excluded_timing_count: 1,
                excluded_duration_count: 6,
            }
        );
        assert_eq!(
            summary.month,
            ActivityRangeMetrics {
                recording_ms: 6_000,
                saved_transcriptions: 9,
                output_chars: 20,
                active_days: 3,
                successful_automatic_insertions: 4,
                recorded_fallbacks: 2,
                recorded_failures: 2,
                output_outcome_sample_count: 8,
                transformed_outputs: 1,
                valid_duration_sample_count: 3,
                average_total_ms: Some(440.0),
                p50_total_ms: Some(500),
                p95_total_ms: Some(700),
                timing_sample_count: 5,
                excluded_timing_count: 1,
                excluded_duration_count: 6,
            }
        );
    }

    #[test]
    fn local_activity_metrics_serialize_with_frontend_camel_case_contract() {
        let value = serde_json::to_value(LocalActivityMetricsSummary {
            day: ActivityRangeMetrics {
                recording_ms: 1,
                saved_transcriptions: 2,
                output_chars: 3,
                active_days: 4,
                successful_automatic_insertions: 5,
                recorded_fallbacks: 5,
                recorded_failures: 6,
                output_outcome_sample_count: 7,
                transformed_outputs: 6,
                valid_duration_sample_count: 8,
                average_total_ms: Some(8.5),
                p50_total_ms: Some(8),
                p95_total_ms: Some(9),
                timing_sample_count: 9,
                excluded_timing_count: 2,
                excluded_duration_count: 7,
            },
            total_recordings: 9,
            valid_duration_sample_count: 8,
            excluded_duration_count: 10,
            ..LocalActivityMetricsSummary::default()
        })
        .unwrap();

        assert_eq!(value["totalRecordings"], 9);
        assert_eq!(value["validDurationSampleCount"], 8);
        assert_eq!(value["excludedDurationCount"], 10);
        assert_eq!(value["day"]["recordingMs"], 1);
        assert_eq!(value["day"]["savedTranscriptions"], 2);
        assert_eq!(value["day"]["outputChars"], 3);
        assert_eq!(value["day"]["activeDays"], 4);
        assert_eq!(value["day"]["successfulAutomaticInsertions"], 5);
        assert_eq!(value["day"]["recordedFallbacks"], 5);
        assert_eq!(value["day"]["recordedFailures"], 6);
        assert_eq!(value["day"]["outputOutcomeSampleCount"], 7);
        assert_eq!(value["day"]["transformedOutputs"], 6);
        assert_eq!(value["day"]["validDurationSampleCount"], 8);
        assert_eq!(value["day"]["excludedDurationCount"], 7);
        assert_eq!(value["day"]["averageTotalMs"], 8.5);
        assert_eq!(value["day"]["p50TotalMs"], 8);
        assert_eq!(value["day"]["p95TotalMs"], 9);
        assert_eq!(value["day"]["timingSampleCount"], 9);
        assert_eq!(value["day"]["excludedTimingCount"], 2);
    }

    #[test]
    fn nearest_rank_percentiles_are_deterministic_for_small_samples() {
        assert_eq!(nearest_rank_percentile(&[], 50), None);
        assert_eq!(nearest_rank_percentile(&[100], 95), Some(100));
        assert_eq!(
            nearest_rank_percentile(&[100, 300, 500, 700], 50),
            Some(300)
        );
        assert_eq!(
            nearest_rank_percentile(&[100, 300, 500, 700], 95),
            Some(700)
        );
    }

    #[tokio::test]
    async fn history_store_prunes_by_retention_days_policy() {
        let store = temp_history_store("days");
        let policy = HistoryRetentionPolicy {
            enabled: true,
            max_entries: 5000,
            retention_days: 7,
        };

        store
            .add_with_policy(test_history_entry(1, "2026-06-25T00:00:00"), &policy)
            .await
            .unwrap();
        store
            .add_with_policy(test_history_entry(2, "2026-07-01T00:00:00"), &policy)
            .await
            .unwrap();
        store
            .prune_with_policy(&policy, "2026-07-05T00:00:00")
            .await
            .unwrap();

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].polished_text, "polished 2");
    }

    #[tokio::test]
    async fn backup_snapshot_reads_all_persisted_sections_beyond_ui_page_size() {
        let (history, dictionary) = temp_backup_stores("export-snapshot");
        for id in 1..=205 {
            history
                .add(test_history_entry(id, "2026-07-01T00:00:00"))
                .await
                .unwrap();
        }
        dictionary
            .add("OpenTypeless", Some("open typeless"))
            .await
            .unwrap();
        dictionary
            .add_correction("open type less", "OpenTypeless")
            .await
            .unwrap();

        let snapshot = history.export_backup_snapshot().await.unwrap();

        assert_eq!(snapshot.history.len(), 205);
        assert_eq!(snapshot.history[0].raw_text, "raw 205");
        assert_eq!(snapshot.history[204].raw_text, "raw 1");
        assert_eq!(snapshot.dictionary.len(), 1);
        assert_eq!(snapshot.dictionary[0].word, "OpenTypeless");
        assert_eq!(snapshot.correction_rules.len(), 1);
        assert_eq!(snapshot.correction_rules[0].pattern, "open type less");
    }

    #[tokio::test]
    async fn backup_snapshot_rejects_history_over_the_hard_cap() {
        let (history, _dictionary) = temp_backup_stores("export-cap");
        {
            let mut conn = history
                .conn
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let transaction = conn.transaction().unwrap();
            for index in 0..=DEFAULT_HISTORY_MAX_ENTRIES {
                transaction
                    .execute(
                        "INSERT INTO history (created_at, raw_text, polished_text)
                         VALUES ('2026-07-01T00:00:00', ?1, ?1)",
                        rusqlite::params![format!("entry {index}")],
                    )
                    .unwrap();
            }
            transaction.commit().unwrap();
        }

        let error = history.export_backup_snapshot().await.unwrap_err();

        assert_eq!(error.to_string(), "backup_history_too_large");
    }

    #[tokio::test]
    async fn backup_restore_replaces_all_requested_data_in_one_transaction() {
        let (history, dictionary) = temp_backup_stores("replace");
        history
            .add(test_history_entry(99, "2026-07-01T00:00:00"))
            .await
            .unwrap();
        dictionary.add("Old word", None).await.unwrap();
        dictionary
            .add_correction("old phrase", "Old phrase")
            .await
            .unwrap();
        let policy = HistoryRetentionPolicy {
            enabled: true,
            max_entries: 2,
            retention_days: 0,
        };

        history
            .restore_backup_data(
                Some(vec![
                    test_history_entry(3, "2026-07-03T00:00:00"),
                    test_history_entry(2, "2026-07-02T00:00:00"),
                    test_history_entry(1, "2026-07-01T00:00:00"),
                ]),
                Some(vec![
                    DictionaryEntry {
                        id: 20,
                        word: "OpenTypeless".to_string(),
                        pronunciation: None,
                    },
                    DictionaryEntry {
                        id: 21,
                        word: " opentypeless ".to_string(),
                        pronunciation: Some("duplicate".to_string()),
                    },
                ]),
                Some(vec![CorrectionRule {
                    id: 30,
                    pattern: "open type less".to_string(),
                    replacement: "OpenTypeless".to_string(),
                    enabled: false,
                }]),
                &policy,
                "2026-07-13T00:00:00",
            )
            .await
            .unwrap();

        let restored_history = history.list(10, 0).await.unwrap();
        assert_eq!(restored_history.len(), 2);
        assert_eq!(restored_history[0].polished_text, "polished 3");
        assert_eq!(restored_history[1].polished_text, "polished 2");
        let restored_dictionary = dictionary.list().await.unwrap();
        assert_eq!(restored_dictionary.len(), 1);
        assert_eq!(restored_dictionary[0].word, "OpenTypeless");
        let restored_rules = dictionary.correction_rules().await.unwrap();
        assert_eq!(restored_rules.len(), 1);
        assert!(!restored_rules[0].enabled);
    }

    #[tokio::test]
    async fn backup_restore_preserves_optional_pipeline_timings() {
        let (history, _dictionary) = temp_backup_stores("timing-restore");
        let mut restored_entry = test_history_entry(1, "2026-07-01T00:00:00");
        restored_entry.stt_ms = Some(90);
        restored_entry.llm_ms = Some(60);
        restored_entry.total_ms = Some(180);

        history
            .restore_backup_data(
                Some(vec![restored_entry]),
                None,
                None,
                &HistoryRetentionPolicy::default(),
                "2026-07-13T00:00:00",
            )
            .await
            .unwrap();

        let entries = history.list(10, 0).await.unwrap();
        assert_eq!(entries[0].stt_ms, Some(90));
        assert_eq!(entries[0].llm_ms, Some(60));
        assert_eq!(entries[0].total_ms, Some(180));
    }

    #[tokio::test]
    async fn invalid_backup_dictionary_leaves_existing_data_unchanged() {
        let (history, dictionary) = temp_backup_stores("validation");
        history
            .add(test_history_entry(1, "2026-07-01T00:00:00"))
            .await
            .unwrap();
        dictionary.add("Existing", None).await.unwrap();

        let result = history
            .restore_backup_data(
                Some(vec![test_history_entry(2, "2026-07-02T00:00:00")]),
                Some(vec![DictionaryEntry {
                    id: 2,
                    word: "x".repeat(101),
                    pronunciation: None,
                }]),
                None,
                &HistoryRetentionPolicy::default(),
                "2026-07-13T00:00:00",
            )
            .await;

        assert_eq!(result.unwrap_err().to_string(), "dictionary_word_too_long");
        assert_eq!(history.list(10, 0).await.unwrap()[0].raw_text, "raw 1");
        assert_eq!(dictionary.list().await.unwrap()[0].word, "Existing");
    }

    #[tokio::test]
    async fn history_store_persists_active_scene_diagnostics() {
        let store = temp_history_store("scene-diagnostics");
        let mut entry = test_history_entry(1, "2026-07-01T00:00:00");
        entry.active_scene_id = Some("builtin_meeting_notes".to_string());
        entry.active_scene_source = Some("builtin".to_string());
        entry.active_scene_name = Some("Meeting Notes".to_string());
        entry.active_scene_prompt_chars = Some(128);
        entry.active_scene_prompt_truncated = false;

        store.add(entry).await.unwrap();

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(
            entries[0].active_scene_id.as_deref(),
            Some("builtin_meeting_notes")
        );
        assert_eq!(entries[0].active_scene_source.as_deref(), Some("builtin"));
        assert_eq!(
            entries[0].active_scene_name.as_deref(),
            Some("Meeting Notes")
        );
        assert_eq!(entries[0].active_scene_prompt_chars, Some(128));
        assert!(!entries[0].active_scene_prompt_truncated);
    }

    #[tokio::test]
    async fn history_store_persists_output_status_diagnostics() {
        let store = temp_history_store("output-diagnostics");
        let mut entry = test_history_entry(1, "2026-07-01T00:00:00");
        entry.output_status = Some("partial".to_string());
        entry.output_error = Some("LLM failed after partial streaming insert".to_string());

        store.add(entry).await.unwrap();

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(entries[0].output_status.as_deref(), Some("partial"));
        assert_eq!(
            entries[0].output_error.as_deref(),
            Some("LLM failed after partial streaming insert")
        );
    }

    #[tokio::test]
    async fn history_store_persists_optional_pipeline_timings() {
        let store = temp_history_store("pipeline-timings");
        let mut entry = test_history_entry(1, "2026-07-01T00:00:00");
        entry.stt_ms = Some(120);
        entry.llm_ms = Some(80);
        entry.total_ms = Some(240);

        store.add(entry).await.unwrap();

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(entries[0].stt_ms, Some(120));
        assert_eq!(entries[0].llm_ms, Some(80));
        assert_eq!(entries[0].total_ms, Some(240));
    }

    #[tokio::test]
    async fn history_store_persists_browser_access_status_without_raw_url() {
        let store = temp_history_store("browser-access-status");
        let mut entry = test_history_entry(1, "2026-07-01T00:00:00");
        entry.context_profile_id = "general.browser".to_string();
        entry.context_label = "Browser".to_string();
        entry.browser_access_status = BrowserAccessStatus::NeedsPermission;

        store.add(entry).await.unwrap();

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(
            entries[0].browser_access_status,
            BrowserAccessStatus::NeedsPermission
        );

        let conn = store.conn.lock().unwrap();
        let raw_value: Option<String> = conn
            .query_row(
                "SELECT browser_access_status FROM history WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw_value.as_deref(), Some("needs_permission"));
        assert_ne!(raw_value.as_deref(), Some("mail.google.com"));
    }

    #[tokio::test]
    async fn history_store_migrates_legacy_history_table_scene_columns() {
        let path = std::env::temp_dir().join(format!(
            "opentypeless-history-test-legacy-scene-{}.sqlite",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    app_name TEXT NOT NULL DEFAULT '',
                    app_type TEXT NOT NULL DEFAULT '',
                    raw_text TEXT NOT NULL DEFAULT '',
                    polished_text TEXT NOT NULL DEFAULT '',
                    language TEXT,
                    duration_ms INTEGER
                );",
            )
            .unwrap();
        }

        let store = HistoryStore::new(path).unwrap();
        let mut entry = test_history_entry(1, "2026-07-01T00:00:00");
        entry.active_scene_id = Some("custom_focus".to_string());
        entry.active_scene_source = Some("custom".to_string());
        entry.active_scene_name = Some("Focus".to_string());
        entry.active_scene_prompt_chars = Some(64);
        entry.active_scene_prompt_truncated = true;

        store.add(entry).await.unwrap();

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(entries[0].active_scene_id.as_deref(), Some("custom_focus"));
        assert!(entries[0].active_scene_prompt_truncated);
        assert!(entries[0].output_status.is_none());
        assert!(entries[0].output_error.is_none());
    }

    #[tokio::test]
    async fn history_context_migration_clears_raw_app_identity_and_uses_safe_profiles() {
        let path = std::env::temp_dir().join(format!(
            "opentypeless-history-test-legacy-context-{}.sqlite",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    app_name TEXT NOT NULL DEFAULT '',
                    app_type TEXT NOT NULL DEFAULT '',
                    raw_text TEXT NOT NULL DEFAULT '',
                    polished_text TEXT NOT NULL DEFAULT '',
                    language TEXT,
                    duration_ms INTEGER
                );
                INSERT INTO history (created_at, app_name, app_type, raw_text, polished_text)
                VALUES
                    ('2026-07-01T00:00:00', 'Gmail', 'Email', 'one', 'One'),
                    ('2026-07-02T00:00:00', 'Private Project Alpha', 'Document', 'two', 'Two');",
            )
            .unwrap();
        }

        let store = HistoryStore::new(path.clone()).unwrap();
        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(entries[1].context_profile_id, "email.gmail");
        assert_eq!(entries[1].context_label, "Gmail");
        assert_eq!(entries[1].context_icon_key, "gmail");
        assert_eq!(entries[1].context_family, ContextFamily::Email);
        assert_eq!(entries[1].provider_kind, HistoryProviderKind::Local);
        assert_eq!(entries[0].context_profile_id, "general.native");
        assert_eq!(entries[0].context_label, "General");
        assert!(entries.iter().all(|entry| entry.stt_ms.is_none()));
        assert!(entries.iter().all(|entry| entry.llm_ms.is_none()));
        assert!(entries.iter().all(|entry| entry.total_ms.is_none()));

        let conn = Connection::open(path).unwrap();
        let raw_values: (String, String) = conn
            .query_row(
                "SELECT app_name, app_type FROM history WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(raw_values, (String::new(), String::new()));
    }

    #[tokio::test]
    async fn history_context_migration_new_writes_store_only_safe_context_metadata() {
        let store = temp_history_store("safe-context-write");
        let mut entry = test_history_entry(1, "2026-07-03T00:00:00");
        entry.context_profile_id = "dev.github".to_string();
        entry.context_label = "GitHub".to_string();
        entry.context_icon_key = "github".to_string();
        entry.context_family = ContextFamily::DeveloperCollaboration;
        entry.provider_kind = HistoryProviderKind::ManagedCloud;
        store.add(entry).await.unwrap();

        let entries = store.list(10, 0).await.unwrap();
        assert_eq!(entries[0].context_profile_id, "dev.github");
        assert_eq!(
            entries[0].context_family,
            ContextFamily::DeveloperCollaboration
        );
        assert_eq!(entries[0].provider_kind, HistoryProviderKind::ManagedCloud);

        let conn = store.conn.lock().unwrap();
        let raw_values: (String, String) = conn
            .query_row(
                "SELECT app_name, app_type FROM history WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(raw_values, (String::new(), String::new()));
    }

    #[tokio::test]
    async fn dictionary_store_persists_correction_rules() {
        let store = temp_dictionary_store("correction-rules");

        store.add_correction(" 拓肯 ", " Token ").await.unwrap();
        let rules = store.correction_rules().await.unwrap();

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].pattern, "拓肯");
        assert_eq!(rules[0].replacement, "Token");
        assert!(rules[0].enabled);
    }

    #[tokio::test]
    async fn dictionary_store_ignores_disabled_correction_rules_for_prompt() {
        let store = temp_dictionary_store("correction-rules-disabled");

        store.add_correction("克劳德", "Claude").await.unwrap();
        let rules = store.correction_rules().await.unwrap();
        store
            .set_correction_enabled(rules[0].id, false)
            .await
            .unwrap();

        let enabled = store.enabled_correction_rules().await;

        assert!(enabled.is_empty());
    }

    #[tokio::test]
    async fn dictionary_store_updates_entries_and_rejects_normalized_duplicates() {
        let store = temp_dictionary_store("updates");
        store.add("Token", None).await.unwrap();
        store.add("TalkMore", Some("talk more")).await.unwrap();
        let entries = store.list().await.unwrap();

        store
            .update(entries[0].id, "OpenTypeless", Some("open typeless"))
            .await
            .unwrap();
        assert!(store
            .update(entries[0].id, "ＴＡＬＫＭＯＲＥ", None)
            .await
            .is_err());

        let updated = store.list().await.unwrap();
        assert_eq!(updated[0].word, "OpenTypeless");
        assert_eq!(updated[0].pronunciation.as_deref(), Some("open typeless"));
    }

    #[tokio::test]
    async fn dictionary_store_updates_correction_pair_and_enabled_state() {
        let store = temp_dictionary_store("correction-updates");
        store.add_correction("token", "Token").await.unwrap();
        store.add_correction("talk more", "TalkMore").await.unwrap();
        let rules = store.correction_rules().await.unwrap();

        store
            .update_correction(rules[0].id, "open type less", "OpenTypeless", false)
            .await
            .unwrap();
        assert!(store
            .update_correction(rules[0].id, "ＴＡＬＫ ＭＯＲＥ", "talkmore", true)
            .await
            .is_err());

        let updated = store.correction_rules().await.unwrap();
        assert_eq!(updated[0].pattern, "open type less");
        assert_eq!(updated[0].replacement, "OpenTypeless");
        assert!(!updated[0].enabled);
    }
}

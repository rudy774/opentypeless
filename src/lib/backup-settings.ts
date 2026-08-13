import {
  type ActiveScene,
  type AppConfig,
  type ContextFamily,
  type CustomScene,
  type FamilySceneAssignment,
  type HotkeyConfig,
  type ShortcutBinding,
  type SystemSceneOverride,
  type TranslationConfig,
  type VoiceRoutingFlags,
} from '../stores/appStore'

type SafeScalarKey =
  | 'stt_language'
  | 'polish_enabled'
  | 'context_adaptation_enabled'
  | 'polish_style'
  | 'polish_custom_prompt'
  | 'polish_chinese_script'
  | 'translate_enabled'
  | 'target_lang'
  | 'hotkey'
  | 'ask_hotkey'
  | 'hotkey_mode'
  | 'output_mode'
  | 'insertion_strategy'
  | 'restore_clipboard_after_paste'
  | 'paste_shortcut'
  | 'windows_sendinput_newline_mode'
  | 'streaming_insert_enabled'
  | 'selected_text_enabled'
  | 'theme'
  | 'auto_start'
  | 'close_to_tray'
  | 'start_minimized'
  | 'max_recording_seconds'
  | 'history_enabled'
  | 'history_retention_days'
  | 'history_max_entries'
  | 'ui_language'
  | 'capsule_auto_hide'

/**
 * Portable preferences only. Provider routing, models, and endpoints are
 * intentionally device-local because restoring them could redirect locally
 * stored credentials or captured audio/text to an attacker-controlled server.
 */
export type BackupSettings = Pick<AppConfig, SafeScalarKey> & {
  voice_routing_flags: VoiceRoutingFlags
  custom_scenes: CustomScene[]
  system_scene_overrides: SystemSceneOverride[]
  active_scene: ActiveScene | null
  family_scene_assignments: FamilySceneAssignment[]
  translation: TranslationConfig
  hotkeys: HotkeyConfig
}

export class InvalidBackupSettingsError extends Error {
  constructor() {
    super('Managed service returned invalid backup settings')
    this.name = 'InvalidBackupSettingsError'
  }
}

const SAFE_SCALAR_KEYS: readonly SafeScalarKey[] = [
  'stt_language',
  'polish_enabled',
  'context_adaptation_enabled',
  'polish_style',
  'polish_custom_prompt',
  'polish_chinese_script',
  'translate_enabled',
  'target_lang',
  'hotkey',
  'ask_hotkey',
  'hotkey_mode',
  'output_mode',
  'insertion_strategy',
  'restore_clipboard_after_paste',
  'paste_shortcut',
  'windows_sendinput_newline_mode',
  'streaming_insert_enabled',
  'selected_text_enabled',
  'theme',
  'auto_start',
  'close_to_tray',
  'start_minimized',
  'max_recording_seconds',
  'history_enabled',
  'history_retention_days',
  'history_max_entries',
  'ui_language',
  'capsule_auto_hide',
]

export const DEVICE_LOCAL_PROVIDER_ROUTING_KEYS = [
  'stt_provider',
  'stt_custom_preset',
  'stt_custom_base_url',
  'stt_custom_model',
  'stt_volcengine_resource_id',
  'llm_provider',
  'llm_model',
  'llm_base_url',
] as const

const BACKUP_SETTINGS_KEYS = [
  ...SAFE_SCALAR_KEYS,
  'voice_routing_flags',
  'custom_scenes',
  'system_scene_overrides',
  'active_scene',
  'family_scene_assignments',
  'translation',
  'hotkeys',
] as const
const VOICE_ROUTING_KEYS = [
  'draft_insert',
  'rewrite_selection',
  'translate_selection',
  'search',
] as const
const CUSTOM_SCENE_KEYS = [
  'id',
  'name',
  'description',
  'prompt_template',
  'created_at',
  'updated_at',
] as const
const SYSTEM_SCENE_OVERRIDE_KEYS = ['id', 'prompt_template'] as const
const ACTIVE_SCENE_KEYS = ['id', 'source', 'name', 'prompt_template'] as const
const FAMILY_SCENE_ASSIGNMENT_KEYS = ['family', 'scene_id'] as const
const TRANSLATION_KEYS = ['targets', 'active_target'] as const
const SHORTCUT_BINDING_KEYS = ['primary', 'modifiers'] as const
const HOTKEY_CONFIG_KEYS = [
  'dictation',
  'ask',
  'translate',
  'dictationBindings',
  'askBindings',
  'translateBindings',
  'editSelection',
  'switchScene',
  'openApp',
  'dictationMode',
] as const

const CONTEXT_FAMILIES: readonly ContextFamily[] = [
  'email',
  'work_chat',
  'personal_chat',
  'document',
  'project_management',
  'developer_collaboration',
  'prompt_or_code',
  'support',
  'social',
  'general',
]
const SCENE_SOURCES = ['custom', 'builtin', 'cloud'] as const
const POLISH_STYLES = ['minimal', 'clean', 'structured', 'professional'] as const
const CHINESE_SCRIPTS = ['preserve', 'simplified', 'traditional'] as const
const HOTKEY_MODES = ['hold', 'toggle'] as const
const OUTPUT_MODES = ['keyboard', 'clipboard'] as const
const INSERTION_STRATEGIES = [
  'auto',
  'keyboard',
  'clipboardPaste',
  'clipboardCopyOnly',
  'windowsSendInput',
] as const
const PASTE_SHORTCUTS = ['ctrlV', 'ctrlShiftV', 'shiftInsert'] as const
const WINDOWS_NEWLINE_MODES = ['enter', 'shiftEnter', 'crlf'] as const
const THEMES = ['light', 'dark', 'system'] as const

function invalidBackupSettings(): never {
  throw new InvalidBackupSettingsError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength
}

function isEnumValue<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  )
}

function parseVoiceRoutingFlags(value: unknown): VoiceRoutingFlags {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, VOICE_ROUTING_KEYS) ||
    typeof value.draft_insert !== 'boolean' ||
    typeof value.rewrite_selection !== 'boolean' ||
    typeof value.translate_selection !== 'boolean' ||
    typeof value.search !== 'boolean'
  ) {
    return invalidBackupSettings()
  }
  return {
    draft_insert: value.draft_insert,
    rewrite_selection: value.rewrite_selection,
    translate_selection: value.translate_selection,
    search: value.search,
  }
}

function parseCustomScene(value: unknown): CustomScene {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, CUSTOM_SCENE_KEYS) ||
    !isBoundedString(value.id, 1, 120) ||
    !isBoundedString(value.name, 1, 80) ||
    !isBoundedString(value.description, 0, 240) ||
    !isBoundedString(value.prompt_template, 0, 4000) ||
    !isBoundedString(value.created_at, 0, 64) ||
    !isBoundedString(value.updated_at, 0, 64)
  ) {
    return invalidBackupSettings()
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    prompt_template: value.prompt_template,
    created_at: value.created_at,
    updated_at: value.updated_at,
  }
}

function parseSystemSceneOverride(value: unknown): SystemSceneOverride {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, SYSTEM_SCENE_OVERRIDE_KEYS) ||
    !isBoundedString(value.id, 1, 120) ||
    !isBoundedString(value.prompt_template, 0, 4000)
  ) {
    return invalidBackupSettings()
  }
  return { id: value.id, prompt_template: value.prompt_template }
}

function parseActiveScene(value: unknown): ActiveScene | null {
  if (value === null) return null
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ACTIVE_SCENE_KEYS) ||
    !isBoundedString(value.id, 1, 120) ||
    !isEnumValue(value.source, SCENE_SOURCES) ||
    !isBoundedString(value.name, 1, 80) ||
    !isBoundedString(value.prompt_template, 0, 4000)
  ) {
    return invalidBackupSettings()
  }
  return {
    id: value.id,
    source: value.source,
    name: value.name,
    prompt_template: value.prompt_template,
  }
}

function parseFamilySceneAssignment(value: unknown): FamilySceneAssignment {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, FAMILY_SCENE_ASSIGNMENT_KEYS) ||
    !isEnumValue(value.family, CONTEXT_FAMILIES) ||
    !isBoundedString(value.scene_id, 1, 120)
  ) {
    return invalidBackupSettings()
  }
  return { family: value.family, scene_id: value.scene_id }
}

function parseTranslation(value: unknown): TranslationConfig {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TRANSLATION_KEYS) ||
    !Array.isArray(value.targets) ||
    value.targets.length < 1 ||
    value.targets.length > 5 ||
    !value.targets.every((target) => isBoundedString(target, 2, 16)) ||
    new Set(value.targets).size !== value.targets.length ||
    !isBoundedString(value.active_target, 2, 16)
  ) {
    return invalidBackupSettings()
  }
  return { targets: [...value.targets], active_target: value.active_target }
}

function parseShortcutBinding(value: unknown): ShortcutBinding {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, SHORTCUT_BINDING_KEYS) ||
    !isBoundedString(value.primary, 1, 32) ||
    !Array.isArray(value.modifiers) ||
    value.modifiers.length > 4 ||
    !value.modifiers.every((modifier) => isBoundedString(modifier, 1, 16)) ||
    new Set(value.modifiers).size !== value.modifiers.length
  ) {
    return invalidBackupSettings()
  }

  return { primary: value.primary, modifiers: [...value.modifiers] }
}

function parseNullableShortcutBinding(value: unknown): ShortcutBinding | null {
  return value === null ? null : parseShortcutBinding(value)
}

function parseShortcutBindingList(value: unknown, requireOne = false): ShortcutBinding[] {
  if (!Array.isArray(value) || value.length > 3 || (requireOne && value.length === 0)) {
    return invalidBackupSettings()
  }
  const bindings = value.map(parseShortcutBinding)
  const identities = bindings.map((binding) => JSON.stringify(binding))
  if (new Set(identities).size !== identities.length) return invalidBackupSettings()
  return bindings
}

function parseHotkeys(value: unknown): HotkeyConfig {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, HOTKEY_CONFIG_KEYS) ||
    !isEnumValue(value.dictationMode, HOTKEY_MODES)
  ) {
    return invalidBackupSettings()
  }

  const dictation = parseShortcutBinding(value.dictation)
  const ask = parseNullableShortcutBinding(value.ask)
  const translate = parseNullableShortcutBinding(value.translate)
  const dictationBindings = parseShortcutBindingList(value.dictationBindings, true)
  const askBindings = parseShortcutBindingList(value.askBindings)
  const translateBindings = parseShortcutBindingList(value.translateBindings)
  const editSelection = parseNullableShortcutBinding(value.editSelection)
  const switchScene = parseNullableShortcutBinding(value.switchScene)
  const openApp = parseNullableShortcutBinding(value.openApp)

  if (JSON.stringify(dictation) !== JSON.stringify(dictationBindings[0])) {
    return invalidBackupSettings()
  }
  if (JSON.stringify(ask) !== JSON.stringify(askBindings[0] ?? null)) {
    return invalidBackupSettings()
  }
  if (JSON.stringify(translate) !== JSON.stringify(translateBindings[0] ?? null)) {
    return invalidBackupSettings()
  }

  return {
    dictation,
    ask,
    translate,
    dictationBindings,
    askBindings,
    translateBindings,
    editSelection,
    switchScene,
    openApp,
    dictationMode: value.dictationMode,
  }
}

function mapBoundedArray<T>(value: unknown, maximum: number, parser: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) return invalidBackupSettings()
  return value.map(parser)
}

export function parseBackupSettings(value: unknown): BackupSettings {
  if (!isRecord(value) || !hasExactKeys(value, BACKUP_SETTINGS_KEYS)) {
    return invalidBackupSettings()
  }

  if (
    !isBoundedString(value.stt_language, 0, 32) ||
    typeof value.polish_enabled !== 'boolean' ||
    typeof value.context_adaptation_enabled !== 'boolean' ||
    !isEnumValue(value.polish_style, POLISH_STYLES) ||
    !isBoundedString(value.polish_custom_prompt, 0, 2000) ||
    !isEnumValue(value.polish_chinese_script, CHINESE_SCRIPTS) ||
    typeof value.translate_enabled !== 'boolean' ||
    !isBoundedString(value.target_lang, 2, 16) ||
    !isBoundedString(value.hotkey, 0, 100) ||
    !isBoundedString(value.ask_hotkey, 0, 100) ||
    !isEnumValue(value.hotkey_mode, HOTKEY_MODES) ||
    !isEnumValue(value.output_mode, OUTPUT_MODES) ||
    !isEnumValue(value.insertion_strategy, INSERTION_STRATEGIES) ||
    typeof value.restore_clipboard_after_paste !== 'boolean' ||
    !isEnumValue(value.paste_shortcut, PASTE_SHORTCUTS) ||
    !isEnumValue(value.windows_sendinput_newline_mode, WINDOWS_NEWLINE_MODES) ||
    typeof value.streaming_insert_enabled !== 'boolean' ||
    typeof value.selected_text_enabled !== 'boolean' ||
    !isEnumValue(value.theme, THEMES) ||
    typeof value.auto_start !== 'boolean' ||
    typeof value.close_to_tray !== 'boolean' ||
    typeof value.start_minimized !== 'boolean' ||
    !(value.max_recording_seconds === 0 || isBoundedInteger(value.max_recording_seconds, 5, 720)) ||
    typeof value.history_enabled !== 'boolean' ||
    !isBoundedInteger(value.history_retention_days, 0, 3650) ||
    !isBoundedInteger(value.history_max_entries, 1, 5000) ||
    !isBoundedString(value.ui_language, 2, 16) ||
    typeof value.capsule_auto_hide !== 'boolean'
  ) {
    return invalidBackupSettings()
  }

  const voiceRoutingFlags = parseVoiceRoutingFlags(value.voice_routing_flags)
  const customScenes = mapBoundedArray(value.custom_scenes, 100, parseCustomScene)
  const systemSceneOverrides = mapBoundedArray(
    value.system_scene_overrides,
    100,
    parseSystemSceneOverride,
  )
  const activeScene = parseActiveScene(value.active_scene)
  const familySceneAssignments = mapBoundedArray(
    value.family_scene_assignments,
    10,
    parseFamilySceneAssignment,
  )
  const translation = parseTranslation(value.translation)
  const hotkeys = parseHotkeys(value.hotkeys)

  return {
    stt_language: value.stt_language,
    polish_enabled: value.polish_enabled,
    context_adaptation_enabled: value.context_adaptation_enabled,
    voice_routing_flags: voiceRoutingFlags,
    polish_style: value.polish_style,
    polish_custom_prompt: value.polish_custom_prompt,
    polish_chinese_script: value.polish_chinese_script,
    custom_scenes: customScenes,
    system_scene_overrides: systemSceneOverrides,
    active_scene: activeScene,
    family_scene_assignments: familySceneAssignments,
    translate_enabled: value.translate_enabled,
    target_lang: value.target_lang,
    translation,
    hotkey: value.hotkey,
    ask_hotkey: value.ask_hotkey,
    hotkey_mode: value.hotkey_mode,
    hotkeys,
    output_mode: value.output_mode,
    insertion_strategy: value.insertion_strategy,
    restore_clipboard_after_paste: value.restore_clipboard_after_paste,
    paste_shortcut: value.paste_shortcut,
    windows_sendinput_newline_mode: value.windows_sendinput_newline_mode,
    streaming_insert_enabled: value.streaming_insert_enabled,
    selected_text_enabled: value.selected_text_enabled,
    theme: value.theme,
    auto_start: value.auto_start,
    close_to_tray: value.close_to_tray,
    start_minimized: value.start_minimized,
    max_recording_seconds: value.max_recording_seconds,
    history_enabled: value.history_enabled,
    history_retention_days: value.history_retention_days,
    history_max_entries: value.history_max_entries,
    ui_language: value.ui_language,
    capsule_auto_hide: value.capsule_auto_hide,
  }
}

function safeBinding(binding: ShortcutBinding | null | undefined): ShortcutBinding | null {
  if (!binding) return null
  return {
    primary: binding.primary,
    modifiers: Array.isArray(binding.modifiers) ? [...binding.modifiers] : [],
  }
}

export function createBackupSettings(config: AppConfig): BackupSettings {
  const dictationBindings = (
    Array.isArray(config.hotkeys.dictationBindings)
      ? config.hotkeys.dictationBindings
      : [config.hotkeys.dictation]
  )
    .map((binding) => safeBinding(binding))
    .filter((binding): binding is ShortcutBinding => Boolean(binding))
  const askBindings = (
    Array.isArray(config.hotkeys.askBindings)
      ? config.hotkeys.askBindings
      : config.hotkeys.ask
        ? [config.hotkeys.ask]
        : []
  )
    .map((binding) => safeBinding(binding))
    .filter((binding): binding is ShortcutBinding => Boolean(binding))
  const translateBindings = (
    Array.isArray(config.hotkeys.translateBindings)
      ? config.hotkeys.translateBindings
      : config.hotkeys.translate
        ? [config.hotkeys.translate]
        : []
  )
    .map((binding) => safeBinding(binding))
    .filter((binding): binding is ShortcutBinding => Boolean(binding))

  return {
    stt_language: config.stt_language,
    polish_enabled: config.polish_enabled,
    context_adaptation_enabled: config.context_adaptation_enabled,
    voice_routing_flags: {
      draft_insert: config.voice_routing_flags.draft_insert,
      rewrite_selection: config.voice_routing_flags.rewrite_selection,
      translate_selection: config.voice_routing_flags.translate_selection,
      search: config.voice_routing_flags.search,
    },
    polish_style: config.polish_style,
    polish_custom_prompt: config.polish_custom_prompt,
    polish_chinese_script: config.polish_chinese_script,
    custom_scenes: config.custom_scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      description: scene.description,
      prompt_template: scene.prompt_template,
      created_at: scene.created_at,
      updated_at: scene.updated_at,
    })),
    system_scene_overrides: config.system_scene_overrides.map((scene) => ({
      id: scene.id,
      prompt_template: scene.prompt_template,
    })),
    active_scene: config.active_scene
      ? {
          id: config.active_scene.id,
          source: config.active_scene.source,
          name: config.active_scene.name,
          prompt_template: config.active_scene.prompt_template,
        }
      : null,
    family_scene_assignments: config.family_scene_assignments.map((assignment) => ({
      family: assignment.family,
      scene_id: assignment.scene_id,
    })),
    translate_enabled: config.translate_enabled,
    target_lang: config.target_lang,
    translation: {
      targets: [...config.translation.targets],
      active_target: config.translation.active_target,
    },
    hotkey: config.hotkey,
    ask_hotkey: config.ask_hotkey,
    hotkey_mode: config.hotkey_mode,
    hotkeys: {
      dictation: safeBinding(config.hotkeys.dictation)!,
      ask: safeBinding(config.hotkeys.ask),
      translate: safeBinding(config.hotkeys.translate),
      dictationBindings,
      askBindings,
      translateBindings,
      editSelection: safeBinding(config.hotkeys.editSelection),
      switchScene: safeBinding(config.hotkeys.switchScene),
      openApp: safeBinding(config.hotkeys.openApp),
      dictationMode: config.hotkeys.dictationMode,
    },
    output_mode: config.output_mode,
    insertion_strategy: config.insertion_strategy,
    restore_clipboard_after_paste: config.restore_clipboard_after_paste,
    paste_shortcut: config.paste_shortcut,
    windows_sendinput_newline_mode: config.windows_sendinput_newline_mode,
    streaming_insert_enabled: config.streaming_insert_enabled,
    selected_text_enabled: config.selected_text_enabled,
    theme: config.theme,
    auto_start: config.auto_start,
    close_to_tray: config.close_to_tray,
    start_minimized: config.start_minimized,
    max_recording_seconds: config.max_recording_seconds,
    history_enabled: config.history_enabled,
    history_retention_days: config.history_retention_days,
    history_max_entries: config.history_max_entries,
    ui_language: config.ui_language,
    capsule_auto_hide: config.capsule_auto_hide,
  }
}

export function mergeBackupSettings(current: AppConfig, backup: unknown): AppConfig {
  const portable = parseBackupSettings(backup)
  return {
    ...current,
    ...portable,
  }
}

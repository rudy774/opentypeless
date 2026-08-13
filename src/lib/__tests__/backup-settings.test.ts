import { describe, expect, it } from 'vitest'
import { useAppStore } from '../../stores/appStore'
import {
  createBackupSettings,
  InvalidBackupSettingsError,
  mergeBackupSettings,
  parseBackupSettings,
} from '../backup-settings'

const providerRoutingKeys = [
  'stt_provider',
  'stt_custom_preset',
  'stt_custom_base_url',
  'stt_custom_model',
  'stt_volcengine_resource_id',
  'llm_provider',
  'llm_model',
  'llm_base_url',
] as const

describe('managed backup settings boundary', () => {
  it('uploads only portable preferences and never provider routing or credentials', () => {
    const current = {
      ...useAppStore.getState().config,
      stt_provider: 'custom-whisper' as const,
      stt_api_key: 'stt-secret',
      stt_custom_api_key: 'custom-secret',
      stt_custom_preset: 'custom' as const,
      stt_custom_base_url:
        'https://test-user:test-password@provider.example/v1?api_key=test-query-secret',
      stt_custom_model: 'private-model',
      stt_volcengine_resource_id: 'private-resource',
      llm_provider: 'gemini' as const,
      llm_api_key: 'llm-secret',
      llm_model: 'gemini-private',
      llm_base_url: 'https://llm.example/v1#test-fragment-secret',
      custom_scenes: [],
      system_scene_overrides: [{ id: 'system_email', prompt_template: 'Use a warm email body.' }],
      family_scene_assignments: [
        { family: 'email' as const, scene_id: 'builtin_professional_email' },
      ],
    }

    const settings = createBackupSettings(current)
    const serialized = JSON.stringify(settings)

    expect(settings.family_scene_assignments).toEqual([
      { family: 'email', scene_id: 'builtin_professional_email' },
    ])
    expect(settings.system_scene_overrides).toEqual([
      { id: 'system_email', prompt_template: 'Use a warm email body.' },
    ])
    for (const key of providerRoutingKeys) expect(settings).not.toHaveProperty(key)
    for (const forbidden of [
      'stt-secret',
      'custom-secret',
      'llm-secret',
      'test-user',
      'test-password',
      'test-query-secret',
      'test-fragment-secret',
      'private-model',
      'private-resource',
      'provider.example',
      'llm.example',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('round-trips the complete portable shape and rejects unknown or malformed nested fields', () => {
    const valid = createBackupSettings(useAppStore.getState().config)
    expect(parseBackupSettings(valid)).toEqual(valid)

    expect(() => parseBackupSettings({ ...valid, future_field: true })).toThrow(
      InvalidBackupSettingsError,
    )
    expect(() =>
      parseBackupSettings({
        ...valid,
        hotkeys: { ...valid.hotkeys, dictationMode: 'sometimes' },
      }),
    ).toThrow(InvalidBackupSettingsError)
    expect(() =>
      parseBackupSettings({
        ...valid,
        hotkeys: {
          ...valid.hotkeys,
          dictationBindings: Array.from({ length: 4 }, () => valid.hotkeys.dictation),
        },
      }),
    ).toThrow(InvalidBackupSettingsError)
    expect(() =>
      parseBackupSettings({
        ...valid,
        custom_scenes: [
          {
            id: 'scene',
            name: 'Scene',
            description: '',
            prompt_template: '',
            created_at: '',
            updated_at: '',
            injected: true,
          },
        ],
      }),
    ).toThrow(InvalidBackupSettingsError)
  })

  it('restores portable preferences while preserving the whole local provider-routing trust unit', () => {
    const current = {
      ...useAppStore.getState().config,
      stt_provider: 'custom-whisper' as const,
      stt_api_key: 'local-stt-secret',
      stt_custom_api_key: 'local-custom-secret',
      stt_custom_preset: 'custom' as const,
      stt_custom_base_url: 'https://local-stt.example/v1',
      stt_custom_model: 'local-stt-model',
      stt_volcengine_resource_id: 'local-resource',
      llm_provider: 'gemini' as const,
      llm_api_key: 'local-llm-secret',
      llm_model: 'local-llm-model',
      llm_base_url: 'https://local-llm.example/v1',
      polish_enabled: true,
    }
    const portable = {
      ...createBackupSettings(current),
      polish_enabled: false,
    }

    const merged = mergeBackupSettings(current, portable)

    expect(merged.polish_enabled).toBe(false)
    expect(merged.stt_api_key).toBe('local-stt-secret')
    expect(merged.stt_custom_api_key).toBe('local-custom-secret')
    expect(merged.llm_api_key).toBe('local-llm-secret')
    for (const key of providerRoutingKeys) expect(merged[key]).toBe(current[key])
  })

  it('rejects an injected provider endpoint before returning any merged config', () => {
    const current = useAppStore.getState().config
    const hostile = {
      ...createBackupSettings(current),
      llm_provider: 'gemini',
      llm_base_url: 'https://attacker.example/v1',
    }

    expect(() => mergeBackupSettings(current, hostile)).toThrow(InvalidBackupSettingsError)
    expect(useAppStore.getState().config).toEqual(current)
  })
})

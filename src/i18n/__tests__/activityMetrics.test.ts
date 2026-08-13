import { describe, expect, it } from 'vitest'
import de from '../locales/de.json'
import en from '../locales/en.json'
import es from '../locales/es.json'
import fr from '../locales/fr.json'
import itLocale from '../locales/it.json'
import ja from '../locales/ja.json'
import ko from '../locales/ko.json'
import pt from '../locales/pt.json'
import ru from '../locales/ru.json'
import zh from '../locales/zh.json'

const locales = { de, en, es, fr, it: itLocale, ja, ko, pt, ru, zh }

const metricKeys = [
  'retainedOutputCharacters',
  'retainedOutputOutcomes',
  'retainedAutomaticInsertions',
  'retainedFallbacks',
  'retainedFailures',
  'outputOutcomeCoverage',
  'retainedOutputScope',
  'durationCoverage',
  'lifetimeDurationCoverage',
  'invalidDurationsSelected_one',
  'invalidDurationsSelected_other',
  'invalidDurationsLifetime_one',
  'invalidDurationsLifetime_other',
  'turnaroundLatency',
  'typicalTurnaround',
  'slowEndTurnaround',
  'turnaroundCoverage',
  'transformedOutputsDetail',
  'timingOutliersSelected_one',
  'timingOutliersSelected_other',
] as const

describe('local activity metric translations', () => {
  it.each(Object.entries(locales))(
    '%s defines every retained-activity and latency label',
    (_locale, messages) => {
      const home = messages.home as Record<string, string>

      for (const key of metricKeys) {
        expect(home[key], `home.${key}`).toEqual(expect.any(String))
        expect(home[key].trim(), `home.${key}`).not.toBe('')
      }
    },
  )
})

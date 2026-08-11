import { describe, expect, it } from 'vitest'
import de from '../locales/de.json'
import en from '../locales/en.json'
import es from '../locales/es.json'
import fr from '../locales/fr.json'
import itMessages from '../locales/it.json'
import ja from '../locales/ja.json'
import ko from '../locales/ko.json'
import pt from '../locales/pt.json'
import ru from '../locales/ru.json'
import zh from '../locales/zh.json'

const locales = { de, en, es, fr, it: itMessages, ja, ko, pt, ru, zh }

describe('capsule movement guide translations', () => {
  it.each(Object.entries(locales))('%s defines the full movement guide', (_locale, messages) => {
    expect(messages.capsule.moveGuide.title.trim()).not.toBe('')
    expect(messages.capsule.moveGuide.description.trim()).not.toBe('')
    expect(messages.capsule.moveGuide.dismiss.trim()).not.toBe('')
  })
})

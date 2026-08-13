import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  test: {
    environment: 'node',
    include: ['services/managed-api/src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
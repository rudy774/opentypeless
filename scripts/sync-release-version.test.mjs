import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildVersionUpdates,
  parseReleaseTag,
  runCli,
  syncReleaseVersion,
} from './sync-release-version.mjs'

function createRepositoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opentypeless-release-version-'))
  fs.mkdirSync(path.join(root, 'src-tauri'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'opentypeless', version: '0.1.42' }, null, 2) + '\n',
  )
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'opentypeless',
        version: '0.1.42',
        lockfileVersion: 3,
        packages: { '': { name: 'opentypeless', version: '0.1.42' } },
      },
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(root, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ productName: 'OpenTypeless', version: '0.1.42' }, null, 2) + '\n',
  )
  fs.writeFileSync(
    path.join(root, 'src-tauri', 'Cargo.toml'),
    '[package]\nname = "opentypeless"\nversion = "0.1.42"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n',
  )
  fs.writeFileSync(
    path.join(root, 'src-tauri', 'Cargo.lock'),
    'version = 4\n\n[[package]]\nname = "opentypeless"\nversion = "0.1.42"\ndependencies = [\n "serde",\n]\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n',
  )
  return root
}

test('accepts only stable vMAJOR.MINOR.PATCH release tags', () => {
  assert.deepEqual(parseReleaseTag('v1.2.3'), { tag: 'v1.2.3', version: '1.2.3' })
  for (const value of [
    '1.2.3',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2',
    'v1.2.3-beta.1',
    'v1.2.3; echo pwned',
    'v1.2.3$(touch owned)',
    'v1.2.3\nmalicious=true',
    '',
  ]) {
    assert.throws(() => parseReleaseTag(value), /exact stable format/)
  }
})

test('builds every update before writing any file', () => {
  const root = createRepositoryFixture()
  const originalPackage = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  fs.writeFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), '[dependencies]\nserde = "1"\n')

  assert.throws(() => syncReleaseVersion(root, 'v2.3.4'), /\[package\] section/)
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), originalPackage)
})

test('synchronizes npm, Tauri, and Cargo version metadata', () => {
  const root = createRepositoryFixture()
  const result = syncReleaseVersion(root, 'v2.3.4')

  assert.equal(result.version, '2.3.4')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '2.3.4')
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')))
  assert.equal(packageLock.version, '2.3.4')
  assert.equal(packageLock.packages[''].version, '2.3.4')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'))).version,
    '2.3.4',
  )
  assert.match(
    fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8'),
    /version = "2\.3\.4"/,
  )
  const cargoLock = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), 'utf8')
  assert.match(cargoLock, /name = "opentypeless"\nversion = "2\.3\.4"/)
  assert.match(cargoLock, /name = "serde"\nversion = "1\.0\.0"/)
})

test('validation mode does not modify repository files', () => {
  const root = createRepositoryFixture()
  const before = new Map(
    [...buildVersionUpdates(root, 'v1.2.3').files.keys()].map((filePath) => [
      filePath,
      fs.readFileSync(filePath, 'utf8'),
    ]),
  )
  const githubOutput = path.join(root, 'github-output.txt')
  const result = runCli({
    argv: ['--validate-only'],
    env: { RELEASE_TAG: 'v7.8.9', GITHUB_OUTPUT: githubOutput },
    cwd: root,
  })

  assert.deepEqual(result, { tag: 'v7.8.9', version: '7.8.9' })
  assert.equal(fs.readFileSync(githubOutput, 'utf8'), 'tag=v7.8.9\nversion=7.8.9\n')
  for (const [filePath, contents] of before) {
    assert.equal(fs.readFileSync(filePath, 'utf8'), contents)
  }
})

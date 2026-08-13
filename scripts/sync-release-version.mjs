import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const STABLE_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseReleaseTag(rawTag) {
  if (typeof rawTag !== 'string' || !STABLE_RELEASE_TAG.test(rawTag)) {
    throw new Error('Release tag must use the exact stable format vMAJOR.MINOR.PATCH.')
  }

  return { tag: rawTag, version: rawTag.slice(1) }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function replaceCargoPackageVersion(contents, version, fileName) {
  const packageSectionMatch = contents.match(
    /(^\[package\][^\S\r\n]*$)([\s\S]*?)(?=^\[[^\]]+\][^\S\r\n]*$|(?![\s\S]))/m,
  )
  if (!packageSectionMatch) {
    throw new Error(`${fileName} does not contain a [package] section.`)
  }

  const versionMatches = [...packageSectionMatch[2].matchAll(/^version\s*=\s*"[^"]*"\s*$/gm)]
  if (versionMatches.length !== 1) {
    throw new Error(`${fileName} [package] must contain exactly one version field.`)
  }

  const updatedSection = packageSectionMatch[2].replace(
    /^version\s*=\s*"[^"]*"\s*$/m,
    `version = "${version}"`,
  )

  return contents.replace(packageSectionMatch[0], `${packageSectionMatch[1]}${updatedSection}`)
}

function replaceCargoLockVersion(contents, version) {
  const packageBlocks =
    contents.match(/\[\[package\]\][\s\S]*?(?=\r?\n\[\[package\]\]|(?![\s\S]))/g) ?? []
  const matchingBlocks = packageBlocks.filter((block) =>
    /^name\s*=\s*"opentypeless"\s*$/m.test(block),
  )

  if (matchingBlocks.length !== 1) {
    throw new Error('src-tauri/Cargo.lock must contain exactly one opentypeless package entry.')
  }

  const block = matchingBlocks[0]
  const versionMatches = [...block.matchAll(/^version\s*=\s*"[^"]*"\s*$/gm)]
  if (versionMatches.length !== 1) {
    throw new Error('The opentypeless Cargo.lock package entry must contain one version field.')
  }

  const updatedBlock = block.replace(/^version\s*=\s*"[^"]*"\s*$/m, `version = "${version}"`)
  return contents.replace(block, updatedBlock)
}

export function buildVersionUpdates(repositoryRoot, rawTag) {
  const { tag, version } = parseReleaseTag(rawTag)
  const packagePath = path.join(repositoryRoot, 'package.json')
  const packageLockPath = path.join(repositoryRoot, 'package-lock.json')
  const tauriConfigPath = path.join(repositoryRoot, 'src-tauri', 'tauri.conf.json')
  const cargoTomlPath = path.join(repositoryRoot, 'src-tauri', 'Cargo.toml')
  const cargoLockPath = path.join(repositoryRoot, 'src-tauri', 'Cargo.lock')

  const packageJson = readJson(packagePath)
  const packageLock = readJson(packageLockPath)
  const tauriConfig = readJson(tauriConfigPath)
  const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8')
  const cargoLock = fs.readFileSync(cargoLockPath, 'utf8')

  if (packageLock.packages?.['']?.name !== packageJson.name) {
    throw new Error('package-lock.json root package does not match package.json.')
  }

  packageJson.version = version
  packageLock.version = version
  packageLock.packages[''].version = version
  tauriConfig.version = version

  return {
    tag,
    version,
    files: new Map([
      [packagePath, formatJson(packageJson)],
      [packageLockPath, formatJson(packageLock)],
      [tauriConfigPath, formatJson(tauriConfig)],
      [cargoTomlPath, replaceCargoPackageVersion(cargoToml, version, 'src-tauri/Cargo.toml')],
      [cargoLockPath, replaceCargoLockVersion(cargoLock, version)],
    ]),
  }
}

export function syncReleaseVersion(repositoryRoot, rawTag) {
  const update = buildVersionUpdates(repositoryRoot, rawTag)
  const temporaryFiles = []

  try {
    for (const [filePath, contents] of update.files) {
      const temporaryPath = `${filePath}.release-version-${process.pid}.tmp`
      fs.writeFileSync(temporaryPath, contents, 'utf8')
      temporaryFiles.push([filePath, temporaryPath])
    }
    for (const [filePath, temporaryPath] of temporaryFiles) {
      fs.renameSync(temporaryPath, filePath)
    }
  } finally {
    for (const [, temporaryPath] of temporaryFiles) {
      fs.rmSync(temporaryPath, { force: true })
    }
  }

  return update
}

function readTagArgument(argv, env) {
  const positional = argv.filter((value) => value !== '--validate-only')
  if (positional.length > 1) {
    throw new Error('Pass at most one release tag argument.')
  }
  return positional[0] ?? env.RELEASE_TAG
}

function appendGithubMetadata(env, { tag, version }) {
  if (env.GITHUB_ENV) {
    fs.appendFileSync(env.GITHUB_ENV, `VITE_APP_VERSION=${tag}\n`, 'utf8')
  }
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, `tag=${tag}\nversion=${version}\n`, 'utf8')
  }
}

export function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const rawTag = readTagArgument(argv, env)
  const validateOnly = argv.includes('--validate-only')
  const result = validateOnly ? parseReleaseTag(rawTag) : syncReleaseVersion(cwd, rawTag)
  appendGithubMetadata(env, result)
  return result
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    const result = runCli()
    console.log(
      `Release ${result.tag} validated${process.argv.includes('--validate-only') ? '' : ' and synced'}.`,
    )
  } catch (error) {
    console.error(
      `Release version error: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    process.exitCode = 1
  }
}

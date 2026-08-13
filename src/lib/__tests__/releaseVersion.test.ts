import { describe, expect, it } from 'vitest'
import constantsSource from '../constants.ts?raw'
import windowsCertificateScriptSource from '../../../.github/scripts/import-windows-certificate.ps1?raw'
import releaseWorkflowSource from '../../../.github/workflows/release.yml?raw'

function workflowJob(name: string, nextName?: string): string {
  const start = releaseWorkflowSource.indexOf(`\n  ${name}:`)
  const end = nextName ? releaseWorkflowSource.indexOf(`\n  ${nextName}:`, start + 1) : -1
  expect(start).toBeGreaterThanOrEqual(0)
  if (nextName) expect(end).toBeGreaterThan(start)
  return releaseWorkflowSource.slice(start, end >= 0 ? end : undefined)
}

describe('release version wiring', () => {
  it('lets frontend builds read the release tag version from Vite env', () => {
    expect(constantsSource).toContain('import.meta.env.VITE_APP_VERSION')
  })

  it('validates one stable release tag and syncs every build from it', () => {
    const preflightJob = workflowJob('preflight', 'create-draft-release')
    const buildJob = workflowJob('build', 'verify-and-publish')

    expect(releaseWorkflowSource).toContain(
      'Release tag must use the exact stable format vMAJOR.MINOR.PATCH.',
    )
    expect(preflightJob).toContain('RELEASE_TAG: ${{ needs.resolve-source.outputs.tag }}')
    expect(preflightJob).toContain('run: node scripts/sync-release-version.mjs')
    expect(buildJob).toContain('RELEASE_TAG: ${{ needs.resolve-source.outputs.tag }}')
    expect(buildJob).toContain('run: node scripts/sync-release-version.mjs')
    expect(releaseWorkflowSource).not.toContain('VITE_APP_VERSION=v$VERSION')
  })

  it('uploads each current-repository matrix build only to the draft release', () => {
    const buildJob = workflowJob('build', 'verify-and-publish')

    expect(buildJob).toContain('owner: ${{ github.repository_owner }}')
    expect(buildJob).toContain('repo: ${{ github.event.repository.name }}')
    expect(buildJob).toContain('releaseCommitish: ${{ needs.resolve-source.outputs.commit }}')
    expect(buildJob).toContain('releaseDraft: true')
    expect(buildJob).not.toContain('releaseDraft: false')
  })

  it('requires production signing and rejects unsafe unsigned or test artifacts', () => {
    expect(windowsCertificateScriptSource).toContain('Public Windows releases must be signed.')
    expect(windowsCertificateScriptSource).not.toContain('ALLOW_UNSIGNED_WINDOWS')
    expect(windowsCertificateScriptSource).not.toContain('allowUnsigned')
    expect(releaseWorkflowSource).toContain(
      "unsafe_asset_pattern='(^|[._-])(unsigned|test|debug|dev)([._-]|$)'",
    )
    expect(releaseWorkflowSource).toContain('Draft contains an unsafe unsigned/test asset:')
  })

  it('allows only the aggregate verification job to publish the draft', () => {
    const buildJob = workflowJob('build', 'verify-and-publish')
    const publishJob = workflowJob('verify-and-publish')
    const publishCommands = releaseWorkflowSource.match(/--draft=false/g) ?? []

    expect(publishCommands).toHaveLength(1)
    expect(buildJob).not.toContain('--draft=false')
    expect(publishJob).toContain('needs: [resolve-source, create-draft-release, build]')
    expect(publishJob).toContain('Verify the complete draft and publish atomically')
    expect(publishJob).toContain(
      'gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false',
    )
  })
})

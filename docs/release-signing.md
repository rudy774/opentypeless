# Release Signing Setup

Release automation publishes only to the repository that runs the workflow. It is disabled unless the repository variable `COMMERCIAL_RELEASE_ENABLED` is exactly `true`. The workflow resolves an existing stable `vMAJOR.MINOR.PATCH` tag to one immutable commit on the default branch, runs preflight checks, and builds only that commit.

Every platform uploads to a GitHub draft release. The release becomes public only after every selected build succeeds and the final gate confirms the tag and release target have not moved, required platform assets are present, and no asset is labeled unsigned, test, debug, or development. A failed or cancelled build leaves a private draft; it never publishes the successful platforms by themselves. Delete a stale draft manually before retrying so old assets cannot be reused accidentally.

Auto-update is intentionally disabled. Updater signing keys, updater manifests, and updater artifacts are not part of this release process. Never commit signing credentials or place them in `.env.commercial`.

## Required repository variables

Configure these GitHub Actions repository variables before enabling releases:

- `COMMERCIAL_RELEASE_ENABLED=true`
- `COMMERCIAL_API_ORIGIN`
- `COMMERCIAL_WEBSITE_URL`
- `COMMERCIAL_REPOSITORY_URL`
- `COMMERCIAL_SUPPORT_URL`
- `COMMERCIAL_PRIVACY_URL`
- `COMMERCIAL_TERMS_URL`
- `COMMERCIAL_PRODUCT_NAME`
- `COMMERCIAL_APP_IDENTIFIER`
- `COMMERCIAL_DEEP_LINK_SCHEME`

The commercial release guard requires owned HTTPS URLs and rejects placeholder or upstream OpenTypeless identities.

## Required GitHub secrets

Store these secrets in the Rudy-owned repository that runs the workflow.

### macOS

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

The macOS job fails unless every secret is present. After the Tauri build, it verifies the app's code signature and validates the notarization ticket on every DMG before the final publish job can run.

### Linux

- `LINUX_GPG_PRIVATE_KEY`: base64-encoded ASCII-armored private GPG key
- `LINUX_GPG_KEY_ID`: GPG key ID or fingerprint
- `LINUX_GPG_PASSPHRASE`: GPG key passphrase

The workflow creates detached signatures for each AppImage, DEB, and RPM, signs the checksum file, and publishes the verification key. The final gate requires every one of those verification assets.

### Windows

- `WINDOWS_CERTIFICATE`: base64-encoded production PFX code-signing certificate
- `WINDOWS_CERTIFICATE_PASSWORD`: PFX password
- `WINDOWS_TIMESTAMP_URL`: optional timestamp server URL; defaults to DigiCert

There is no unsigned-release override. Both Windows secrets are mandatory, and the job verifies each MSI and NSIS installer has a valid Authenticode signature, a trusted timestamp, and no test or development certificate identity before the final publish job can run.

The repository retains inert placeholders for the retired SignPath and standalone macOS stapling workflows. Their only jobs are hard-disabled and contain no checkout, build, signing, upload, or publication steps. They are not supported alternatives to the reviewed `release.yml` pipeline. Reintroducing either flow requires a new security review, immutable-source checks, pinned actions, and integration with the same draft-release gate.

## Running a release

1. Merge the intended release commit into the default branch.
2. Create and push an exact stable tag such as `v1.2.3` on that commit.
3. Let the tag-triggered workflow build all three platforms, or manually dispatch the workflow from the default branch with an existing tag and an explicit platform selection.
4. Confirm the `verify-and-publish` job completed. If it did not, the release must remain a draft.

A manual single-platform selection publishes only that selected platform after its checks pass. Use `all` for a normal public release.

## Windows certificate notes

Use a production code-signing certificate. SSL/TLS certificates cannot sign Windows desktop applications. EV certificates generally establish SmartScreen reputation immediately; OV certificates can require reputation to accumulate.

If you receive a `.pfx`, encode it before saving it as a GitHub secret:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) |
  Set-Content -NoNewline windows-certificate-base64.txt
```

Save the content of `windows-certificate-base64.txt` as `WINDOWS_CERTIFICATE`. Do not commit either file.

## Linux GPG notes

Generate a release-only GPG key, export it, and base64 encode it:

```bash
gpg --full-gen-key
gpg --armor --export-secret-keys "OpenTypeless Release" > opentypeless-linux-private.asc
openssl base64 -A -in opentypeless-linux-private.asc -out opentypeless-linux-private.asc.base64
gpg --list-secret-keys --keyid-format LONG
```

Save the encoded private key as `LINUX_GPG_PRIVATE_KEY`, the fingerprint as `LINUX_GPG_KEY_ID`, and the passphrase as `LINUX_GPG_PASSPHRASE`. Keep the unencoded private key offline.

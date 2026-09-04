# Jarvis Command for Android

This directory contains the signed Android Trusted Web Activity (TWA) wrapper for Jarvis Command. It installs as package `com.kumargg.jarviscommand` and opens `https://command.sharma-house.com/` through a trusted browser provider; it does not embed a generic WebView or store Cloudflare credentials.

## Release identity

- App version: `0.1.0` (`versionCode` 1)
- Minimum SDK: 23
- Target/compile SDK: 36
- Android Gradle Plugin: 8.13.2
- Gradle: 8.13 (distribution checksum pinned)
- Android Browser Helper: 2.7.3
- Signing certificate SHA-256: `62:1C:87:98:E1:AF:33:0A:60:AA:7F:1B:8B:B7:68:9B:BC:9C:66:2C:B1:8B:94:A7:E8:9F:0E:5F:07:C1:34:D0`

The private key and passwords live outside the repository in `/home/neal/.config/jarvis-command/android/`, mode `0600`. Preserve that signing identity: Android updates require the same certificate.

## Build

Prerequisites are JDK 17 and an Android SDK containing platform/build tools 36. Use the repository release gate, not a raw Gradle command:

```bash
deploy/build-android-release.sh
```

The gate validates signing-file ownership and modes without sourcing it, runs unit tests, Android lint, R8, and release assembly, verifies the APK signature/certificate/package/version/SDK/permission contract, then writes:

```text
dist/android/jarvis-command-v0.1.0.apk
```

A raw Gradle build may be unsigned when the external signing properties are absent. Never distribute that output.

## Web association

`apps/web/public/.well-known/assetlinks.json` delegates `command.sharma-house.com` only to this package and release certificate. Android must fetch that exact static file anonymously. Configure a separate Cloudflare Access Bypass application for the file and a more-specific `/.well-known/assetlinks.json/*` Block application for descendants; Cloudflare otherwise treats the file path as a prefix. Every shell/API route remains behind Cloudflare Access.

Deploy the reviewed bytes to the current VM without replacing its approved app image:

```bash
APPROVED_APP_IMAGE_ID=sha256:2fd64f267f33feeb6a17a20e37b2a6594e3398817ba114b8ead13bc949cfe654
deploy/release-android-association.sh "$SSH_TARGET" "$SSH_KEY" "$APPROVED_APP_IMAGE_ID"
```

The publisher rejects every other digest, streams the privileged helper directly into noninteractive `sudo`, and binds the root-side descriptor snapshot to the reviewed Compose and association SHA-256 values. The general app-image release intentionally does not carry `assetlinks.json`; association remains its own recoverable transaction. Keep the returned `/var/backups/jarvis-command/association-<UTC timestamp>` directory as the rollback handle.

Without a valid public association, the APK safely falls back to a Custom Tab with browser chrome. That is a failed release gate, not the intended app experience.

## Installation

Stage the verified APK through the allowlisted phone bridge `apk-stage` action into `Downloads/Jarvis-APK`, then install it manually on-device. Android installer approval is deliberately not automated.

After installation, verify first launch, Cloudflare authentication, full-screen TWA presentation, app-link ownership, relaunch from the launcher, and behavior after the phone changes between Wi-Fi and cellular.

## Regeneration

The checked-in project was generated with Bubblewrap CLI 1.25.0 and then minimally hardened. The production manifest and icons are Access-protected, so a naive `bubblewrap update` follows the login redirect and fails. If regeneration is required, serve `apps/web/public` from a temporary loopback HTTP server, use those local icon URLs during generation, omit the optional bundled `webManifestUrl`, then reapply and test the hardening in `deploy/android-packaging.test.mjs`.

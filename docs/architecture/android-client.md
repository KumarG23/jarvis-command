# Android client architecture

## Decision

Jarvis Command ships to Neal's Android devices as a signed Trusted Web Activity (TWA) APK under package `com.kumargg.jarviscommand`.

The production web application at `https://command.sharma-house.com/` remains the UI and secure backend. Android Browser Helper launches that owned HTTPS origin through the device's trusted browser engine in standalone mode. This is deliberately not an embedded WebView.

## Why this foundation

- The responsive PWA, service worker, install icons, and Cloudflare Access flow already work on the actual phone.
- A TWA produces a normal sideloadable launcher app without duplicating the TypeScript UI in a second native client.
- Cloudflare Access authentication remains in Chrome's established cookie and MFA context; a WebView would create a separate, brittle authentication silo.
- Native Kotlin remains the correct future choice only when Jarvis Command needs substantial device-local capabilities that a browser cannot safely provide. Those capabilities do not exist in the read-only v0.1 slice.

Rejected alternatives:

- **Generic WebView wrapper:** weaker trust boundary, independent cookie jar, poorer Cloudflare authentication behavior, and more security surface.
- **Full native rewrite:** duplicates a working mobile UI and API contract before any native-only requirement earns that maintenance cost.
- **Browser-installed PWA only:** technically functional, but it does not satisfy the explicit sideloaded-APK distribution requirement.

## Release contract

- Package ID: `com.kumargg.jarviscommand`
- Version: `0.1.0` (`versionCode` 1)
- Minimum Android API: 23
- Target/compile API: 36
- Launch origin: `https://command.sharma-house.com/`
- Fallback: Custom Tabs only; no WebView fallback
- Android permissions: no platform or user-granted permissions; the merged APK may contain only AndroidX's package-scoped `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` at `signature` protection
- Cleartext traffic: disabled
- Android backup: disabled; browser-owned Access state is not app data
- Signing key: dedicated Jarvis Command release key outside the repository under `~/.config/jarvis-command/android/`

The APK and website prove mutual ownership with Digital Asset Links. Android fetches `https://command.sharma-house.com/.well-known/assetlinks.json` without browser cookies, so that single static JSON path must be publicly readable. Cloudflare Access path matching also covers descendants; a more-specific `/.well-known/assetlinks.json/*` Block application must therefore guard suffixes without matching the parent file. No application shell, API, session, artifact, or command route may bypass Cloudflare Access. The exception is one metadata-only file.

If Digital Asset Links verification fails, the release fails: a Custom Tab with browser chrome is not accepted as the installed-app experience.

## Authentication and offline behavior

Cloudflare Access remains the outer human identity gate, including the exact approved identity and MFA policy. The origin still validates the signed Access assertion for protected API requests. The APK contains no Cloudflare, Hermes, bearer, or tunnel credential.

The service worker may retain the static shell for resilient startup, but live status and session data require the protected network path. Offline data must never be presented as current control-plane state.

## Build and device verification

A release must prove:

1. web tests, typecheck, lint, production build, and PWA API-exclusion tests pass;
2. `deploy/release-android-association.sh` deploys the reviewed association bytes through a read-only mount while the app container retains the approved immutable image ID;
3. Gradle test/lint/release assembly passes;
4. the signed APK package, version, certificate, HTTPS host, and lack of platform/user-granted permissions match this contract;
5. deployed `assetlinks.json` exactly matches the APK signing certificate;
6. Android reports the domain association verified;
7. a clean sideload launches standalone, completes Cloudflare Access in the trusted browser context, and reaches the dashboard;
8. relaunch, expired-auth behavior, back navigation, rotation, and offline/degraded behavior are honest;
9. the APK is staged through the checksum-verified phone bridge and Neal confirms installation on-device.

The website remains useful for desktop access, but Android's primary entry point is the installed app.

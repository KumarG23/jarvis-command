# Web Push — source implementation, production disabled

Issue #56 completes the P6 push path in source/local fixtures. It does not provision
production keys, enable push, alter egress/Access, send real pushes or deploy anything.
The #46/#51 inbox is merged via #50 (`98a1b3d`); its attempted release was rolled
back after the startup notification-service snapshot bug. #57 repairs that wiring
in this increment. Sol owns exact-head review, recoverable release and live readback.
**Phone check pending.**

## Behavior and limits

`WEB_PUSH_MODE` defaults to `disabled`. Absent keys boot normally. Even with mode
`enabled`, missing/invalid/mismatched keys yield `configuration` unavailable.
Disabled UI never calls permission, subscription or browser registration APIs; the
sender never claims a delivery, resolves DNS, sends or starts background work.
In-app preferences/inbox continue normally. Only explicit user interaction can
request permission/register. Permission denial/unsupported browsers stay honest.

Authenticated capability is `GET /api/notifications/push` (also projected in the
inbox). Registration is `POST /api/notifications/push/devices` with exactly the
bounded browser subscription JSON; revoke is
`POST /api/notifications/push/devices/:deviceId/revoke {}`. Existing verified
Access subject, same-origin/header/JSON mutation checks and rate limits apply.
Only device IDs/dates and, when available, the VAPID **public** key are returned.
Endpoint/key material stays in private `push-devices.json` beside the inbox and audit
ledger, with the existing 0700 directory / 0600 atomic-file checks. The inbox/audit
formats and admission semantics are unchanged; a rollback build can still read the
original inbox file. Push-store faults are reported without invalidating the inbox. A subscription cannot be rebound to
another actor while registered. Revocation takes effect for future claims;
already dispatched messages cannot be recalled. Revoke then explicitly register
to replace/renew a subscription; idempotent retries never extend its lifetime.

At most 8 devices per actor, 30-day registration lifetime (earlier browser expiry
wins), 2,048 exact device/event receipts per actor, 32 actors and the existing
2 MiB file bound. Receipts are never evicted: capacity stops new sends and is
reported unavailable. Keep the private mount and receipts across release/rollback;
never clear them to “retry”. A 24-hour notification age limit, read/category
checks and registration time prevent old-event/device backfill. Opt-out suppresses
new sends; re-enabling does not reconstruct suppressed events.

The existing run observer/notifier supplies the same durable opaque notification
ID; there is no new Hermes source, scheduler or background reconciliation timer.
Claims commit before sending. Crashes, ambiguous transport outcomes or receipt
write failures remain **unknown** and never resend. HTTP 404/410 revokes the
device; other HTTP failures and redirects are final failures. HTTP acceptance is
not proof of device display. Push/storage failures do not alter terminal auditing
or admission. Worker receipt/display failure may omit an alert; inbox/chat remain
the status authority.

The library generates VAPID and `aes128gcm` encrypted requests. Transport allows
only exact HTTPS `fcm.googleapis.com/fcm/send/<token>`,
`updates.push.services.mozilla.com/wpush/v2/<token>` and
`web.push.apple.com/<token-path>` destinations, no userinfo/query/fragment/alternate
port. No redirects, proxy or automatic retry. DNS must return public IPv4 only;
private/reserved/mixed answers fail closed, the approved address is pinned for
TLS connection, and the original hostname remains the TLS authority. IPv6-only
services are unsupported. One absolute 5-second deadline includes DNS/TLS/headers;
at most 8 concurrent device sends, 4 KiB encrypted body, 300-second push TTL.

Payload is only `{version:1,id:"ntf_…"}`. The worker supplies fixed generic title
and text, no approval buttons. Worker IndexedDB holds at most 2,048 exact IDs;
at that bound or on unavailable receipt storage it suppresses display, never
clears identities or retries. This browser-local bound spans accounts on that
installation. It contains no subscription or authenticated API data. The generated
worker precaches app assets; no authenticated APIs are cached. Clicks focus and
message an existing root app window (preserving drafts/live work), or open only
`/?notification=<opaque-id>` on the same origin. The app requires an explicit
Open click and the existing actor→notification→run→session/current-status inbox
readback before navigation. Missing/foreign/expired/denied targets are actionless;
an already active different run is retained by the existing inbox-open behavior.

Only **Command-observed** app-originated events can trigger delivery. A service
worker can display a dispatched push while closed, but this does **not** discover
new completions while no Command observer is running. CLI/Discord/other surfaces
remain unsupported pending an authoritative Hermes event/hook contract; no guessed
endpoint or historical message/run join is used.

## Final Neal packet — enablement (deferred, not executed)

1. Approve production Web Push egress and destinations separately. The existing
   restricted deployment network remains untouched; adding the environment flag
   alone does not grant network access. Review the fixed host/path list above and
   approve public DNS/HTTPS through the existing recoverable network process.
2. Provision one matching P-256 VAPID pair through the approved secret process.
   Place `WEB_PUSH_VAPID_PUBLIC_KEY` (87-char base64url uncompressed public point),
   `WEB_PUSH_VAPID_PRIVATE_KEY` (43-char base64url scalar) and
   `WEB_PUSH_VAPID_SUBJECT=mailto:<approved-contact>` in server-only secure env.
   Explicitly wire these and `WEB_PUSH_MODE=enabled` through the approved deployment
   configuration; this PR does not add runtime credential forwarding. Never put
   the private key in Vite env, source, logs, shell history or a browser store.
3. Sol releases the reviewed image through the recoverable path with retained
   prior image/state. Verify authenticated capability, then explicitly enable on
   one owned browser. Category preferences apply to recording and future sends.
   Roll back enablement by setting `WEB_PUSH_MODE=disabled` through that same
   process; preserve device/event receipts. Revoke devices explicitly as needed.
4. Prove one owned dispatch/display/click, authorization expiry and no duplicate
   after reconnect/restart. Do not clear an unknown receipt or repeat inference
   to force another send. For independent checks use a new explicitly owned event.

Phone/browser checklist after approved enablement: signed Android TWA and desktop
Chrome/Edge; explicit grant/deny; locked screen/app closed *after dispatch*; restart;
Wi-Fi/cellular; generic text only; reauthentication and missing/foreign target;
no remote approval; retained draft/active run; category off and per-device revoke;
no duplicate on repeated observation/reopen. Physical Android remains pending.
Native Android receiver is deferred unless actual signed-TWA proof warrants it.

## Local proof (no push service)

`npm run test -w @jarvis-command/server -- src/push.test.ts src/push-transport.test.ts src/notification-bootstrap.test.ts`
uses ephemeral keys, a captured transport, local receiver decryption, production
worker script with synthetic durable IndexedDB, mocked DNS/HTTP deadlines and an
owned loopback command-proxy fixture. `PushSettings.test.tsx` covers explicit
permission/device and reauthorization UI states. `e2e/notifications.spec.ts` covers
desktop/320/360/390/430 px plus short height. No production credential or real
push-send test is included.

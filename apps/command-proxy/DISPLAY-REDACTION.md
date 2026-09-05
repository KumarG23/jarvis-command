# Non-approval metadata display policy

This policy applies only to `tool.started.preview`, `subagent.start.goal` and
`subagent.complete.summary`, including the latter two events' upstream `preview`
fallbacks. It is a limited accidental-credential display filter, not a universal
secret boundary or a shell/JSON parser.

- Non-string inputs retain the existing empty-string projection.
- Inspect the complete string, not a truncated prefix. Inputs longer than 2,048
  UTF-16 code units (preview/goal) or 4,096 (summary) become `[Metadata omitted]`.
  This bounds inspection and prevents truncation from hiding ambiguous syntax.
- If a case-insensitive word-boundary cue (`Bearer`, `api_key`, `api-key`, `apikey`,
  `token`, `password`, or `secret`) appears anywhere together with a single/double
  quote, backslash, CR, LF, Unicode line separator or paragraph separator, omit
  the entire metadata field. This deliberately over-omits some harmless prose;
  it also handles quoted JSON keys, escaped quotes and multiline continuations
  without trying to identify where their secret spans end.
- Otherwise use the existing strict approval text parser: recognized Bearer or
  assignment prefixes replace nonempty whitespace-delimited simple values made
  of `A-Z a-z 0-9 . _ ~ + / = -` with `[REDACTED]`, including one-character values.
  An empty or non-simple recognized value (including attached shell operators)
  causes whole-field omission. Safe non-secret suffixes remain exact.
- If replacement expansion exceeds the same display limit, omit the whole field
  rather than clipping the replacement or its suffix.
- Omission preserves the event type, exact identifiers and following stream
  events. It is not a transport error, terminal run state or approval decision.
  Other protocol errors retain their existing typed stream recovery behavior.

Approval projection is intentionally unchanged: ambiguous approval credential
spans refuse the card, never replace an actionable command with this metadata
marker. Complete command visibility and pre/post-redaction command length checks
still apply on both status and SSE paths.

Safe bounded metadata without recognized credential spans is preserved, including
ordinary quoted or multiline prose without a credential cue. Unknown credential
names, encoded/obfuscated names or values, bare secrets, and unquoted multiword
values cannot be reliably classified by this policy. Whitespace separates simple
values; the filter is not an interpreter of shell expansion or serialized data.
It does not sanitize assistant/message output, history, `message.delta`,
`run.completed.output`, `pendingSteer`, identifiers, or subagent status labels.
Those surfaces are outside this repair and must not be represented as protected
by it. Do not send credentials to untrusted output surfaces.

Executable coverage lives in `src/app.test.ts` (real proxy SSE projection,
original quoted probes, aliases, ambiguous spans, bounds, safe text and following
typed events), with loopback signed Access -> BFF -> command client -> proxy ->
synthetic upstream checks in `../server/src/live-room-integration.test.ts`.

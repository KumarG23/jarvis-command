# Artifact Studio

Artifact Studio is the Jarvis Command artifact/file surface. It stores private, durable artifacts on the Command app host and links them optionally to a Hermes session and/or project room.

Capabilities:

- Typed artifacts: Markdown, text/report/log, code/diff, HTML, SVG, Mermaid, image, PDF and generic downloadable files.
- Immutable numbered versions with SHA-256, size, MIME, creator/source, timestamps, optional session/project/run IDs, parent/base-version provenance, revision notes and feedback.
- Library filtering by current chat, project, type and search.
- Create text artifacts, upload files/images/camera/pasted files, save the actual assistant response text as an artifact, edit text source into a new version, compare text versions, comment, promote/unpromote canonical state, download and guarded delete.
- **Create with Jarvis** for text artifacts: from a selected writable Command-owned chat, Artifact Studio sends a normal bounded Hermes run asking Jarvis to return only raw artifact content or one exact fenced block. When that exact public run completes successfully with non-empty, non-limited output, Command saves the assistant output as version 1 of the requested artifact type/title, links chat/project/run provenance, and opens the artifact in Studio. This is Command-side persistence of a normal response, not a Hermes core artifact tool.
- Safe previews: Markdown renders without raw HTML execution; text/code/diff/log render escaped; Mermaid uses client-side strict rendering inside a sandbox; HTML/SVG render in an opaque-origin `srcdoc` iframe with restrictive CSP and are never served inline from the Command origin; image/PDF previews use authenticated blob URLs with `nosniff`; generic files show metadata and download only.
- Export workflows for Obsidian and repositories are review prompts plus revocable Blob URL payloads. Artifact Studio does not silently write to the vault or a repository and labels those workflows as pending until normal Jarvis/tool approval completes elsewhere.

Exclusions in this scope:

- Browser Workbench is not implemented here.
- IDE/worktree editing surfaces are not implemented here.
- Hermes core is not modified. Arbitrary Hermes tool-created artifacts are not ingested automatically yet; only the explicit Command-side Create with Jarvis and Save response flows persist assistant output as Artifact Studio artifacts.

Production configuration:

- Set `ARTIFACTS_MODE=enabled`.
- Set `ARTIFACT_STORAGE_PATH` to an absolute prepared directory, for example `/var/lib/jarvis-command/artifacts`.
- Prepare it with `sudo python3 deploy/prepare-artifact-storage.py prepare --trusted-root /var/lib/jarvis-command --path /var/lib/jarvis-command/artifacts`, then run the same command with `verify`.
- Mount it writable through `app-command-storage.compose.yaml` into the otherwise read-only non-root app container. The base app compose file should not carry this writable storage bind.
- Production fails closed if artifacts are enabled without an absolute storage path.

Development/test default to an enabled temp-root store so the UI can be exercised locally without adding a database service.

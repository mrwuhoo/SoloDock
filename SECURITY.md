# Security and privacy

SoloDock is a local Electron application with optional network integrations. MIT licensing does not constitute a security guarantee.

Screen recording / Accessibility support the macOS current-window feature. Camera and microphone are used when the user initiates the relevant feature. Clipboard history is disabled by default. Credentials use Electron safeStorage when available. The notification endpoint listens on loopback; do not expose it to the internet.

Optional transcription and AI features send selected content to the configured provider. Link metadata fetching makes network requests.

Never commit recordings, workspaces, private screenshots, environment files, signing certificates, keychain databases or tokens. The gitignore is not a substitute for reviewing changes.

Report vulnerabilities through GitHub private vulnerability reporting when available. Do not put exploitable details or private data in public issues. If private reporting is unavailable, request a private contact channel without disclosing exploit details.

This snapshot has local tests and a pre-publication file review, not an independent penetration test. Windows hardware and platform permissions require separate release validation.

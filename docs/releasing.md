# SoloDock releases

Current source version: 0.1.0. No installers published.

1. Review README, CHANGELOG, licenses, attribution, dependencies and artwork provenance.
2. Run npm ci and npm test on macOS and Windows. Separately validate real devices, permissions, data persistence and upgraded installations.
3. Keep package.json and package-lock.json versions aligned.
4. Build and verify SoloDock-<version>-arm64.dmg and SoloDock-<version>-windows-x64-setup.exe, including SHA-256 checksums.
5. Preserve bundled LICENSE / NOTICE files, Electron/Chromium notices and redistributed dependency licenses. Never ship signing keys, keychains or passwords.
6. Publish after both platforms pass. The release workflow supports manual validation; a matching vX.Y.Z tag enables publication.

The optional local signing hook reads an existing certificate outside the repository and falls back to ad-hoc signing. It does not supply Developer ID or Apple notarization.

The website is static. Pages deployment is manual and separate from creating the source repository.

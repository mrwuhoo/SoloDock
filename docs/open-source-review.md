# Pre-publication review — 2026-09-16

## Conclusion and scope

The upstream LICENSE uses MIT, permitting modification and redistribution subject to retention of the copyright and permission notice. SoloDock retains that notice and license, records the upstream commit, and separately credits its changes.

This provides a documented basis for publishing the derivative source under the observed license. It is not a guarantee against future copyright, trademark or other claims, or a verification of every upstream contributor's title.

## Evidence

- https://github.com/xiaopu-ai/TO-DO-Panel/blob/5927fb84bb3e962e77731666126c6505e7251813/LICENSE
- https://opensource.org/license/mit
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- [Attribution](../NOTICE.md), [assets](../ASSET_LICENSES.md), [dependencies](../THIRD_PARTY_NOTICES.md)

## Changes before publishing

- Preserved MIT and original credit; identified SoloDock as an independent derivative.
- Excluded source images without standalone provenance and old screenshots/videos; substituted project-generated artwork and CSS gradients.
- Excluded runtime data, signing material, dependencies, builds and local archives from Git.
- Used a new sanitized history so excluded files cannot be recovered from published historical commits.
- Separately versioned SoloDock 0.1.0 from upstream v1.1.2.
- Replaced the old website with a small SoloDock page; Pages deployment is manual.

## Limitations

GitHub search found an unrelated `baixiaohang/solodock` repository (container deployment console). This is evidence of a name collision, not a trademark conclusion. No comprehensive trademark or visual-similarity clearance was performed. The name was retained as requested.

Generated artwork carries no claim of exclusive copyright or registered trademark. Binary distribution requires further platform checks and retention of runtime third-party notices.

## Local verification

Before the initial commit: 124 unit tests, the Electron renderer/retained-workspace/startup checks, and JavaScript syntax checks passed from the new project directory. A staged-tree scan found no credential patterns, private keys, personal workspace files or local signing material. Reported email/home-path hits were reviewed as dependency metadata and test fixtures; an upstream username in a fixture was generalized. All published image files are the SoloDock generated logo or its derivatives.

These checks do not prove the absence of vulnerabilities or all possible sensitive content. Windows hardware and binary distribution were not validated in this source publication.

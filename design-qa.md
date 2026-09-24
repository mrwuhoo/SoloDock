# SoloDock subscription widget design QA

Date: 2026-09-23

## Visual truth and evidence
- Design reference: `docs/design/usage-refresh/home-concept-v1.png` (1847 × 852 pixels). Compare the Codex card with the implemented homepage, accounting for the existing grid.
- Rendered implementation: docs/design/usage-widget/home.png and home-settings.png.
- Electron content viewport: 1240 × 584 CSS pixels, density 2; captured full image 2480 × 1168 pixels. Window including system frame is 1240 × 616.
- Focused native captures: home-medium.png 780 × 496 pixels (390 × 248 CSS), home-mini.png 378 × 236 (189 × 118 CSS), home-small.png 378 × 496 (189 × 248 CSS), home-large.png 780 × 1016 (390 × 508 CSS).
- State: connected Codex with explicitly mocked 68% weekly remaining and one reset credit; these screenshots are test fixtures, not account data. Real UI shows no invented usage.
- Source and revised implementation images were provided in the same visual comparison input. Compare medium-card proportions at logical size, accounting for the source board's presentation scaling and existing app grid. No pixel-exact claim is made.

## Findings and comparison history
1. Initial renderer capture showed browser-default gear border, a square progress-fill endpoint and an unknown secondary row that crowded the compact hierarchy (P2). Fixed by applying the shared icon-button style, explicit fill radius and hiding unknown secondary values on the widget. Full details remain in settings.
2. First revised focused comparison identified an oversized percent sign relative to the chosen design (P2). Added a 0.52em percent suffix while preserving accessible combined text and numeric content.
3. Final comparison of the selected source, full homepage and native medium/large captures confirms these issues are resolved. Mini/small captures also retain readable labels and controls inside card bounds. No actionable P0/P1/P2 differences remain.

## Required fidelity surfaces
- Typography: existing system-font stack preserves Chinese UI consistency; strong percentage is the primary visual, smaller percent sign and secondary period label match the chosen hierarchy. Labels fit the tested sizes. Font weight/antialiasing varies from generated artwork as expected.
- Spacing/layout: shared rounded tile, existing grid and drag/resize controls retained. Medium card is slightly shorter than the board target because it follows the existing homepage grid. Small and mini intentionally simplify information; large vertically centers the quota region.
- Colors/tokens: existing ice-blue glass surface, navy foreground, restrained blue meter and shared hairline footer. Low/critical states have semantic colors and numeric labels. Actual desktop glass varies with the content behind the window; screenshots validate CSS layout, not macOS background blending.
- Assets: shared existing settings SVG is reused. No illustration or product logo is needed in the quota tile. Existing unrelated homepage images are unchanged.
- Copy/content: Codex, remaining percentage, weekly reset and reset-card count follow the selected design. Missing data renders an em dash. Settings are integrated into the existing settings page. The card's 重置资讯 action now opens an independent in-app calendar backed by AIHOT's public data; the settings source link opens AIHOT.

## Interaction verification
- Full npm test passed after the reset-news correction: 139 Node tests, five Electron suites and JavaScript syntax checks.
- After visual refinements, Codex Electron suite passed again: old seven-card layout migration, four sizes, actual mouse long-press reorder, size persistence after reorder, settings gear, visibility toggle, polling lifecycle, manual mode, failure/expiry states and safe text rendering.
- All 255 nonempty visibility subsets of eight modules covered by layout tests. Existing 1240 × 616 and 1000 × 576 layout checks pass.
- No renderer console errors in quota integration test.
- Existing behavior preserved: when modules are hidden, the homepage automatically fills available space and disables individual size controls consistently for all cards.
- Native Windows execution was not performed in this macOS session.

## Reset-news correction
- The 订阅用量 switch sits in 首页组件; 重置资讯 is a separate 显示功能 switch and tab.
- Both settings columns use the same scroll container. The Electron QA test can regenerate local captures with `SOLODOCK_RESET_SCREENSHOT`; they are excluded from Git.
- The homepage action activates the in-app calendar; selecting a date updates details and X source links. The API was read live and returned 42 dated records. Tests use separate fixtures, not live account data.

## Implementation checklist
- [x] Selected design implemented as a homepage card.
- [x] Shared drag, size, visibility and persistence behavior.
- [x] Configuration in settings with connection and interval controls.
- [x] Final image comparison and integration test.
- [x] Local source preview restarted; home and usage widget visible.

final result: passed

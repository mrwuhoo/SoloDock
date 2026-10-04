# Asset provenance

| Files | Source |
| --- | --- |
| `docs/brand/solodock-logo.png`, root `solodock-logo.png` | Generated in this project's Codex session with built-in image_gen on 2026-09-16 |
| `build/solodock-icon.*`, `build/solodock.iconset/*` | Size/format derivatives of that logo |
| `renderer/assets/solodock-*.png`, `website/assets/solodock-icon.png` | Copies/size derivatives of that logo |
| `renderer/assets/break-cat/arrive.webm`, `renderer/assets/break-cat/sleep.webm` | AI-generated video: made by the maintainer with Jimeng (即梦) / Seedance on 2026-10-04 (Dreamina export, 1280×720, ~15 s), then matted to a transparent background in this project with `scripts/break-cat/make-break-cat.py` (background-plate difference matte plus an isnet-general-use segmentation via rembg) and cut into the walk-in clip and a ping-pong sleeping loop. The generator's visible "AI" corner mark was outside the matte and is not in the files. Check the generator's terms (commercial use, attribution or labelling of AI content) before a public release |
| Background gradients and inline UI symbols | CSS/SVG source; upstream portions covered by the retained MIT notice, SoloDock changes also MIT |

Included generated artwork is distributed under the repository's MIT terms to the extent rights are held. No exclusive copyright or trademark claim is made. The exact prompt is in `docs/brand/imagegen-prompt.txt`; no third-party reference image was supplied. AI generation does not establish trademark clearance.

## Excluded material

The upstream portrait, old app icons, background bitmaps without independently recorded provenance, website photographs, character illustrations, videos, product screenshots and personal QA screenshots are not distributed in this snapshot. Maintainer copies may remain in ignored `.local-archive/`, which is not part of Git history.

Future screenshots must be reviewed for both content rights and personal information. User-selected mirror images are local user content and are not redistributed by this project.

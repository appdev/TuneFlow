# Flutter UI fidelity self-test

Reference: `lx-music-server-web/.codex/ui-design/musicfree-v1-handoff/baselines`

| Viewport | Flutter surface | HTML reference | SSIM |
| --- | --- | --- | ---: |
| 1440 × 960 | Home, full desktop shell | Desktop home | 0.614 |
| 1024 × 768 | Search, compact desktop shell | Desktop search | 0.651 |
| 390 × 844 | Player, lyrics state and mobile shell | Mobile player | 0.730 |
| 360 × 800 | Downloads and mobile shell | Mobile downloads | 0.602 |

SSIM uses identical viewport sizes and device-pixel-ratio 1. A value of 1 is pixel-identical. The result is a structural regression signal, not an acceptance shortcut: fixture data and production widgets intentionally differ from the static example content.

Manual review checklist:

- Desktop title bar is 52 px, wide sidebar is 224 px, compact sidebar is 84 px, and persistent player is 92 px.
- Desktop navigation exposes all seven approved entries; mobile navigation exposes five.
- Dark visual tokens, typography hierarchy, gallery artwork, queue, player and status treatments follow the HTML contract.
- Chinese and Lucide fonts are explicitly loaded by golden tests; tofu glyph screenshots are invalid.
- Source list and active source are Service-owned. A failed switch retains the previous active source.

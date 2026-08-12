# Full UI fidelity audit

Reference: approved Open Design screenshots. Each comparison image contains reference, Flutter capture, and amplified pixel diff.

| Page / viewport | Luma SSIM | RGB MAE | Edge IoU | Result |
| --- | ---: | ---: | ---: | --- |
| [desktop-search-1024x768.png](../../build/visual-audit/desktop-search-1024x768.png) | 0.1869 | 0.0438 | 0.0557 | FAIL |
| [desktop-search-1440x960.png](../../build/visual-audit/desktop-search-1440x960.png) | 0.3250 | 0.0293 | 0.1138 | FAIL |
| [mobile-search-360x800.png](../../build/visual-audit/mobile-search-360x800.png) | 0.5293 | 0.0374 | 0.2970 | FAIL |
| [mobile-search-390x844.png](../../build/visual-audit/mobile-search-390x844.png) | 0.5526 | 0.0327 | 0.3430 | FAIL |

Compared: 4; passed: 0; failed: 4.
Mean SSIM: 0.3984; mean RGB MAE: 0.0358; mean edge IoU: 0.2024.

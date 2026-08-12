# Full UI fidelity audit

Reference: approved Open Design screenshots. Each comparison image contains reference, Flutter capture, and amplified pixel diff.

| Page / viewport | Luma SSIM | RGB MAE | Edge IoU | Result |
| --- | ---: | ---: | ---: | --- |
| [desktop-charts-1024x768.png](../../build/visual-audit/desktop-charts-1024x768.png) | 0.3430 | 0.0454 | 0.1165 | FAIL |
| [desktop-charts-1440x960.png](../../build/visual-audit/desktop-charts-1440x960.png) | 0.3453 | 0.0343 | 0.1093 | FAIL |
| [desktop-downloads-1024x768.png](../../build/visual-audit/desktop-downloads-1024x768.png) | 0.3866 | 0.0411 | 0.1142 | FAIL |
| [desktop-downloads-1440x960.png](../../build/visual-audit/desktop-downloads-1440x960.png) | 0.4225 | 0.0309 | 0.1126 | FAIL |
| [desktop-home-1024x768.png](../../build/visual-audit/desktop-home-1024x768.png) | 0.6757 | 0.0604 | 0.1407 | FAIL |
| [desktop-home-1440x960.png](../../build/visual-audit/desktop-home-1440x960.png) | 0.7205 | 0.0526 | 0.1798 | FAIL |
| [desktop-my-playlists-1024x768.png](../../build/visual-audit/desktop-my-playlists-1024x768.png) | 0.7850 | 0.0482 | 0.1457 | FAIL |
| [desktop-my-playlists-1440x960.png](../../build/visual-audit/desktop-my-playlists-1440x960.png) | 0.8193 | 0.0330 | 0.1826 | FAIL |
| [desktop-player-1024x768.png](../../build/visual-audit/desktop-player-1024x768.png) | 0.4284 | 0.0670 | 0.1622 | FAIL |
| [desktop-player-1440x960.png](../../build/visual-audit/desktop-player-1440x960.png) | 0.6655 | 0.0316 | 0.1618 | FAIL |
| [desktop-playlist-detail-1024x768.png](../../build/visual-audit/desktop-playlist-detail-1024x768.png) | 0.5982 | 0.0552 | 0.1070 | FAIL |
| [desktop-playlist-detail-1440x960.png](../../build/visual-audit/desktop-playlist-detail-1440x960.png) | 0.6285 | 0.0431 | 0.1079 | FAIL |
| [desktop-playlist-square-1024x768.png](../../build/visual-audit/desktop-playlist-square-1024x768.png) | 0.7941 | 0.0467 | 0.1658 | FAIL |
| [desktop-playlist-square-1440x960.png](../../build/visual-audit/desktop-playlist-square-1440x960.png) | 0.7866 | 0.0292 | 0.2525 | FAIL |
| [desktop-search-1024x768.png](../../build/visual-audit/desktop-search-1024x768.png) | 0.2521 | 0.0576 | 0.0809 | FAIL |
| [desktop-search-1440x960.png](../../build/visual-audit/desktop-search-1440x960.png) | 0.2812 | 0.0430 | 0.0921 | FAIL |
| [desktop-settings-1024x768.png](../../build/visual-audit/desktop-settings-1024x768.png) | 0.2953 | 0.0521 | 0.1026 | FAIL |
| [desktop-settings-1440x960.png](../../build/visual-audit/desktop-settings-1440x960.png) | 0.1890 | 0.0462 | 0.0870 | FAIL |
| [desktop-sources-1024x768.png](../../build/visual-audit/desktop-sources-1024x768.png) | 0.2811 | 0.0452 | 0.1103 | FAIL |
| [desktop-sources-1440x960.png](../../build/visual-audit/desktop-sources-1440x960.png) | 0.3466 | 0.0315 | 0.1243 | FAIL |
| [desktop-states-1024x768.png](../../build/visual-audit/desktop-states-1024x768.png) | 0.2728 | 0.0456 | 0.1155 | FAIL |
| [desktop-states-1440x960.png](../../build/visual-audit/desktop-states-1440x960.png) | 0.2601 | 0.0365 | 0.1378 | FAIL |
| [mobile-charts-360x800.png](../../build/visual-audit/mobile-charts-360x800.png) | 0.2435 | 0.0690 | 0.1059 | FAIL |
| [mobile-charts-390x844.png](../../build/visual-audit/mobile-charts-390x844.png) | 0.2435 | 0.0635 | 0.1006 | FAIL |
| [mobile-downloads-360x800.png](../../build/visual-audit/mobile-downloads-360x800.png) | 0.2602 | 0.0551 | 0.1164 | FAIL |
| [mobile-downloads-390x844.png](../../build/visual-audit/mobile-downloads-390x844.png) | 0.2682 | 0.0486 | 0.1128 | FAIL |
| [mobile-home-360x800.png](../../build/visual-audit/mobile-home-360x800.png) | 0.5855 | 0.1102 | 0.0933 | FAIL |
| [mobile-home-390x844.png](../../build/visual-audit/mobile-home-390x844.png) | 0.6097 | 0.1077 | 0.0891 | FAIL |
| [mobile-library-360x800.png](../../build/visual-audit/mobile-library-360x800.png) | 0.5887 | 0.0893 | 0.1450 | FAIL |
| [mobile-library-390x844.png](../../build/visual-audit/mobile-library-390x844.png) | 0.6096 | 0.0869 | 0.1401 | FAIL |
| [mobile-more-360x800.png](../../build/visual-audit/mobile-more-360x800.png) | 0.4399 | 0.0248 | 0.1664 | FAIL |
| [mobile-more-390x844.png](../../build/visual-audit/mobile-more-390x844.png) | 0.4349 | 0.0223 | 0.1548 | FAIL |
| [mobile-player-360x800.png](../../build/visual-audit/mobile-player-360x800.png) | 0.3894 | 0.0487 | 0.1208 | FAIL |
| [mobile-player-390x844.png](../../build/visual-audit/mobile-player-390x844.png) | 0.4877 | 0.0370 | 0.1873 | FAIL |
| [mobile-playlist-detail-360x800.png](../../build/visual-audit/mobile-playlist-detail-360x800.png) | 0.6531 | 0.0641 | 0.1357 | FAIL |
| [mobile-playlist-detail-390x844.png](../../build/visual-audit/mobile-playlist-detail-390x844.png) | 0.6684 | 0.0616 | 0.1399 | FAIL |
| [mobile-playlist-square-360x800.png](../../build/visual-audit/mobile-playlist-square-360x800.png) | 0.5554 | 0.0988 | 0.1353 | FAIL |
| [mobile-playlist-square-390x844.png](../../build/visual-audit/mobile-playlist-square-390x844.png) | 0.5880 | 0.0927 | 0.1346 | FAIL |
| [mobile-search-360x800.png](../../build/visual-audit/mobile-search-360x800.png) | 0.2355 | 0.0809 | 0.1224 | FAIL |
| [mobile-search-390x844.png](../../build/visual-audit/mobile-search-390x844.png) | 0.2521 | 0.0710 | 0.1218 | FAIL |
| [mobile-settings-360x800.png](../../build/visual-audit/mobile-settings-360x800.png) | 0.6478 | 0.0474 | 0.1727 | FAIL |
| [mobile-settings-390x844.png](../../build/visual-audit/mobile-settings-390x844.png) | 0.6673 | 0.0426 | 0.1681 | FAIL |
| [mobile-sources-360x800.png](../../build/visual-audit/mobile-sources-360x800.png) | 0.4374 | 0.0363 | 0.1322 | FAIL |
| [mobile-sources-390x844.png](../../build/visual-audit/mobile-sources-390x844.png) | 0.4424 | 0.0321 | 0.1275 | FAIL |

Compared: 44; passed: 0; failed: 44.
Mean SSIM: 0.4747; mean RGB MAE: 0.0538; mean edge IoU: 0.1325.

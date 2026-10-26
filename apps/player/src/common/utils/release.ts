export const isDesktopRelease = (release: { assets?: Array<{ name?: string }> }) => {
  return release.assets?.some(asset => /(?:^Q-music-Docker-[\d.]+-(?:mac|win|linux)-(?:x64|arm64)\.(?:zip|tar\.gz)$|^latest(?:-mac|-linux)?\.yml$|\.(?:exe|dmg|appimage|deb|rpm|pacman)$)/i.test(asset.name ?? '')) ?? false
}

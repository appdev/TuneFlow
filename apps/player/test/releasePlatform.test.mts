import assert from 'node:assert/strict'
import test from 'node:test'
import { isDesktopRelease } from '../src/common/utils/release.ts'

test('桌面更新忽略只有 Android APK 的正式 Release', () => {
  assert.equal(isDesktopRelease({ assets: [{ name: 'Q-music-android-v0.4.4-arm64-v8a.apk' }] }), false)
  assert.equal(isDesktopRelease({ assets: [{ name: 'Q-music-v0.3.23-x64-Setup.exe' }] }), true)
  assert.equal(isDesktopRelease({ assets: [{ name: 'Q-music_0.3.23_x64.pacman' }] }), true)
  assert.equal(isDesktopRelease({ assets: [{ name: 'latest.yml' }] }), true)
  assert.equal(isDesktopRelease({ assets: [{ name: 'Q-music-Docker-0.4.25-mac-arm64.zip' }] }), true)
  assert.equal(isDesktopRelease({ assets: [{ name: 'Q-music-Docker-0.4.25-linux-x64.tar.gz' }] }), true)
  assert.equal(isDesktopRelease({ assets: [{ name: 'Q-music-Web-0.4.25.tar.gz' }] }), false)
})

// Run against the disposable web-service-fixture.cjs, never a user profile.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const serviceRoot = process.env.Q_SERVICE_ROOT || path.resolve(root, '../service')
const { chromium } = require(path.join(serviceRoot, 'node_modules/playwright'))
const proof = process.env.Q_WEB_PROOF || path.join(root, 'artifacts/web-client/verification')
const fixture = JSON.parse(fs.readFileSync(path.join(proof, 'fixture.json')))
assert.ok(fixture.testOnly && /^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.endpoint), 'Disposable loopback fixture required')

;(async() => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const layout of ['immersive', 'classic']) {
      const page = await browser.newPage({ viewport: { width: 1688, height: 888 } })
      await page.addInitScript(({ layout }) => {
        localStorage.setItem('qmusic.web.v1.settings', JSON.stringify({
          'common.isAgreePact': true,
          'common.langId': 'zh-cn',
          'playDetail.style.layout': layout,
        }))
      }, { layout })
      await page.goto(fixture.endpoint)
      await page.locator('.q-player-footer').waitFor()
      const canvas = () => page.locator('#root').boundingBox()
      assert.ok((await canvas()).width < 1688, 'Browsing canvas starts centered')
      await page.locator('.q-player-footer button').first().click()
      const detail = page.locator('.q-player-detail')
      await detail.waitFor()
      await page.waitForFunction(() => !document.querySelector('.q-detail-enter-active'))
      for (const width of [2560, 1688, 1440, 1024, 768]) {
        await page.setViewportSize({ width, height: 888 })
        await page.mouse.move(width / 2, 860)
        const backdrop = await detail.boundingBox()
        assert.ok(Math.abs(backdrop.x) <= 1 && Math.abs(backdrop.width - width) <= 1, `${layout}/${width}: backdrop fills viewport`)
        const controls = await page.locator('.q-player-footer > div').evaluateAll(elements => elements
          .filter(element => getComputedStyle(element).display !== 'none')
          .map(element => element.getBoundingClientRect().toJSON()))
        for (const rect of controls) {
          assert.ok(rect.x >= -1 && rect.right <= width + 1 && rect.y >= 0 && rect.bottom <= 889, `${layout}/${width}: controls stay inside viewport`)
        }
        for (let index = 1; index < controls.length; index++) {
          assert.ok(controls[index - 1].right <= controls[index].x + 1, `${layout}/${width}: control groups do not overlap`)
        }
        const times = await page.locator('.q-player-footer span').filter({ hasText: /^\d+:\d+$/ }).all()
        assert.equal(times.length, 2, 'Both progress timestamps are rendered')
        for (const time of times) {
          const rect = await time.boundingBox()
          assert.ok(rect.x >= 0 && rect.x + rect.width <= width, `${layout}/${width}: progress timestamp is not clipped`)
        }
        console.log(`PASS ${layout} player layout at ${width}px`)
      }
      await page.setViewportSize({ width: 1688, height: 888 })
      await detail.screenshot({ path: path.join(proof, `player-layout-${layout}.png`) })
      // The first direct button is the detail back button in both layouts.
      await detail.locator(':scope > button').first().click()
      await detail.waitFor({ state: 'detached' })
      const restored = await canvas()
      assert.ok(restored.width < 1688 && Math.abs(restored.x * 2 + restored.width - 1688) <= 1, 'Closing restores centered browsing canvas')
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

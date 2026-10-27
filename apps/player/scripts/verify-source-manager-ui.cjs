// Synthetic source metadata only: no real script is fetched, executed or changed.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium } = require('../../service/node_modules/playwright')
const output = process.env.Q_SOURCE_OUT || path.resolve(__dirname, '../../../..', '.codex/artifacts/source-manager')
const sources = [
  { id: 'b', name: '备用音源', version: '2.1.0', enabled: true, priority: 1 },
  { id: 'off', name: '暂存音源', version: '1.0.0', enabled: false, priority: null },
  { id: 'a', name: '常用音源', version: '3.0.0', enabled: true, priority: 0 },
  { id: 'c', name: '另一音源', version: '1.4.2', enabled: true, priority: 2 },
]
const writes = [], errors = [], layouts = [], requests = []
let rejectNext = false
;(async() => {
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  let page
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('TypeError')) errors.push(message.text()) })
    await page.route('**/api/v1/**', async route => {
      const name = new URL(route.request().url()).pathname.replace('/api/v1/', '')
      const method = route.request().method()
      requests.push(name)
      let data = []
      if (name === 'health') data = { status: 'ok' }
      else if (name === 'accounts/status') data = { tx: false, wy: false, kg: false, accounts: Object.fromEntries(['tx', 'wy', 'kg'].map(id => [id, { hasSession: false, state: 'disconnected', displayName: '', avatar: '', accountHint: '' }])) }
      else if (name === 'access/status') data = { configured: false, authenticated: false }
      else if (name === 'events/snapshot') data = { sequence: 1, events: [] }
      else if (name === 'settings') data = {}
      else if (name === 'catalog/capabilities') data = { sources: [] }
      else if (name === 'sources/enabled') {
        const ids = route.request().postDataJSON().sourceIds
        if (rejectNext) { rejectNext = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_REJECTED', message: '模拟保存失败' } }) }) }
        assert.equal(new Set(ids).size, ids.length)
        assert.ok(ids.every(id => sources.some(source => source.id === id)))
        sources.forEach(source => { source.enabled = ids.includes(source.id); source.priority = source.enabled ? ids.indexOf(source.id) : null })
        writes.push(ids); data = sources
      } else if (name === 'sources/import' || (name === 'sources' && method === 'POST')) {
        const id = name.endsWith('/import') ? 'url' : 'file'
        const value = { id, name: id === 'url' ? '地址音源' : '文件音源', version: '1.0.0', enabled: false, priority: null }
        sources.push(value); data = value
      } else if (name.startsWith('sources/') && method === 'DELETE') { sources.splice(sources.findIndex(source => source.id === name.split('/')[1]), 1) }
      else if (name === 'sources') data = sources
      else if (name.startsWith('playlists/')) data = { tracks: [] }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) })
    })
    await page.addInitScript(() => { localStorage.setItem('qmusic.web.v1.settings', JSON.stringify({ 'common.isAgreePact': true, 'common.langId': 'zh-cn' })) })
    await page.goto(process.env.Q_SOURCE_URL || 'http://127.0.0.1:58974')
    const openSources = async() => { await page.locator('[role="toolbar"]').getByRole('tab').nth(5).click(); await page.locator('#SettingSource-tab').click() }
    await openSources()
    const waitOrder = async ids => page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('[data-source-id]')].map(row => row.dataset.sourceId).slice(0, expected.length)) === JSON.stringify(expected), ids)
    await waitOrder(['a', 'b', 'c', 'off'])
    assert.equal(await page.getByRole('button', { name: '上移：常用音源', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '下移：另一音源', exact: true }).isDisabled(), true)
    const measure = async label => {
      const rows = await page.locator('[data-source-id]').evaluateAll(rows => rows.map(row => {
        const rect = row.getBoundingClientRect()
        return { overflow: row.scrollWidth > row.clientWidth + 1, outside: [...row.querySelectorAll('button')].some(button => { const b = button.getBoundingClientRect(); return b.left < rect.left - 1 || b.right > rect.right + 1 }) }
      }))
      assert.ok(rows.every(row => !row.overflow && !row.outside), JSON.stringify(rows))
      layouts.push(label); await page.screenshot({ path: path.join(output, label + '.png') })
    }
    await measure('light-wide')
    await page.getByRole('button', { name: '上移：另一音源', exact: true }).click(); await waitOrder(['a', 'c', 'b'])
    await page.getByRole('button', { name: '下移：常用音源', exact: true }).click(); await waitOrder(['c', 'a', 'b'])
    await page.getByRole('button', { name: '置顶：备用音源', exact: true }).click(); await waitOrder(['b', 'c', 'a'])
    await page.getByRole('button', { name: '调整顺序：备用音源', exact: true }).focus()
    await page.keyboard.press('ArrowDown'); await waitOrder(['c', 'b', 'a'])
    await page.getByRole('button', { name: '调整顺序：常用音源', exact: true }).dragTo(page.locator('[data-source-id="c"]'))
    await waitOrder(['a', 'c', 'b'])
    rejectNext = true
    await page.getByRole('button', { name: '上移：另一音源', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'TEST_REJECTED' }).waitFor(); await waitOrder(['a', 'c', 'b'])
    await page.getByRole('button', { name: '刷新', exact: true }).click(); await waitOrder(['a', 'c', 'b'])
    await page.getByRole('button', { name: '停用：另一音源', exact: true }).click(); await waitOrder(['a', 'b'])
    await page.getByRole('button', { name: '启用：另一音源', exact: true }).click(); await waitOrder(['a', 'b', 'c'])
    await page.getByRole('textbox', { name: '脚本地址', exact: true }).fill('https://fixture.invalid/source.js')
    await page.getByRole('button', { name: '从地址导入', exact: true }).click()
    await page.locator('[data-source-id="url"]').waitFor()
    await page.getByLabel('选择音源脚本文件', { exact: true }).setInputFiles({ name: 'fixture.js', mimeType: 'text/javascript', buffer: Buffer.from('// fixture only') })
    await page.locator('[data-source-id="file"]').waitFor()
    await page.getByLabel('选择音源脚本文件', { exact: true }).setInputFiles({ name: 'too-large.js', mimeType: 'text/javascript', buffer: Buffer.alloc(1024 * 1024 + 1) })
    await page.getByRole('alert').filter({ hasText: '1 MiB' }).waitFor()
    assert.equal(sources.length, 6)
    await page.getByRole('button', { name: '移除：文件音源', exact: true }).click()
    await page.getByRole('dialog').getByRole('button').first().click({ timeout: 5000 })
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.ok(sources.some(source => source.id === 'file'), 'Cancelling removal preserves the installed source')
    await page.getByRole('button', { name: '移除：文件音源', exact: true }).click()
    await page.getByRole('dialog').getByRole('button').last().click({ timeout: 5000 })
    await page.locator('[data-source-id="file"]').waitFor({ state: 'detached' })
    await page.reload(); await openSources(); await waitOrder(['a', 'b', 'c'])
    await page.goto((process.env.Q_SOURCE_URL || 'http://127.0.0.1:58974') + '/#/setting?name=SettingBasic')
    await page.getByLabel('主题', { exact: true }).selectOption('black')
    await page.goto((process.env.Q_SOURCE_URL || 'http://127.0.0.1:58974') + '/#/setting?name=SettingSource')
    await waitOrder(['a', 'b', 'c']); await measure('dark-wide')
    await page.setViewportSize({ width: 1000, height: 900 }); await measure('dark-narrow')
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, synthetic: true, layouts, ordering: writes, failurePreservesOrder: true, drag: true, keyboard: true, imports: true, oversizedBlocked: true, remove: true, reloadOrder: true, errors }, null, 2))
    console.log('Source manager UI checks passed:', layouts.join(', '))
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') })
      const dialogs = await page.locator('[role="dialog"]').evaluateAll(elements => elements.map(element => ({ html: element.outerHTML.slice(0, 1500), rect: element.getBoundingClientRect().toJSON(), styles: [element, ...[element.parentElement, element.parentElement?.parentElement].filter(Boolean)].map(node => ({ display: getComputedStyle(node).display, opacity: getComputedStyle(node).opacity, visibility: getComputedStyle(node).visibility, class: node.className })) })))
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ requests, errors, dialogs, text: await page.locator('body').innerText() }, null, 2))
    }
    throw error
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })

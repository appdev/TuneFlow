import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { browsePlaylists, catalogCapabilities, getPlaylistDetail, getPlaylistTags } from '../../src/server/tuneFlowSdk'

const runRealProviders = process.env.TUNEFLOW_REAL_PLAYLISTS === '1'
const originalWindow = (globalThis as { window?: unknown }).window

describe.skipIf(!runRealProviders)('real playlist discovery providers', () => {
  beforeAll(() => {
    // Production replaces renderer utilities with the Node shim during bundling.
    // Vitest imports the legacy module directly, so provide only its DOM boundary.
    ;(globalThis as { window?: unknown }).window = {
      DOMParser: class { parseFromString(value: string) { return { body: { textContent: value } } } },
    }
  })

  afterAll(() => { ;(globalThis as { window?: unknown }).window = originalWindow })

  it.each(['kw', 'kg', 'tx', 'wy', 'mg'])('returns %s tags, browse results, and playable detail tracks', async(source) => {
    const capability = catalogCapabilities().find(provider => provider.id === source)?.playlistDiscovery
    expect(capability).toEqual({ tags: true, browse: true, detail: true })
    const filters = await getPlaylistTags(source)
    expect(filters.sorts.length, `${source} sorts`).toBeGreaterThan(0)
    const page = await browsePlaylists({
      source,
      sortId: filters.sorts[0].id,
      tagId: '',
      page: 1,
    })
    expect(page.list.length, `${source} browse list`).toBeGreaterThan(0)
    const detail = await getPlaylistDetail({ source, playlistId: page.list[0].id, page: 1 })
    expect(detail.playlist.id).toBe(page.list[0].id)
    expect(detail.tracks.length, `${source} detail tracks`).toBeGreaterThan(0)
  }, 300_000)
})

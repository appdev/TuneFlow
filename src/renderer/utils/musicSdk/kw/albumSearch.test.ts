import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import albumSearch from './albumSearch'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))

vi.mock('../../request', () => ({ httpFetch }))

const originalWindow = (globalThis as { window?: unknown }).window

describe('Kuwo album search', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      DOMParser: class {
        parseFromString(value: string) {
          return { body: { textContent: value.replaceAll('&nbsp;', ' ') } }
        }
      },
    }
  })

  afterEach(() => {
    httpFetch.mockReset()
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it('uses the legacy album collection protocol and normalizes results', async() => {
    httpFetch.mockReturnValue({
      promise: Promise.resolve({
        body: "{'SHOW':'1','TOTAL':'2','albumlist':[{'albumid':'87758985','name':'太阳之子','artist':'周杰伦','aartist':'Jay&nbsp;Chou','musiccnt':'13','hts_img':'https://example.test/album.jpg','info':'Fixture&nbsp;description'}]}",
      }),
    })

    await expect(albumSearch.search('周杰伦', 2, 20)).resolves.toEqual({
      list: [{
        id: '87758985',
        name: '太阳之子',
        author: 'Jay Chou',
        total: 13,
        img: 'https://example.test/album.jpg',
        desc: 'Fixture description',
        source: 'kw',
      }],
      total: 2,
      limit: 20,
      source: 'kw',
    })

    const url = httpFetch.mock.calls[0][0] as string
    expect(url).toContain('ft=album')
    expect(url).toContain('itemset=web_2013')
    expect(url).toContain('pn=1')
    expect(url).toContain('rn=20')
  })

  it('rejects malformed legacy responses', async() => {
    httpFetch.mockReturnValue({ promise: Promise.resolve({ body: "{'TOTAL':'1'}" }) })

    await expect(albumSearch.search('周杰伦', 1, 20)).rejects.toThrow('Album search failed')
  })

  it('uses the lowercase total returned by the live legacy endpoint', async() => {
    httpFetch.mockReturnValue({
      promise: Promise.resolve({
        body: "{'SHOW':'2','total':'103','albumlist':[{'albumid':'1','name':'Album'}]}",
      }),
    })

    await expect(albumSearch.search('周杰伦', 1, 2)).resolves.toMatchObject({ total: 103 })
  })
})

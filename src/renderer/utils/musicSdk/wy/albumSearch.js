import { eapiRequest } from './utils/index'

export default {
  limit: 20,
  search(text, page = 1, limit = this.limit) {
    return eapiRequest('/api/cloudsearch/pc', {
      s: text,
      type: 10,
      limit,
      total: page == 1,
      offset: limit * (page - 1),
    }).promise.then(({ body }) => {
      if (body?.code !== 200) throw new Error('Album search failed')
      const albums = Array.isArray(body.result?.albums) ? body.result.albums : []
      return {
        list: albums.map(album => ({
          id: String(album.id),
          name: String(album.name ?? ''),
          author: Array.isArray(album.artists) ? album.artists.map(artist => artist.name).filter(Boolean).join('、') : '',
          total: Number(album.size ?? 0),
          img: typeof album.picUrl === 'string' ? album.picUrl : null,
          source: 'wy',
        })),
        limit,
        total: Number(body.result?.albumCount ?? albums.length),
        source: 'wy',
      }
    })
  },
}

import { httpFetch } from '../../request'

export default {
  limit: 30,
  search(text, page = 1, limit = this.limit) {
    const url = `http://mobilecdn.kugou.com/api/v3/search/album?format=json&keyword=${encodeURIComponent(text)}&page=${page}&pagesize=${limit}`
    return httpFetch(url).promise.then(({ body }) => {
      if (body?.status !== 1 || body.errcode !== 0 || !Array.isArray(body.data?.info)) {
        throw new Error('Album search failed')
      }
      return {
        list: body.data.info.map(album => ({
          id: String(album.albumid),
          name: String(album.albumname ?? ''),
          author: String(album.singername ?? ''),
          total: Number(album.songcount ?? 0),
          img: typeof album.imgurl === 'string' ? album.imgurl.replace('{size}', '400') : null,
          desc: String(album.intro ?? ''),
          source: 'kg',
        })),
        total: Number(body.data.total ?? body.data.info.length),
        limit,
        source: 'kg',
      }
    })
  },
}

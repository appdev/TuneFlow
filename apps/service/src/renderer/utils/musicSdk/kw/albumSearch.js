import { httpFetch } from '../../request'
import { decodeName } from '../../index'
import { formatSinger, objStr2JSON } from './util'

export default {
  limit: 20,
  search(text, page = 1, limit = this.limit) {
    const url = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(text)}&ft=album&itemset=web_2013&client=kt&pcmp4=1&geo=c&vipver=1&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8`
    return httpFetch(url).promise.then(({ body }) => {
      const result = typeof body === 'string' ? objStr2JSON(body) : body
      if (!Array.isArray(result?.albumlist)) throw new Error('Album search failed')
      return {
        list: result.albumlist.map(album => ({
          id: String(album.albumid || album.id),
          name: decodeName(album.name),
          author: formatSinger(decodeName(album.aartist || album.artist)),
          total: Number(album.musiccnt || 0),
          img: album.hts_img || album.img || null,
          desc: decodeName(album.info),
          source: 'kw',
        })),
        total: Number(result.total ?? result.TOTAL ?? result.SHOW ?? result.albumlist.length),
        limit,
        source: 'kw',
      }
    })
  },
}

import { httpFetch } from '../../request'
import { createSignature } from './musicSearch'

export default {
  limit: 20,
  search(text, page = 1, limit = this.limit) {
    const time = Date.now().toString()
    const signature = createSignature(time, text)
    const searchSwitch = encodeURIComponent(JSON.stringify({
      song: 0,
      album: 1,
      singer: 0,
      tagSong: 0,
      mvSong: 0,
      bestShow: 0,
      songlist: 0,
      lyricSong: 0,
    }))
    const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(text)}&pageNo=${page}&sort=0&sid=USS`
    return httpFetch(url, {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId: signature.deviceId,
        timestamp: time,
        sign: signature.sign,
        channel: '0146921',
        'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      },
    }).promise.then(({ body }) => {
      const albums = body?.albumResultData?.result
      if (body?.code !== '000000' || !Array.isArray(albums)) throw new Error('Album search failed')
      return {
        list: albums.map(album => ({
          id: String(album.id),
          name: String(album.name ?? ''),
          author: String(album.singer ?? ''),
          img: typeof album.imgItems?.[0]?.img === 'string' ? album.imgItems[0].img : null,
          desc: String(album.desc ?? ''),
          source: 'mg',
        })),
        total: Number(body.albumResultData.totalCount ?? albums.length),
        limit,
        source: 'mg',
      }
    })
  },
}

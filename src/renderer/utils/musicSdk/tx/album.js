import { httpFetch } from '../../request'
import { filterMusicInfoItem } from './singer'

export default {
  limit: 100,
  getAlbumDetail(albumMid, page = 1) {
    return httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'post',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      body: {
        comm: { ct: 24, cv: 10000 },
        albumSonglist: {
          module: 'music.musichallAlbum.AlbumSongList',
          method: 'GetAlbumSongList',
          param: { albumMid, albumID: 0, begin: (page - 1) * this.limit, num: this.limit, order: 2 },
        },
      },
    }).promise.then(({ body }) => {
      const result = body?.albumSonglist
      const items = result?.data?.songList
      if (body?.code !== 0 || result?.code !== 0 || !Array.isArray(items)) throw new Error('Album detail failed')
      const list = items.map(item => item?.songInfo).filter(Boolean).map(filterMusicInfoItem)
      const first = list[0]
      return {
        list,
        page,
        limit: this.limit,
        total: Number(result.data.totalNum ?? list.length),
        source: 'tx',
        info: {
          name: first?.albumName ?? albumMid,
          img: `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`,
          desc: null,
          author: first?.singer ?? '',
        },
      }
    })
  },
}

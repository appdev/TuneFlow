import { eapiRequest } from './utils/index'
import singer from './singer'
import { formatSingerName } from '../utils'

export default {
  limit: 100,
  getAlbumDetail(albumId, page = 1) {
    return eapiRequest(`/api/v1/album/${albumId}`, {}).promise.then(({ body }) => {
      if (body?.code !== 200 || !body.album || !Array.isArray(body.songs)) throw new Error('Album detail failed')
      const allTracks = singer.filterSongList(body.songs.map(song => {
        const rawDuration = Number(song.duration ?? song.dt ?? 0)
        return {
          ...song,
          artists: song.artists ?? song.ar ?? [],
          album: song.album ?? song.al ?? {},
          duration: rawDuration > 10000 ? rawDuration / 1000 : rawDuration,
          lMusic: song.lMusic ?? song.l,
          hMusic: song.hMusic ?? song.h,
          sqMusic: song.sqMusic ?? song.sq,
          hrMusic: song.hrMusic ?? song.hr,
          privilege: song.privilege ?? { chargeInfoList: [] },
        }
      }))
      const offset = (page - 1) * this.limit
      return {
        list: allTracks.slice(offset, offset + this.limit),
        page,
        limit: this.limit,
        total: Number(body.album.size ?? allTracks.length),
        source: 'wy',
        info: {
          name: String(body.album.name ?? ''),
          img: typeof body.album.picUrl === 'string' ? body.album.picUrl : null,
          desc: body.album.description == null ? null : String(body.album.description),
          author: formatSingerName(body.album.artists),
        },
      }
    })
  },
}

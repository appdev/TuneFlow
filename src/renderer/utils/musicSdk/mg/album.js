import { createHttpFetch } from './utils'
import { filterMusicInfoListV5 } from './musicInfo'
import { formatPlayCount } from '../../index'

export default {
  /**
   * 通过AlbumId获取专辑
   * @param {*} id
   * @param {*} page
   */
  async getAlbumDetail(id, page = 1) {
    const resolved = await this.resolveAlbum(id)
    const list = await createHttpFetch(`https://c.musicapp.migu.cn/MIGUM3.0/resource/album/song/v2.0?albumId=${resolved.id}&pageNo=${page}&pageSize=50`)
    if (!list.songList) return Promise.reject(new Error('Get album list error.'))

    const songList = filterMusicInfoListV5(list.songList)
    const listInfo = resolved.info
    const total = Number(list.totalCount ?? listInfo.total ?? songList.length)

    return {
      list: songList || [],
      page,
      limit: 50,
      total,
      source: 'mg',
      info: {
        name: listInfo.name,
        img: listInfo.image,
        desc: listInfo.desc,
        author: listInfo.author,
        play_count: listInfo.play_count,
      },
    }
  },
  async resolveAlbum(id) {
    const info = await this.getAlbumInfo(id)
    if (info) return { id, info }

    const digital = await createHttpFetch(`https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=5&resourceId=${id}`)
    const materialId = digital.resource?.[0]?.materialId
    if (!materialId) return Promise.reject(new Error('Get album info error.'))
    const materialInfo = await this.getAlbumInfo(materialId)
    if (!materialInfo) return Promise.reject(new Error('Get album info error.'))
    return { id: String(materialId), info: materialInfo }
  },
  /**
   * 通过AlbumId获取专辑信息
   * @param {*} id
   * @param {*} page
   */
  async getAlbumInfo(id) {
    const info = await createHttpFetch(`https://c.musicapp.migu.cn/resource/album/v2.0?albumId=${id}`)
    if (!info?.title) return null

    return {
      name: info.title,
      image: info.imgItems?.[0]?.img ?? null,
      desc: info.summary ?? null,
      author: info.singer ?? '',
      play_count: formatPlayCount(info.opNumItem?.playNum ?? 0),
      total: Number(info.totalCount ?? 0),
    }
  },
}

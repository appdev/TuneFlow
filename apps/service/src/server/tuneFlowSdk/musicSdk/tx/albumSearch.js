import { signRequest } from './utils'
import musicSearch from './musicSearch'

export default {
  limit: 20,
  search(text, page = 1, limit = this.limit) {
    const key = 'music.search.SearchCgiService'
    return signRequest({
      comm: {
        _channelid: '0',
        _os_version: '6.2.9200-2',
        ct: '19',
        cv: '2151',
        guid: '1F70E520B2EAA7D25E11760783C53CA9',
        patch: '118',
        psrf_access_token_expiresAt: 0,
        psrf_qqaccess_token: '',
        psrf_qqopenid: '',
        psrf_qqunionid: '',
        tmeAppID: 'qqmusic',
        tmeLoginType: 0,
        uin: '0',
        wid: '7223299733393904640',
      },
      [key]: {
        module: key,
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: limit,
          page_num: page,
          query: text,
          remoteplace: 'txt.newclient.album',
          search_type: 2,
          searchid: musicSearch.getSearchId(),
        },
      },
    }).then(({ body }) => {
      const result = body?.[key]
      const albums = result?.data?.body?.album?.list
      if (body?.code !== 0 || result?.code !== 0 || !Array.isArray(albums)) throw new Error('Album search failed')
      return {
        list: albums.map(album => ({
          id: String(album.albumMID ?? ''),
          name: String(album.albumName ?? ''),
          author: String(album.singerName ?? ''),
          total: Number(album.song_count ?? 0),
          img: typeof album.albumPic === 'string' ? album.albumPic : null,
          source: 'tx',
        })),
        total: Number(result.data.meta?.sum ?? albums.length),
        limit,
        source: 'tx',
      }
    })
  },
}

import { getWorkspace } from '@renderer/service/session'
import { withBrowseTimeout } from '../browseRequest'

export const albumSources = ['tx', 'wy', 'kg']
const limit = 20
export const searchAlbums = async(text, source, page = 1) => {
  const sources = source == 'all' ? albumSources : [source]
  const results = await Promise.allSettled(sources.map(async(id) => withBrowseTimeout(getWorkspace().search(id, text, page, limit, 'albums'))))
  const successful = results.filter(item => item.status == 'fulfilled').map(item => item.value)
  if (!successful.length) throw new Error('Album search failed')
  const list = []
  for (let index = 0; index < limit; index++) {
    for (const result of successful) if (result.list[index]) list.push(result.list[index])
  }
  return { list, hasMore: successful.some(item => page * item.limit < item.total), failedSources: sources.filter((_, index) => results[index].status == 'rejected') }
}
export const getAlbumTracks = async(source, id) => getWorkspace().album(source, id)

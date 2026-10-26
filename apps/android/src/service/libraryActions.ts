import { confirmDialog, toast } from '@/utils/tools'
import { getWorkspace, refreshServiceLists } from './session'

const deleting = new Set<string>()
export const deleteLibrarySelection = async(tracks: LX.Music.MusicInfo[]) => {
  if (deleting.size || !tracks.length) return false
  const workspace = getWorkspace()
  deleting.add(workspace.client.endpoint)
  try {
    if (!await confirmDialog({ message: `删除选中的 ${tracks.length} 首音乐文件？音频及对应歌词等资源将从音乐库永久删除，所有设备都会同步生效。此操作无法撤销；收藏和歌单不会删除。`, confirmButtonText: '删除音乐文件' })) return false
    if (workspace !== getWorkspace()) throw new Error('SERVER_CHANGED')
    const result = await workspace.deleteLibraryTracks(tracks)
    await refreshServiceLists().catch(() => {})
    if (result.failed) toast(`已删除 ${result.deleted} 首，${result.failed} 首删除失败，请刷新音乐库后重试。`)
    return result.deleted > 0
  } catch {
    toast('无法删除音乐文件，请确认连接未改变并刷新音乐库后重试。')
    return false
  } finally { deleting.clear() }
}

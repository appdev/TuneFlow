import { downloadMusics } from './worker'
import settingState from '@/store/setting/state'
import { toast } from '@/utils/tools'
import { isServerLibraryTrack } from '@/service/tracks'
import { ServiceError } from '@/service/client'

const pending = new Map<string, Promise<boolean>>()
let queue = Promise.resolve(false)

export const downloadSelection = async(musics: LX.Music.MusicInfo[]): Promise<boolean> => {
  const targets = [...new Map(musics.filter((music): music is LX.Music.MusicInfoOnline => music.source != 'local' && !isServerLibraryTrack(music)).map(music => [`${music.source}:${music.id}`, music])).values()]
  if (!targets.length) { toast(global.i18n.t('download_selection_local')); return false }
  const quality = settingState.setting['player.playQuality']
  const key = `${quality}:${targets.map(music => `${music.source}:${music.id}`).sort().join('|')}`
  const running = pending.get(key)
  if (running) return running
  // 权限请求串行处理，重复点击同一批歌曲共用任务。
  const task = queue.catch(() => false).then(async() => {
    try {
      if (!await downloadMusics(targets, quality)) return false
      toast(global.i18n.t('download_selection_added'))
      return true
    } catch (error) {
      toast(error instanceof ServiceError && error.code === 'DOWNLOAD_TASK_ACTIVE' ? error.message : global.i18n.t('download_selection_failed'))
      return false
    }
  }).finally(() => { pending.delete(key) })
  pending.set(key, task)
  queue = task
  return task
}

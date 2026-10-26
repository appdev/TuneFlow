import { playNext, getNextPlayMusicInfo } from '@renderer/core/player'
import { addTempPlayList, clearTempPlayeList } from '@renderer/store/player/action'
import { playMusicInfo, tempPlayList } from '@renderer/store/player/state'
import { appSetting } from '@renderer/store/setting'
import { autoRadioContinuation } from './preferences'
import { closeRadioSession, createRadioSession, nextRadioBatch, type RadioBatchRequest, type RadioBatchResponse, type RadioMode } from './api'
import { radioError, radioLoading, radioQueueGeneration, radioSessionId, resetRadioSession, setRadioSession } from './state'

const onlineTrack = (value: TuneFlow.Music.MusicInfo | TuneFlow.Download.ListItem | null): TuneFlow.Music.MusicInfoOnline | null => {
  if (value == null) return null
  return ('progress' in value ? value.metadata.musicInfo : value) as TuneFlow.Music.MusicInfoOnline
}
const requestId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
const request = (): RadioBatchRequest => ({
  requestId: requestId(),
  queueGeneration: radioQueueGeneration.value,
  currentTrack: onlineTrack(playMusicInfo.musicInfo),
  queuedTracks: tempPlayList.map(item => onlineTrack(item.musicInfo)).filter((track): track is TuneFlow.Music.MusicInfoOnline => track != null),
  limit: 3,
})
const queue = (response: RadioBatchResponse): number => {
  setRadioSession(response)
  const items = response.items.map(item => ({
    listId: null,
    musicInfo: item.track,
    isTop: false,
    playbackContext: { recommendationItemId: item.recommendationItemId, radioSessionId: response.sessionId },
  }))
  addTempPlayList(items)
  return items.length
}

const create = async(mode: RadioMode): Promise<number> => {
  const response = await createRadioSession(mode, request())
  return queue(response)
}

export const startDedicatedRadio = async(): Promise<void> => {
  if (radioLoading.value) return
  radioLoading.value = true
  radioError.value = null
  try {
    if (radioSessionId.value != null) await closeRadioSession(radioSessionId.value).catch(() => {})
    const response = await createRadioSession('dedicated', { ...request(), queueGeneration: radioQueueGeneration.value + 1 })
    if (response.items.length === 0) throw new Error(window.i18n.t('radio__empty'))
    radioQueueGeneration.value += 1
    clearTempPlayeList()
    queue(response)
    await playNext()
  } catch (error) {
    radioError.value = error instanceof Error ? error.message : String(error)
  } finally { radioLoading.value = false }
}

export const stopRadio = async(): Promise<void> => {
  const sessionId = radioSessionId.value
  resetRadioSession()
  if (sessionId != null) await closeRadioSession(sessionId).catch(() => {})
}

export const continueRadioBeforeAutoAdvance = async(): Promise<boolean> => {
  if (tempPlayList.length > 0) return false
  const activeId = radioSessionId.value
  const playingRadio = playMusicInfo.playbackContext?.radioSessionId === activeId && activeId != null
  if (!playingRadio) {
    if (!autoRadioContinuation.value || appSetting['player.togglePlayMethod'] !== 'list') return false
    if (await getNextPlayMusicInfo() != null) return false
  }
  if (radioLoading.value) return false
  radioLoading.value = true
  radioError.value = null
  try {
    if (!playingRadio && activeId != null) {
      await closeRadioSession(activeId).catch(() => {})
      resetRadioSession()
    }
    radioQueueGeneration.value += 1
    const count = activeId == null || !playingRadio
      ? await create('queue_continuation')
      : queue(await nextRadioBatch(activeId, request()))
    return count > 0
  } catch (error) {
    radioError.value = error instanceof Error ? error.message : String(error)
    if (playingRadio) resetRadioSession()
    return false
  } finally { radioLoading.value = false }
}

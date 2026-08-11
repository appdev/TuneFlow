import { rendererSend, rendererInvoke, rendererOn, rendererOff } from '@web-runtime/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME, CMMON_EVENT_NAME } from '@common/ipcNames'
import { DATA_KEYS, DEFAULT_SETTING } from '@common/constants'

type RemoveListener = () => void

const ignoreUnsupportedIpc = (error: unknown) => {
  if (typeof error == 'object' && error != null && 'code' in error && error.code == 'UNSUPPORTED_IPC') return
  throw error
}

export const getSetting = async() => {
  return rendererInvoke<LX.AppSetting>(CMMON_EVENT_NAME.get_app_setting)
}
export const updateSetting = async(setting: Partial<LX.AppSetting>) => {
  await rendererInvoke(CMMON_EVENT_NAME.set_app_setting, setting).catch(ignoreUnsupportedIpc)
}
export const onSettingChanged = (listener: LX.IpcRendererEventListenerParams<Partial<LX.AppSetting>>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, listener)
  }
}

export const getHotKeyConfig = async() => {
  return rendererInvoke<LX.HotKeyConfigAll>(WIN_MAIN_RENDERER_EVENT_NAME.get_hot_key)
}

export const importUserApi = async(fileText: string) => {
  return rendererInvoke<string, LX.UserApi.ImportUserApi>(WIN_MAIN_RENDERER_EVENT_NAME.import_user_api, fileText)
}
export const setUserApi = async(source: LX.UserApi.UserApiSetApiParams): Promise<void> => {
  return rendererInvoke<LX.UserApi.UserApiSetApiParams>(WIN_MAIN_RENDERER_EVENT_NAME.set_user_api, source)
}
export const removeUserApi = async(ids: string[]) => {
  return rendererInvoke<string[], LX.UserApi.UserApiInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.remove_user_api, ids)
}
export const onShowUserApiUpdateAlert = (listener: LX.IpcRendererEventListenerParams<LX.UserApi.UserApiUpdateInfo>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, listener)
  }
}
export const setAllowShowUserApiUpdateAlert = async(id: string, enable: boolean): Promise<void> => {
  return rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.user_api_set_allow_update_alert, { id, enable })
}
export const onUserApiStatus = (listener: LX.IpcRendererEventListenerParams<LX.UserApi.UserApiStatus>): RemoveListener => {
  rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, listener)
  return () => {
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, listener)
  }
}
export const getUserApiList = async() => {
  return rendererInvoke<LX.UserApi.UserApiInfo[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_list)
}
export const sendUserApiRequest = async({ requestKey, data }: LX.UserApi.UserApiRequestParams): Promise<any> => {
  return rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, {
    requestKey,
    data,
  })
}
export const userApiRequestCancel = (requestKey: LX.UserApi.UserApiRequestCancelParams) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api_cancel, requestKey)
}

export const savePlayInfo = (playInfo: LX.Player.SavedPlayInfo) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.playInfo,
    data: playInfo,
  })
}
// 获取上次关闭时的当前歌曲播放信息
export const getPlayInfo = async() => {
  return rendererInvoke<string, LX.Player.SavedPlayInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.playInfo)
}

export const saveSearchHistoryList = (list: LX.List.SearchHistoryList) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.searchHistoryList,
    data: list,
  })
}
// 获取搜索历史列表
export const getSearchHistoryList = async() => {
  return rendererInvoke<string, string[] | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.searchHistoryList)
}

export const saveListPositionInfo = (listPosition: LX.List.ListPositionInfo) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.listScrollPosition,
    data: listPosition,
  })
}
// 获取搜索历史列表
export const getListPositionInfo = async() => {
  return rendererInvoke<string, LX.List.ListPositionInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.listScrollPosition)
}

export const saveListPrevSelectId = (listPosition: string | null) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.listPrevSelectId,
    data: listPosition,
  })
}
// 获取上一次选中的列表id
export const getListPrevSelectId = async() => {
  return rendererInvoke<string, string | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.listPrevSelectId)
}

export const saveListUpdateInfo = (listPosition: LX.List.ListUpdateInfo) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.listUpdateInfo,
    data: listPosition,
  })
}
// 获取列表更新记录
export const getListUpdateInfo = async() => {
  return rendererInvoke<string, LX.List.ListUpdateInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.listUpdateInfo)
}

export const saveLeaderboardSetting = (source: typeof DEFAULT_SETTING['leaderboard']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.leaderboardSetting,
    data: source,
  })
}
export const getLeaderboardSetting = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['leaderboard']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.leaderboardSetting)) ?? { ...DEFAULT_SETTING.leaderboard }
}
export const saveSongListSetting = (setting: typeof DEFAULT_SETTING['songList']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.songListSetting,
    data: setting,
  })
}
export const getSongListSetting = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['songList']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.songListSetting)) ?? { ...DEFAULT_SETTING.songList }
}
export const saveSearchSetting = (setting: typeof DEFAULT_SETTING['search']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.searchSetting,
    data: setting,
  })
}
export const getSearchSetting = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['search']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.searchSetting)) ?? { ...DEFAULT_SETTING.search }
}
export const saveViewPrevState = (state: typeof DEFAULT_SETTING['viewPrevState']) => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.viewPrevState,
    data: state,
  })
}
export const getViewPrevState = async() => {
  return (await rendererInvoke<string, typeof DEFAULT_SETTING['viewPrevState']>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.viewPrevState)) ?? { ...DEFAULT_SETTING.viewPrevState }
}


export const getUserSoundEffectEQPresetList = async() => {
  return rendererInvoke<LX.SoundEffect.EQPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_eq_preset)
}

export const saveUserSoundEffectEQPresetList = (list: LX.SoundEffect.EQPreset[]) => {
  rendererSend<LX.SoundEffect.EQPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_eq_preset, list)
}

export const getUserSoundEffectConvolutionPresetList = async() => {
  return rendererInvoke<LX.SoundEffect.ConvolutionPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_convolution_preset)
}

export const saveUserSoundEffectConvolutionPresetList = (list: LX.SoundEffect.ConvolutionPreset[]) => {
  rendererSend<LX.SoundEffect.ConvolutionPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_convolution_preset, list)
}

// export const getUserSoundEffectPitchShifterPresetList = async() => {
//   return rendererInvoke<LX.SoundEffect.PitchShifterPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.get_sound_effect_pitch_shifter_preset)
// }

// export const saveUserSoundEffectPitchShifterPresetList = (list: LX.SoundEffect.PitchShifterPreset[]) => {
//   rendererSend<LX.SoundEffect.PitchShifterPreset[]>(WIN_MAIN_RENDERER_EVENT_NAME.save_sound_effect_pitch_shifter_preset, list)
// }

export const getPlayerLyric = async(musicInfo: LX.Music.MusicInfo) => {
  return rendererInvoke<string, LX.Player.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_palyer_lyric, musicInfo.id)
}

export const getLyricRaw = async(musicInfo: LX.Music.MusicInfo): Promise<LX.Music.LyricInfo> => {
  return rendererInvoke<string, LX.Music.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_raw, musicInfo.id)
}

export const getLyricEdited = async(musicInfo: LX.Music.MusicInfo): Promise<LX.Music.LyricInfo> => {
  return rendererInvoke<string, LX.Music.LyricInfo>(WIN_MAIN_RENDERER_EVENT_NAME.get_lyric_edited, musicInfo.id)
}

export const saveLyric = async(musicInfo: LX.Music.MusicInfo, lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo) => {
  // console.log(musicInfo)
  if ('rawlrcInfo' in lyricInfo) {
    const { rawlrcInfo, ...info } = lyricInfo
    const tasks = [
      rendererInvoke<LX.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw, {
        id: musicInfo.id,
        lyrics: rawlrcInfo,
      }),
    ]
    if (info.lyric != rawlrcInfo.lyric) {
      tasks.push(rendererInvoke<LX.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_edited, {
        id: musicInfo.id,
        lyrics: info,
      }))
    }
    console.log(tasks)
    await Promise.all(tasks)
  } else {
    await rendererInvoke<LX.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_raw, {
      id: musicInfo.id,
      lyrics: lyricInfo,
    })
  }
}
export const saveLyricEdited = async(musicInfo: LX.Music.MusicInfo, lyricInfo: LX.Music.LyricInfo) => {
  await rendererInvoke<LX.Music.LyricInfoSave>(WIN_MAIN_RENDERER_EVENT_NAME.save_lyric_edited, {
    id: musicInfo.id,
    lyrics: lyricInfo,
  })
}
export const removeLyricEdited = async(musicInfo: LX.Music.MusicInfo) => {
  await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.remove_lyric_edited, musicInfo.id)
}

/**
 * 从缓存获取歌曲URL
 * @param musicInfo 歌曲信息
 * @param type URL音质
 * @returns
 */
export const getMusicUrl = async(musicInfo: LX.Music.MusicInfo, type: LX.Quality): Promise<string> => {
  return rendererInvoke<string, string>(WIN_MAIN_RENDERER_EVENT_NAME.get_music_url, `${musicInfo.id}_${type}`)
}

/**
 * 缓存歌曲URL
 * @param musicInfo 歌曲信息
 * @param type URL音质
 * @param url 歌曲URL
 */
export const saveMusicUrl = async(musicInfo: LX.Music.MusicInfo, type: LX.Quality, url: string) => {
  await rendererInvoke<LX.Music.MusicUrlInfo>(WIN_MAIN_RENDERER_EVENT_NAME.save_music_url, {
    id: `${musicInfo.id}_${type}`,
    url,
  })
}

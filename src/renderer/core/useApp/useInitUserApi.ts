import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { onUserApiStatus, getUserApiList, sendUserApiRequest as sendUserApiRequestRemote, userApiRequestCancel, onShowUserApiUpdateAlert } from '@renderer/utils/ipc'
import { openUrl } from '@web-runtime/browser'
import { qualityList, userApi } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { dialog } from '@renderer/plugins/Dialog'
import { setUserApi } from '@renderer/core/apiSource'
import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { nextLegacySource, splitSourceChain } from '@renderer/core/userApiSourceChain'

const sendUserApiRequest: typeof sendUserApiRequestRemote = async(data) => {
  let rejectSourceChange: (reason: Error) => void = () => {}
  const sourceChange = new Promise<never>((_resolve, reject) => {
    rejectSourceChange = reject
  })
  const stop = watch(() => appSetting['common.apiSource'], () => { rejectSourceChange(new Error('source changed')) })
  try {
    return await Promise.race([sendUserApiRequestRemote(data), sourceChange])
  } finally {
    stop()
  }
}

export default () => {
  const t = useI18n()

  const rUserApiStatus = onUserApiStatus(({ params: { status, message, apiInfo, apiList } }) => {
    // console.log({ status, message, apiInfo })
    userApi.status = status
    userApi.message = message
    if (apiList) userApi.list = apiList

    if (!apiInfo || apiInfo.id !== appSetting['common.apiSource']) return
    if (status) {
      if (apiInfo.sources) {
        let apis: any = {}
        let qualitys: TuneFlow.QualityList = {}
        for (const [source, { actions, type, qualitys: sourceQualitys }] of Object.entries(apiInfo.sources)) {
          if (type != 'music') continue
          apis[source as TuneFlow.Source] = {}
          for (const action of actions) {
            switch (action) {
              case 'musicUrl':
                apis[source].getMusicUrl = (songInfo: TuneFlow.Music.MusicInfo, type: TuneFlow.Quality) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'musicUrl',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return { type, url: res.data.url }
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'lyric':
                apis[source].getLyric = (songInfo: TuneFlow.Music.MusicInfo) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'lyric',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return res.data
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'pic':
                apis[source].getPic = (songInfo: TuneFlow.Music.MusicInfo) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'pic',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return res.data
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              default:
                break
            }
          }
          qualitys[source as TuneFlow.Source] = sourceQualitys
        }
        qualityList.value = qualitys
        userApi.apis = apis
      }
    } else {
      if (message) {
        void dialog({
          message: `${t('user_api__init_failed_alert', { name: apiInfo.name })}\n${message}`,
          selection: true,
          confirmButtonText: t('ok'),
        })
      }
    }
    if (!window.tuneflow.apiInitPromise[1]) window.tuneflow.apiInitPromise[2](status)
  })

  const rUserApiShowUpdateAlert = onShowUserApiUpdateAlert(({ params: { name, log, updateUrl } }) => {
    if (updateUrl) {
      void dialog({
        message: `${t('user_api__update_alert', { name })}\n${log}`,
        selection: true,
        showCancel: true,
        confirmButtonText: t('user_api__update_alert_open_url'),
        cancelButtonText: t('close'),
      }).then(confirm => {
        if (!confirm) return
        window.setTimeout(() => {
          void openUrl(updateUrl)
        }, 300)
      })
    } else {
      void dialog({
        message: `${t('user_api__update_alert', { name })}\n${log}`,
        selection: true,
        confirmButtonText: t('ok'),
      })
    }
  })

  onBeforeUnmount(() => {
    rUserApiStatus()
    rUserApiShowUpdateAlert()
  })

  return async() => {
    if (globalThis.tuneFlowWebRuntime != null) {
      const list = await getUserApiList()
      userApi.list = list
      const enabledIds = splitSourceChain(list).enabled.map(source => source.id)
      const builtInIds = apiSourceInfo.filter(source => !source.disabled).map(source => source.id)
      const sourceId = nextLegacySource(enabledIds, builtInIds)
      if (sourceId) await setUserApi(sourceId)
      return
    }
    await setUserApi(appSetting['common.apiSource'])
    void getUserApiList().then(list => {
      // console.log(list)
      // if (![...apiSourceInfo.map(s => s.id), ...list.map(s => s.id)].includes(appSetting['common.apiSource'])) {
      //   console.warn('reset api')
      //   let api = apiSourceInfo.find(api => !api.disabled)
      //   if (api) apiSource.value = api.id
      // }
      userApi.list = list
    }).catch(err => {
      console.log(err)
    })
  }
}

// import defaultSetting from '@common/defaultSetting'
import { createWebWorkers } from '@web-runtime/workers'

window.tuneflow = {
  // appSetting: defaultSetting,
  isEditingHotKey: false,
  isPlayedStop: false,
  appHotKeyConfig: {
    local: {
      enable: false,
      keys: {},
    },
    global: {
      enable: false,
      keys: {},
    },
  },
  songListInfo: {
    fromName: '',
    searchKey: '',
    searchPosition: 0,
    songlistKey: '',
    songlistPosition: 0,
  },
  restorePlayInfo: null,
  worker: createWebWorkers(),
  isProd: process.env.NODE_ENV == 'production',
  rootOffset: window.dt ? 0 : 8,
  apiInitPromise: [Promise.resolve(false), true, () => {}],
}

window.tuneFlowData = {}

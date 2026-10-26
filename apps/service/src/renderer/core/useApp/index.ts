import { getViewPrevState } from '@renderer/utils/ipc'

import { proxy, themeId } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'

import useDataInit from './useDataInit'
import useEventListener from './useEventListener'
import usePlayer from './usePlayer'
import useWebSettingSync from './useWebSettingSync'
import { useRouter } from '@common/utils/vueRouter'
import handleListAutoUpdate from './listAutoUpdate'


export default () => {
  // apiSource.value = appSetting['common.apiSource']
  proxy.enable = appSetting['network.proxy.enable']
  proxy.host = appSetting['network.proxy.host']
  proxy.port = appSetting['network.proxy.port']
  themeId.value = appSetting['theme.id']

  const router = useRouter()
  useEventListener()
  const initPlayer = usePlayer()
  const initData = useDataInit()
  useWebSettingSync()

  void getViewPrevState().then(state => {
    void router.push({ path: state.url, query: state.query })
  })

  void initData().then(() => {
    initPlayer()
    handleListAutoUpdate()
  })
}

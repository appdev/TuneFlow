import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { usePageVisible } from '@/store/common/hook'
import { COMPONENT_IDS } from '@/config/constant'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'

export default (active = true) => {
  const visible = useRef(true)
  const enabled = useRef(active)
  enabled.current = active
  const sync = useCallback(() => {
    if (enabled.current && visible.current && AppState.currentState == 'active') screenkeepAwake()
    else screenUnkeepAwake()
  }, [])
  usePageVisible([COMPONENT_IDS.playDetail], useCallback(value => {
    visible.current = value
    sync()
  }, [sync]))
  useEffect(() => {
    sync()
    const subscription = AppState.addEventListener('change', sync)
    return () => { subscription.remove(); screenUnkeepAwake() }
  }, [active, sync])
}

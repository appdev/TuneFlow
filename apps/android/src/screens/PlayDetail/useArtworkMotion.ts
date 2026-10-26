import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { usePageVisible } from '@/store/common/hook'
import { useIsPlay } from '@/store/player/hook'
import { useMotion } from '@/utils/useMotion'
import { COMPONENT_IDS } from '@/config/constant'

// 只在播放详情可见且应用在前台时驱动装饰动画，不占用后台播放资源。
export default (active = true) => {
  const [foreground, setForeground] = useState(AppState.currentState == 'active')
  const [visible, setVisible] = useState(true)
  const playing = useIsPlay()
  const motion = useMotion()
  usePageVisible([COMPONENT_IDS.playDetail], useCallback((value) => { setVisible(value) }, []))
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { setForeground(state == 'active') })
    return () => { subscription.remove() }
  }, [])
  return active && playing && motion && foreground && visible
}

import Vertical from './Vertical'
import Horizontal from './Horizontal'
import Phone from './Phone'
import useAdaptiveLayout from '@/utils/hooks/useAdaptiveLayout'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { useCallback } from 'react'
// import { AppColors } from '@/theme'
import commonState from '@/store/common/state'
import { setNavActiveId } from '@/core/common'

export type { SettingScreenIds } from './Main'

export default () => {
  const { wide, phone } = useAdaptiveLayout()
  useBackHandler(useCallback(() => {
    if (Object.keys(commonState.componentIds).length == 1 && commonState.navActiveId == 'nav_setting') {
      setNavActiveId(commonState.lastNavActiveId)
      return true
    }
    return false
  }, []))

  return phone ? <Phone /> : wide ? <Horizontal /> : <Vertical />
}

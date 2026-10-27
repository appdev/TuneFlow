import { useEffect, useRef } from 'react'
import PageContent from '@/components/PageContent'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import Vertical from './Vertical'
import { navigations } from '@/navigation'
import settingState from '@/store/setting/state'
import { useServiceStatus } from '@/service/useSession'


interface Props {
  componentId: string
}


export default ({ componentId }: Props) => {
  const status = useServiceStatus()
  const startupHandled = useRef(false)
  useEffect(() => {
    setComponentId(COMPONENT_IDS.home, componentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!status.hasConnected || startupHandled.current) return
    startupHandled.current = true
    if (settingState.setting['player.startupPushPlayDetailScreen']) navigations.pushPlayDetailScreen(componentId, true)
  }, [componentId, status.hasConnected])

  return (
    <PageContent>
      <Vertical key={status.endpoint} />
    </PageContent>
  )
}

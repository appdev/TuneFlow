import { registerRendererTransport } from '@common/rendererTransport'
import { getWorkspace, invokeServiceList, onServiceList, offServiceList, serviceListEvent } from './session'
import { scopeClientDataKey } from './workspace'

registerRendererTransport({
  handles: serviceListEvent,
  invoke: invokeServiceList,
  on: onServiceList,
  off: offServiceList,
  dataKey: key => scopeClientDataKey(key, getWorkspace().client.endpoint),
})

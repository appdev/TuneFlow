import { onBeforeUnmount, ref } from 'vue'
import { serviceStatus, subscribeService } from './session'

export const useServiceStatus = () => {
  const status = ref({ ...serviceStatus })
  onBeforeUnmount(subscribeService(() => { status.value = { ...serviceStatus } }))
  return status
}

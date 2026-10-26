import { ref } from '@common/utils/vueTools'
import type { RadioAIStatus, RadioMode } from './api'

export const radioSessionId = ref<string | null>(null)
export const radioMode = ref<RadioMode | null>(null)
export const radioAIStatus = ref<RadioAIStatus>('local')
export const radioLoading = ref(false)
export const radioError = ref<string | null>(null)
export const radioQueueGeneration = ref(0)

export const setRadioSession = (input: { sessionId: string, mode: RadioMode, aiStatus: RadioAIStatus }): void => {
  radioSessionId.value = input.sessionId
  radioMode.value = input.mode
  radioAIStatus.value = input.aiStatus
  radioError.value = null
}

export const resetRadioSession = (): void => {
  radioSessionId.value = null
  radioMode.value = null
  radioAIStatus.value = 'local'
  radioQueueGeneration.value += 1
}

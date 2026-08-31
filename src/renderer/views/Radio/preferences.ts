import { ref } from '@common/utils/vueTools'

const key = 'tuneflow.player.autoRadioContinuation'
const initial = (): boolean => {
  try { return localStorage.getItem(key) === 'true' } catch { return false }
}

export const autoRadioContinuation = ref(initial())
export const setAutoRadioContinuation = (enabled: boolean): void => {
  autoRadioContinuation.value = enabled
  try { localStorage.setItem(key, String(enabled)) } catch {}
}

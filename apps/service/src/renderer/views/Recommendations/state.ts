import { onBeforeUnmount, onMounted, ref } from '@common/utils/vueTools'
import { rendererOff, rendererOn } from '@web-runtime/rendererIpc'
import { getDailyRecommendations, refreshDailyRecommendations, sendRecommendationFeedback, type DailyRecommendationResponse, type RecommendationItem } from './api'

export const useRecommendations = () => {
  const daily = ref<DailyRecommendationResponse | null>(null)
  const loading = ref(true)
  const refreshing = ref(false)
  const error = ref('')

  const load = async() => {
    loading.value = true
    error.value = ''
    try { daily.value = await getDailyRecommendations() } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } finally { loading.value = false }
  }
  const refresh = async() => {
    refreshing.value = true
    error.value = ''
    try {
      await refreshDailyRecommendations()
      if (daily.value != null) daily.value = { ...daily.value, status: 'generating' }
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      refreshing.value = false
    }
  }
  const dismiss = async(item: RecommendationItem) => {
    const previous = daily.value
    if (previous == null) return
    daily.value = { ...previous, items: previous.items.filter(entry => entry.recommendationItemId !== item.recommendationItemId) }
    try { await sendRecommendationFeedback({ type: 'not_interested_track', track: item.track }) } catch (reason) {
      daily.value = previous
      error.value = reason instanceof Error ? reason.message : String(reason)
    }
  }
  const reconcile = ({ params }: { params: DailyRecommendationResponse }) => {
    daily.value = params
    refreshing.value = false
    loading.value = false
    error.value = ''
  }
  onMounted(() => {
    rendererOn('service_recommendations', reconcile)
    void load()
  })
  onBeforeUnmount(() => { rendererOff('service_recommendations', reconcile) })
  return { daily, loading, refreshing, error, load, refresh, dismiss }
}

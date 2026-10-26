import {
  onBeforeUnmount,
  watch,
} from '@common/utils/vueTools'
import { pause } from '@renderer/core/player/action'
import { dialog } from '@renderer/plugins/Dialog'
import { setMediaDeviceId } from '@renderer/plugins/player'
import { isPlay } from '@renderer/store/player/state'
import { appSetting, saveMediaDeviceId } from '@renderer/store/setting'
import { getBrowserMediaDevices, resolveAudioOutputDevice, subscribeToMediaDeviceChanges } from '@renderer/utils/mediaDevices'

const mediaDevices = getBrowserMediaDevices()

let isShowingTipAlert = false

export default () => {
  let prevDeviceLabel: string | null = null
  let prevDeviceId = ''

  const getMediaDevice = async(deviceId: string) => {
    const resolved = await resolveAudioOutputDevice(mediaDevices, deviceId)
    if (resolved.shouldReportEmpty && !isShowingTipAlert) {
      isShowingTipAlert = true
      void dialog({
        message: window.i18n.t('media_device__empty_device_tip'),
        confirmButtonText: window.i18n.t('ok'),
      }).finally(() => {
        isShowingTipAlert = false
      })
    }
    return resolved.device
  }
  const setMediaDevice = async(deviceId: string, label: string) => {
    prevDeviceLabel = label
    // console.log(device)
    setMediaDeviceId(deviceId).then(() => {
      prevDeviceId = deviceId
      saveMediaDeviceId(deviceId)
    }).catch((err: any) => {
      console.log(err)
      setMediaDeviceId('default').finally(() => {
        prevDeviceId = 'default'
        saveMediaDeviceId('default')
      })
    })
  }

  const handleDeviceChange = (label: string) => {
    // console.log(device)
    // console.log(appSetting['player.isMediaDeviceRemovedStopPlay'], isPlay.value, label, prevDeviceLabel)
    if (label != prevDeviceLabel) {
      window.app_event.playerDeviceChanged()

      if (appSetting['player.isMediaDeviceRemovedStopPlay'] && isPlay.value) {
        window.tuneflow.isPlayedStop = true
        pause()
      }
    }
  }

  const handleMediaListChange = async() => {
    const mediaDeviceId = appSetting['player.mediaDeviceId']
    const device = await getMediaDevice(mediaDeviceId)

    handleDeviceChange(device.label)

    if (device.deviceId == mediaDeviceId) prevDeviceLabel = device.label
    else void setMediaDevice(device.deviceId, device.label)
  }

  watch(() => appSetting['player.mediaDeviceId'], (id) => {
    if (prevDeviceId == id) return
    void getMediaDevice(id).then(async({ deviceId, label }) => setMediaDevice(deviceId, label))
  })

  void getMediaDevice(appSetting['player.mediaDeviceId']).then(async({ deviceId, label }) => setMediaDevice(deviceId, label))

  const unsubscribe = subscribeToMediaDeviceChanges(mediaDevices, handleMediaListChange)

  onBeforeUnmount(() => {
    unsubscribe()
  })
}

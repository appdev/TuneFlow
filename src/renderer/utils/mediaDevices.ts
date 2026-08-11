type MediaDevicesApi = Pick<MediaDevices, 'enumerateDevices' | 'addEventListener' | 'removeEventListener'>

export const getBrowserMediaDevices = (): MediaDevicesApi | undefined => {
  if (typeof navigator === 'undefined') return undefined
  return navigator.mediaDevices
}

export const enumerateAudioOutputDevices = async(mediaDevices: MediaDevicesApi | undefined): Promise<MediaDeviceInfo[]> => {
  if (mediaDevices == null) return []
  const devices = await mediaDevices.enumerateDevices()
  return devices.filter(({ kind }) => kind === 'audiooutput')
}

export const resolveAudioOutputDevice = async(
  mediaDevices: MediaDevicesApi | undefined,
  preferredDeviceId: string,
): Promise<{ device: { label: string, deviceId: string }, shouldReportEmpty: boolean }> => {
  if (mediaDevices == null) return { device: { label: '', deviceId: 'default' }, shouldReportEmpty: false }
  const devices = await enumerateAudioOutputDevices(mediaDevices)
  const device = devices.find(device => device.deviceId === preferredDeviceId) ?? devices.find(device => device.deviceId === 'default')
  return {
    device: device == null ? { label: '', deviceId: '' } : { label: device.label, deviceId: device.deviceId },
    shouldReportEmpty: device == null && devices.length === 0,
  }
}

export const subscribeToMediaDeviceChanges = (
  mediaDevices: MediaDevicesApi | undefined,
  listener: () => void | Promise<void>,
): (() => void) => {
  if (mediaDevices == null) return () => {}
  mediaDevices.addEventListener('devicechange', listener)
  return () => { mediaDevices.removeEventListener('devicechange', listener) }
}

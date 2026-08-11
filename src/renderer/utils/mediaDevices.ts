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

export const subscribeToMediaDeviceChanges = (
  mediaDevices: MediaDevicesApi | undefined,
  listener: () => void | Promise<void>,
): (() => void) => {
  if (mediaDevices == null) return () => {}
  mediaDevices.addEventListener('devicechange', listener)
  return () => { mediaDevices.removeEventListener('devicechange', listener) }
}

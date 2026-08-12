type UnsupportedCapabilityError = Error & { code: 'UNSUPPORTED_CAPABILITY' }

const unsupportedCapability = (name: string): UnsupportedCapabilityError => Object.assign(
  new Error(`${name} is not available in the web runtime`),
  { code: 'UNSUPPORTED_CAPABILITY' as const },
)

const rejectUnsupportedCapability = async(name: string): Promise<never> => {
  throw unsupportedCapability(name)
}

export const openUrl = async(url: string): Promise<void> => {
  if (!/^https?:\/\//.test(url)) return
  if (typeof window == 'undefined') return rejectUnsupportedCapability('openUrl')
  window.open(url, '_blank', 'noopener,noreferrer')
}

export const clipboardWriteText = (text: string): void => {
  const browserClipboard = globalThis.navigator?.clipboard
  if (browserClipboard == null) return
  void browserClipboard.writeText(text)
}

export const clipboardReadText = (): string => ''

export const joinPath = (...paths: string[]): string => paths.filter(Boolean).join('/')
export const extname = (path: string): string => path.slice(path.lastIndexOf('.'))
export const basename = (path: string, ext = ''): string => path.split('/').pop()?.replace(new RegExp(`${ext}$`), '') ?? ''
export const dirname = (path: string): string => path.split('/').slice(0, -1).join('/')
export const checkPath = async(): Promise<boolean> => false
export const checkAndCreateDir = async(): Promise<boolean> => false
export const getFileStats = async(): Promise<null> => null
export const createDir = async(): Promise<never> => rejectUnsupportedCapability('createDir')
export const removeFile = async(): Promise<never> => rejectUnsupportedCapability('removeFile')
export const readFile = async(): Promise<never> => rejectUnsupportedCapability('readFile')
export const toMD5 = (): never => {
  throw unsupportedCapability('toMD5')
}
export const gzipData = async(): Promise<never> => rejectUnsupportedCapability('gzipData')
export const gunzipData = async(): Promise<never> => rejectUnsupportedCapability('gunzipData')
export const saveTuneFlowConfigFile = async(): Promise<never> => rejectUnsupportedCapability('saveTuneFlowConfigFile')
export const readTuneFlowConfigFile = async(): Promise<never> => rejectUnsupportedCapability('readTuneFlowConfigFile')
export const saveStrToFile = async(): Promise<never> => rejectUnsupportedCapability('saveStrToFile')
export const b64DecodeUnicode = (value: string): string => atob(value)
export const copyFile = async(): Promise<never> => rejectUnsupportedCapability('copyFile')
export const moveFile = async(): Promise<never> => rejectUnsupportedCapability('moveFile')
export const getAddress = (): string[] => []

const log = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

export default Object.assign(log, {
  createCipheriv: (): never => {
    throw unsupportedCapability('crypto.createCipheriv')
  },
  createHash: (): never => {
    throw unsupportedCapability('crypto.createHash')
  },
})

import pako from 'pako'
import { createHash } from './crypto'
import { unavailable } from './unavailable'
export { join as joinPath, extname, basename, dirname } from './paths'
export const checkPath = async() => false
export const checkAndCreateDir = async() => false
export const getFileStats = async() => null
export const createDir = async() => unavailable('本机目录')
export const removeFile = async() => unavailable('本机文件')
export const readFile = async() => unavailable('本机文件')
export const toMD5 = (value: string) => createHash('md5').update(value).digest('hex')
export const gzipData = async(value: string) => Buffer.from(pako.gzip(value))
export const gunzipData = async(value: Buffer) => pako.ungzip(value, { to: 'string' })
export const saveStrToFile = async(name: string, value: string | Buffer) => {
  const url = URL.createObjectURL(new Blob([value as BlobPart]))
  const link = document.createElement('a')
  const fileName = name.split('/').pop()
  link.href = url; link.download = fileName?.length ? fileName : 'qmusic-export.txt'; link.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}
export const saveLxConfigFile = async(name: string, data: unknown) => saveStrToFile(name, await gzipData(JSON.stringify(data)))
export const readLxConfigFile = async() => unavailable('本机配置文件路径')
export const b64DecodeUnicode = (value: string) => Buffer.from(value, 'base64').toString('utf8')
export const copyFile = async() => unavailable('本机文件复制')
export const moveFile = async() => unavailable('本机文件移动')
export const getAddress = () => []

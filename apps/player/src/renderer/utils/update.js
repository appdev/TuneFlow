import { httpGet } from './request'
import { getUpdateVersion } from '@common/utils/updateSources'

export const getVersionInfo = async() => getUpdateVersion(async(url) => new Promise((resolve, reject) => {
  httpGet(url, { timeout: 8000 }, (err, response, body) => {
    if (err || response?.statusCode != 200) reject(err || new Error('更新信息获取失败'))
    else resolve(body)
  })
}), 'desktop')

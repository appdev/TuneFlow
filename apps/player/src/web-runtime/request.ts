// Legacy platform requests must never leak account credentials or bypass Service policy.
export const httpFetch = () => ({ promise: Promise.reject(Object.assign(new Error('请通过服务器目录接口访问音乐平台'), { code: 'UNSUPPORTED_CAPABILITY' })), cancelHttp: () => {} })
export const http = httpFetch
export const httpGet = httpFetch
export const httpPost = httpFetch
export const cancelHttp = () => {}
export default httpFetch

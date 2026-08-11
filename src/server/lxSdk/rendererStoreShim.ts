const environmentProxy = (() => {
  const value = process.env.HTTP_PROXY ?? process.env.http_proxy
  if (value == null) return null
  try {
    const url = new URL(value)
    return { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) }
  } catch {
    return null
  }
})()

export const proxy = {
  enable: false,
  host: '',
  port: '',
  envProxy: environmentProxy,
}

export const apiSource = { value: '' }
const apis: Record<string, unknown> = {}
export const userApi = { apis }

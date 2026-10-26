// 限制浏览页等待时间，失败后允许用户重试，不让平台内部重试一直占住加载状态。
export const withBrowseTimeout = async<T>(request: Promise<T>, timeout = 20_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((resolve, reject) => { timer = setTimeout(() => { reject(new Error('Browse request timed out')) }, timeout) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

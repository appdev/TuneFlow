// 浏览请求必须有结束时间；平台 SDK 的内部重试不能让界面一直停在加载中。
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

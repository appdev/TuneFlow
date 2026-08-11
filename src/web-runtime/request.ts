const parseBody = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const createRequest = (url, options = {}, callback) => {
  const controller = new AbortController()
  const timeout = options.timeout == null ? undefined : window.setTimeout(() => {
    controller.abort()
  }, options.timeout)
  const headers = new Headers(options.headers)
  let body = options.body ?? options.data
  if (options.form) {
    body = new URLSearchParams(options.form)
    headers.set('content-type', 'application/x-www-form-urlencoded')
  }

  void fetch(url, {
    method: options.method ?? 'get',
    headers,
    body,
    signal: controller.signal,
  }).then(async response => {
    const parsedBody = parseBody(await response.text())
    callback(null, {
      statusCode: response.status,
      headers: response.headers,
      body: parsedBody,
    }, parsedBody)
  }).catch(error => {
    callback(error instanceof Error ? error : new Error(String(error)), null)
  }).finally(() => {
    if (timeout != null) window.clearTimeout(timeout)
  })

  return {
    abort: () => {
      controller.abort()
    },
  }
}

const requestPromise = (url, options = {}) => {
  let request
  let rejectPromise = () => {}
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject
    request = createRequest(url, options, (error, response) => {
      if (error) reject(error)
      else resolve(response)
    })
  })

  return {
    promise,
    cancelHttp: () => {
      request.abort()
      rejectPromise(new Error('Request cancelled'))
    },
  }
}

export const httpFetch = (url, options = {}) => requestPromise(url, options)

export const cancelHttp = request => {
  request?.abort?.()
}

export const http = (url, options, callback) => {
  if (typeof options == 'function') return createRequest(url, {}, options)
  return createRequest(url, options, callback)
}

export const httpGet = (url, options, callback) => {
  if (typeof options == 'function') return createRequest(url, { method: 'get' }, options)
  return createRequest(url, { ...options, method: 'get' }, callback)
}

export const httpPost = (url, data, options, callback) => {
  if (typeof options == 'function') return createRequest(url, { method: 'post', data }, options)
  return createRequest(url, { ...options, method: 'post', data }, callback)
}

export const http_jsonp = (url, options, callback) => {
  if (typeof options == 'function') return createRequest(url, { method: 'get' }, options)
  return createRequest(url, { ...options, method: 'get' }, callback)
}

export const checkUrl = async(url, options = {}) => {
  const response = await httpFetch(url, { ...options, method: 'head' }).promise
  if (response.statusCode !== 200) throw new Error(String(response.statusCode))
}

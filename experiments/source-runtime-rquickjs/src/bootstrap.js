(() => {
  const outbound = []
  const callbacks = Object.create(null)
  let requestHandler
  let initialized
  let result
  let sequence = 0
  const EVENT_NAMES = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' })
  const runtime = {
    EVENT_NAMES,
    env: 'desktop',
    version: '2.0.0',
    currentScriptInfo: Object.freeze({}),
    on(name, handler) {
      if (name !== EVENT_NAMES.request || typeof handler !== 'function') return Promise.reject(new Error('unsupported event'))
      requestHandler = handler
      return Promise.resolve()
    },
    send(name, value) {
      if (name === EVENT_NAMES.inited && initialized === undefined) initialized = JSON.parse(JSON.stringify(value))
      return Promise.resolve()
    },
    request(url, options, callback) {
      if (typeof callback !== 'function') throw new TypeError('request callback required')
      const id = ++sequence
      callbacks[id] = callback
      outbound.push(JSON.stringify({ type: 'network', id, url: String(url), options: JSON.parse(JSON.stringify(options || {})) }))
      return () => { delete callbacks[id] }
    },
  }
  globalThis.window = globalThis
  globalThis.lx = runtime
  globalThis.tuneflow = runtime
  globalThis.console = Object.freeze({ log() {}, error() {}, warn() {}, group() {}, groupEnd() {} })
  globalThis.__tuneflowState = () => JSON.stringify({ initialized, hasRequestHandler: typeof requestHandler === 'function', result })
  globalThis.__tuneflowDrain = () => JSON.stringify(outbound.splice(0))
  globalThis.__tuneflowDeliver = raw => {
    const packet = JSON.parse(raw)
    const callback = callbacks[packet.id]
    if (!callback) return
    delete callbacks[packet.id]
    callback(packet.error ? Object.assign(new Error(packet.error.message), { code: packet.error.code }) : null, packet.response)
  }
  globalThis.__tuneflowInvoke = raw => {
    if (typeof requestHandler !== 'function') throw new Error('source request handler missing')
    Promise.resolve(requestHandler(JSON.parse(raw))).then(
      value => { result = { ok: true, value } },
      () => { result = { ok: false, error: { code: 'SOURCE_ERROR', message: 'source request failed' } } },
    )
  }
})()

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { parentPort, workerData } from 'node:worker_threads'
import vm from 'node:vm'
import { normalizeSourceRuntimeApi } from './parser'

const port = parentPort!
const data = workerData as { script: string, info: Record<string, string> }
const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' }
const serialize = (value: unknown): string => JSON.stringify(value)
const errorInfo = (error: unknown): { code: string, message: string } => {
  const value = error as { code?: unknown, message?: unknown }
  return { code: typeof value?.code === 'string' ? value.code : 'SOURCE_PROTOCOL_ERROR', message: typeof value?.message === 'string' ? value.message : String(error) }
}
const cryptoJsSource = readFileSync(require.resolve('crypto-js/crypto-js.js'), 'utf8')
const pakoSource = readFileSync(require.resolve('pako/dist/pako.js'), 'utf8')

interface WorkerBridge {
  deliver: (raw: string) => void
  drain: () => string
  invoke: (raw: string) => void
}

// Do not place a host-realm function, Buffer, timer, or Node object in this
// context. The script and this bootstrap exchange JSON strings through queues.
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })
const timerDispatchKey = `__tuneflowTimer_${randomBytes(16).toString('hex')}`
const timerDispatchSecret = randomBytes(32).toString('hex')
const bootstrap = `
((timerDispatchKey, timerDispatchSecret) => {
  ${cryptoJsSource}
  ${pakoSource}
  const EVENT_NAMES = ${serialize(EVENT_NAMES)};
  const MAX_MESSAGE_CHARS = 64 * 1024;
  const apply = Reflect.apply;
  const arrayIsArray = Array.isArray;
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const numberIsFinite = Number.isFinite;
  const numberIsInteger = Number.isInteger;
  const numberIsSafeInteger = Number.isSafeInteger;
  const promiseResolve = Promise.resolve.bind(Promise);
  const promiseThen = Promise.prototype.then;
  const legacyRuntimeKey = ['l', 'x'].join('');
  const legacyVerbatimKey = ['l', 'x', 'lyric'].join('');
  const outbound = [];
  const callbacks = Object.create(null);
  const timers = Object.create(null);
  let requestHandler;
  let initialized = false;
  let showedUpdate = false;
  let requestSequence = 0;
  let timerSequence = 0;
  let timerCount = 0;
  let invocationActive = false;
  const entropyUnavailable = () => { const error = new Error('Source entropy pool exhausted'); error.code = 'SOURCE_PROTOCOL_ERROR'; throw error; };
  let consumeEntropy = entropyUnavailable;
  const emit = value => {
    const encoded = jsonStringify(value);
    if (encoded.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error('Worker message exceeds limit'), { code: 'SOURCE_PROTOCOL_ERROR' });
    outbound.push(encoded);
  };
  const emitTimer = (type, id, delay) => {
    outbound.push('{"type":"' + type + '","id":' + id + (delay == null ? '' : ',"delay":' + delay) + '}');
  };
  const normalizeTimerDelay = value => {
    const delay = Number(value);
    if (!numberIsFinite(delay) || delay <= 0) return 0;
    return Math.min(Math.floor(delay), 60_000);
  };
  const setTimeout = (callback, delay, ...args) => {
    if (typeof callback !== 'function') throw Object.assign(new TypeError('Timer callback must be a function'), { code: 'SOURCE_PROTOCOL_ERROR' });
    if (timerCount >= 64) throw Object.assign(new Error('Too many pending source timers'), { code: 'SOURCE_PROTOCOL_ERROR' });
    const id = ++timerSequence;
    timers[id] = { callback, args };
    timerCount++;
    emitTimer('timer-schedule', id, normalizeTimerDelay(delay));
    return id;
  };
  const clearTimeout = id => {
    const timerId = Number(id);
    if (!numberIsSafeInteger(timerId) || timers[timerId] == null) return;
    delete timers[timerId];
    timerCount--;
    emitTimer('timer-cancel', timerId);
  };
  const bytes = value => value instanceof TuneFlowBuffer ? value : new TuneFlowBuffer(value instanceof Uint8Array ? value : []);
  const byteHex = value => Array.from(bytes(value), byte => byte.toString(16).padStart(2, '0')).join('');
  const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const base64Decode = value => { const text = String(value).replace(/[^A-Za-z0-9+/]/g, ''); const result = []; for (let index = 0; index < text.length; index += 4) { const word = (base64Alphabet.indexOf(text[index]) << 18) | (base64Alphabet.indexOf(text[index + 1]) << 12) | ((base64Alphabet.indexOf(text[index + 2]) & 63) << 6) | (base64Alphabet.indexOf(text[index + 3]) & 63); result.push((word >> 16) & 255); if (index + 2 < text.length) result.push((word >> 8) & 255); if (index + 3 < text.length) result.push(word & 255); } return new TuneFlowBuffer(result); };
  const base64Encode = value => { let result = ''; const source = bytes(value); for (let index = 0; index < source.length; index += 3) { const word = (source[index] << 16) | ((source[index + 1] || 0) << 8) | (source[index + 2] || 0); result += base64Alphabet[(word >> 18) & 63] + base64Alphabet[(word >> 12) & 63] + (index + 1 < source.length ? base64Alphabet[(word >> 6) & 63] : '=') + (index + 2 < source.length ? base64Alphabet[word & 63] : '='); } return result; };
  const decodeBytes = (value, encoding = 'utf8') => {
    if (encoding === 'hex') return new TuneFlowBuffer((value.match(/.{1,2}/g) || []).map(part => Number.parseInt(part, 16)));
    if (encoding === 'base64') return base64Decode(value);
    if (encoding === 'binary' || encoding === 'latin1') return new TuneFlowBuffer(Uint8Array.from(value, char => char.charCodeAt(0)));
    return new TuneFlowBuffer(Uint8Array.from(unescape(encodeURIComponent(value)), char => char.charCodeAt(0)));
  };
  class TuneFlowBuffer extends Uint8Array {
    static from(value, encoding) {
      if (typeof value === 'string') return decodeBytes(value, encoding);
      if (value instanceof ArrayBuffer) return new TuneFlowBuffer(value);
      return new TuneFlowBuffer(value || []);
    }
    static alloc(size) { return new TuneFlowBuffer(Number(size) || 0); }
    static concat(values) { const size = values.reduce((total, value) => total + value.length, 0); const result = new TuneFlowBuffer(size); let offset = 0; for (const value of values) { result.set(value, offset); offset += value.length; } return result; }
    toString(encoding = 'utf8') { if (encoding === 'hex') return byteHex(this); if (encoding === 'base64') return base64Encode(this); if (encoding === 'binary' || encoding === 'latin1') return String.fromCharCode(...this); return decodeURIComponent(escape(String.fromCharCode(...this))); }
  }
  const wordArray = value => CryptoJS.enc.Hex.parse(byteHex(value));
  const fromWordArray = value => TuneFlowBuffer.from(value.toString(CryptoJS.enc.Hex), 'hex');
  const derNodes = value => { const nodes = []; for (let offset = 0; offset < value.length;) { const tag = value[offset++]; let length = value[offset++]; if (length & 128) { const count = length & 127; length = 0; for (let i = 0; i < count; i++) length = length * 256 + value[offset++]; } const content = value.slice(offset, offset + length); nodes.push({ tag, content }); offset += length; } return nodes; };
  const rsaKey = pem => {
    const encoded = String(pem).replace(/-----(BEGIN|END) (RSA )?PUBLIC KEY-----|\\s/g, '');
    const bytes = base64Decode(encoded);
    const visit = value => { const nodes = derNodes(value); if (nodes.length === 2 && nodes[0].tag === 2 && nodes[1].tag === 2) return nodes; for (const node of nodes) { if (node.tag === 48) { const found = visit(node.content); if (found) return found; } if (node.tag === 3) { const found = visit(node.content.slice(1)); if (found) return found; } } return null; };
    const integers = visit(bytes); if (!integers) throw new Error('Invalid RSA public key');
    const bigint = value => Array.from(value.slice(value[0] === 0 ? 1 : 0)).reduce((result, byte) => (result << 8n) + BigInt(byte), 0n);
    return { modulus: bigint(integers[0].content), exponent: bigint(integers[1].content), size: integers[0].content.length - (integers[0].content[0] === 0 ? 1 : 0) };
  };
  const powmod = (value, exponent, modulus) => { let result = 1n; for (let base = value % modulus, power = exponent; power > 0n; power >>= 1n, base = (base * base) % modulus) if (power & 1n) result = (result * base) % modulus; return result; };
  const rsaEncrypt = (value, key) => { const rsa = rsaKey(key); const source = bytes(value); if (source.length > rsa.size) throw new Error('RSA input exceeds modulus'); let input = 0n; for (const byte of source) input = (input << 8n) + BigInt(byte); let encrypted = powmod(input, rsa.exponent, rsa.modulus).toString(16); encrypted = encrypted.padStart(rsa.size * 2, '0'); return TuneFlowBuffer.from(encrypted, 'hex'); };
  const normalizeActionResult = (request, value) => {
    if (request.action === 'musicUrl') {
      if (typeof value !== 'string' || value.length > 2048 || !/^https?:\\/\\//.test(value)) throw Object.assign(new Error('Invalid music URL response'), { code: 'SOURCE_PROTOCOL_ERROR' });
      return { url: value };
    }
    if (request.action === 'pic') {
      if (typeof value !== 'string' || value.length > 2048 || !/^https?:\\/\\//.test(value)) throw Object.assign(new Error('Invalid picture response'), { code: 'SOURCE_PROTOCOL_ERROR' });
      return value;
    }
    if (request.action === 'lyric') {
      if (value == null || typeof value !== 'object' || typeof value.lyric !== 'string' || value.lyric.length > 51200) throw Object.assign(new Error('Invalid lyric response'), { code: 'SOURCE_PROTOCOL_ERROR' });
      const verbatimLyric = value.verbatimLyric ?? value[legacyVerbatimKey];
      return { lyric: value.lyric, tlyric: typeof value.tlyric === 'string' && value.tlyric.length < 5120 ? value.tlyric : null, rlyric: typeof value.rlyric === 'string' && value.rlyric.length < 5120 ? value.rlyric : null, verbatimLyric: typeof verbatimLyric === 'string' && verbatimLyric.length < 8192 ? verbatimLyric : null };
    }
    throw Object.assign(new Error('Unsupported source action'), { code: 'SOURCE_PROTOCOL_ERROR' });
  };
  const tuneflow = {
    EVENT_NAMES,
    request(url, options = {}, callback) {
      if (typeof url !== 'string' || typeof callback !== 'function') throw new Error('Invalid request');
      const id = ++requestSequence;
      callbacks[id] = callback;
      emit({ type: 'network', id, url, options: jsonParse(jsonStringify(options)) });
      return () => {
        if (callbacks[id] == null) return;
        delete callbacks[id];
        emit({ type: 'network-cancel', id });
      };
    },
    send(eventName, value) {
      if (eventName === EVENT_NAMES.inited) {
        if (initialized) return Promise.reject(new Error('Script is inited'));
        initialized = true;
        emit({ type: 'initialized', sources: jsonParse(jsonStringify(value)) });
        return Promise.resolve();
      }
      if (eventName === EVENT_NAMES.updateAlert) {
        if (showedUpdate) return Promise.reject(new Error('The update alert can only be called once.'));
        showedUpdate = true;
        emit({ type: 'update-alert', data: jsonParse(jsonStringify(value)) });
        return Promise.resolve();
      }
      return Promise.reject(new Error('The event is not supported: ' + eventName));
    },
    on(eventName, handler) {
      if (eventName !== EVENT_NAMES.request || typeof handler !== 'function') return Promise.reject(new Error('The event is not supported: ' + eventName));
      requestHandler = handler;
      return Promise.resolve();
    },
    currentScriptInfo: ${serialize({ ...data.info, rawScript: data.script })},
    version: '2.0.0', env: 'desktop',
    utils: {
      crypto: {
        aesEncrypt(buffer, mode, key, iv) {
          const modeName = String(mode).toLowerCase().endsWith('-ecb') ? CryptoJS.mode.ECB : CryptoJS.mode.CBC;
          return fromWordArray(CryptoJS.AES.encrypt(wordArray(buffer), wordArray(key), { iv: wordArray(iv || []), mode: modeName, padding: CryptoJS.pad.Pkcs7 }).ciphertext);
        },
        rsaEncrypt,
        randomBytes(size) { return consumeEntropy(size); },
        md5: value => CryptoJS.MD5(String(value)).toString(CryptoJS.enc.Hex),
      },
      buffer: { from: (...args) => TuneFlowBuffer.from(...args), bufToString: (value, format) => TuneFlowBuffer.from(value).toString(format) },
      zlib: { inflate: value => Promise.resolve(TuneFlowBuffer.from(pako.inflate(bytes(value)))), deflate: value => Promise.resolve(TuneFlowBuffer.from(pako.deflate(bytes(value)))) },
    },
  };
  globalThis.window = globalThis;
  globalThis.window.tuneflow = tuneflow;
  globalThis[legacyRuntimeKey] = tuneflow;
  globalThis.setTimeout = setTimeout;
  globalThis.clearTimeout = clearTimeout;
  const drain = () => {
    const messages = [];
    for (let index = 0; index < outbound.length; index++) messages[index] = outbound[index];
    outbound.length = 0;
    return jsonStringify(messages);
  };
  const deliver = raw => {
    const value = jsonParse(raw); const callback = callbacks[value.id];
    if (callback == null) return;
    delete callbacks[value.id];
    const error = value.error == null ? null : Object.assign(new Error(value.error.message || value.error.code), { code: value.error.code });
    apply(callback, tuneflow, [error, value.response, value.body]);
  };
  const fireTimer = raw => {
    const value = jsonParse(raw);
    if (value.secret !== timerDispatchSecret) throw Object.assign(new Error('Invalid timer dispatch'), { code: 'SOURCE_PROTOCOL_ERROR' });
    const timer = timers[value.id];
    if (timer == null) return;
    delete timers[value.id];
    timerCount--;
    apply(timer.callback, globalThis, timer.args);
  };
  Object.defineProperty(globalThis, timerDispatchKey, { value: fireTimer, configurable: false, enumerable: false, writable: false });
  const invoke = raw => {
    const packet = jsonParse(raw);
    if (typeof requestHandler !== 'function') { emit({ type: 'response-error', id: packet.id, code: 'SOURCE_PROTOCOL_ERROR', message: 'Request event is not defined' }); return; }
    if (invocationActive) { emit({ type: 'response-error', id: packet.id, code: 'SOURCE_PROTOCOL_ERROR', message: 'Concurrent source invocation' }); return; }
    if (!arrayIsArray(packet.entropy) || packet.entropy.length !== 64 * 1024) { emit({ type: 'response-error', id: packet.id, code: 'SOURCE_PROTOCOL_ERROR', message: 'Invalid entropy pool' }); return; }
    for (let index = 0; index < packet.entropy.length; index++) {
      const byte = packet.entropy[index];
      if (!numberIsInteger(byte) || byte < 0 || byte > 255) { emit({ type: 'response-error', id: packet.id, code: 'SOURCE_PROTOCOL_ERROR', message: 'Invalid entropy pool' }); return; }
    }
    invocationActive = true;
    let entropyPool = packet.entropy;
    let entropyOffset = 0;
    consumeEntropy = size => {
      const length = Number(size);
      if (!numberIsSafeInteger(length) || length < 0 || entropyPool == null || length > entropyPool.length - entropyOffset) return entropyUnavailable();
      const result = new TuneFlowBuffer(length);
      for (let index = 0; index < length; index++) {
        result[index] = entropyPool[entropyOffset + index];
        entropyPool[entropyOffset + index] = 0;
      }
      entropyOffset += length;
      return result;
    };
    const finish = () => {
      if (entropyPool != null) {
        for (let index = 0; index < entropyPool.length; index++) entropyPool[index] = 0;
        entropyPool = null;
      }
      consumeEntropy = entropyUnavailable;
      invocationActive = false;
    };
    const reject = error => {
      const code = typeof error?.code === 'string' ? error.code : 'SOURCE_PROTOCOL_ERROR';
      emit({ type: 'response-error', id: packet.id, code, message: error?.message || String(error) });
    };
    let result;
    try {
      result = apply(requestHandler, tuneflow, [packet.request]);
    } catch (error) {
      try { reject(error); } finally { finish(); }
      return;
    }
    apply(promiseThen, promiseResolve(result), [
      value => { try { emit({ type: 'response', id: packet.id, result: normalizeActionResult(packet.request, value) }); } catch (error) { reject(error); } finally { finish(); } },
      error => { try { reject(error); } finally { finish(); } },
    ]);
  };
  return Object.freeze({ deliver, drain, invoke });
})(${serialize(timerDispatchKey)}, ${serialize(timerDispatchSecret)})
`

const timerHandles = new Map<number, ReturnType<typeof setTimeout>>()
let sourceInitialized = false

let bridge: WorkerBridge
try {
  bridge = new vm.Script(bootstrap, { filename: 'tuneflow-bootstrap.js' }).runInContext(context, { timeout: 2_000 }) as WorkerBridge
  new vm.Script(normalizeSourceRuntimeApi(data.script), { filename: 'tuneflow-source.js' }).runInContext(context, { timeout: 2_000 })
} catch (error) {
  port.postMessage({ type: 'init-error', ...errorInfo(error) })
  throw error
}

const dispatchTimer = (id: number): void => {
  timerHandles.delete(id)
  try {
    const result = new vm.Script(`(() => {
      try {
        globalThis[${serialize(timerDispatchKey)}](${serialize(serialize({ id, secret: timerDispatchSecret }))});
        return ${serialize(serialize({ ok: true }))};
      } catch {
        return ${serialize(serialize({ ok: false, message: 'Source timer callback failed' }))};
      }
    })()`, { filename: 'tuneflow-timer-dispatch.js' })
      .runInContext(context, { timeout: 2_000 })
    const outcome = JSON.parse(String(result)) as { ok?: unknown, message?: unknown }
    if (outcome.ok !== true) throw new Error(typeof outcome.message === 'string' ? outcome.message : 'Source timer callback failed')
    drain()
  } catch (error) {
    port.postMessage({ type: sourceInitialized ? 'timer-error' : 'init-error', ...errorInfo(error) })
  }
}

const drain = (): void => {
  try {
    const messages = JSON.parse(bridge.drain()) as unknown[]
    for (const encoded of messages) {
      const message = JSON.parse(String(encoded)) as { type?: unknown, id?: unknown, delay?: unknown }
      if (message.type === 'timer-schedule') {
        if (!Number.isSafeInteger(message.id) || !Number.isSafeInteger(message.delay) || (message.delay as number) < 0 || (message.delay as number) > 60_000 || timerHandles.has(message.id as number) || timerHandles.size >= 64) throw new Error('Invalid source timer schedule')
        const id = message.id as number
        const handle = setTimeout(() => { dispatchTimer(id) }, message.delay as number)
        timerHandles.set(id, handle)
      } else if (message.type === 'timer-cancel') {
        if (!Number.isSafeInteger(message.id)) throw new Error('Invalid source timer cancellation')
        const id = message.id as number
        const handle = timerHandles.get(id)
        if (handle != null) clearTimeout(handle)
        timerHandles.delete(id)
      } else {
        if (message.type === 'initialized') sourceInitialized = true
        port.postMessage(message)
      }
    }
  } catch (error) {
    port.postMessage({ type: sourceInitialized ? 'timer-error' : 'init-error', ...errorInfo(error) })
  }
}
setInterval(drain, 5)

process.once('exit', () => {
  for (const handle of timerHandles.values()) clearTimeout(handle)
  timerHandles.clear()
})

port.on('message', (message: { type: string, id: number, request?: unknown, entropy?: number[], error?: { code: string, message: string }, response?: unknown, body?: unknown }) => {
  try {
    if (message.type === 'network-response') {
      bridge.deliver(serialize({ id: message.id, error: message.error, response: message.response, body: message.body }))
    } else if (message.type === 'request') {
      bridge.invoke(serialize({ id: message.id, request: message.request, entropy: message.entropy }))
    }
    drain()
  } catch (error) {
    port.postMessage({ type: 'response-error', id: message.id, ...errorInfo(error) })
  }
})

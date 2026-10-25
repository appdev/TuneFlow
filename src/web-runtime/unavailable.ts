export const unavailable = (name = 'Desktop capability'): never => { throw Object.assign(new Error(`${name} 仅在桌面客户端可用`), { code: 'UNSUPPORTED_CAPABILITY' }) }
export const readdir = () => unavailable('本机目录扫描')
export default new Proxy({}, { get: (_target, name) => () => unavailable(String(name)) })

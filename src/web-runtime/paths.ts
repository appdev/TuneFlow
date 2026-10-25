export const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/')
export const normalize = (value: string) => value
export const resolve = join
export const homedir = () => ''
export const extname = (value: string) => /\.[^/.]+$/.exec(value)?.[0] ?? ''
export const basename = (value: string, suffix = '') => value.split('/').pop()?.replace(new RegExp(`${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '') ?? ''
export const dirname = (value: string) => value.split('/').slice(0, -1).join('/')
export default { join, normalize, resolve, homedir, extname, basename, dirname }

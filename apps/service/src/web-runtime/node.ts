export const join = (...parts: string[]): string => parts[0] ? parts.filter(Boolean).join('/').replace(/\/+/g, '/') : ''
export const homedir = (): string => ''

export default { join, homedir }

export interface WebSchedulingGlobal {
  setTimeout: (handler: (...args: any[]) => void, delay?: number, ...args: any[]) => unknown
  setImmediate?: (handler: (...args: any[]) => void, ...args: any[]) => unknown
}

export const installWebSchedulingGlobals = (target: WebSchedulingGlobal): void => {
  target.setImmediate ??= (handler, ...args) => target.setTimeout(handler, 0, ...args)
}

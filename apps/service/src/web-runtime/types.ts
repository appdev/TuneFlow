import type { WebCapabilities } from './capabilities'

export interface ServiceDomainEvent<T = unknown> {
  type: string
  data: T
  sequence: number
}

export interface WebRuntimeEventSnapshot {
  sequence: number
  events: ServiceDomainEvent[]
}

export type WebRuntimeListener<T = unknown> = (payload: { event: null, params: T }) => unknown

export interface WebRuntime {
  readonly capabilities: WebCapabilities
  invoke: <T = unknown>(name: string, params?: unknown) => Promise<T>
  send: (name: string, params?: unknown) => void
  on: <T = unknown>(name: string, listener: WebRuntimeListener<T>) => void
  off: <T = unknown>(name: string, listener: WebRuntimeListener<T>) => void
  offAll: (name: string) => void
  close: () => void
}

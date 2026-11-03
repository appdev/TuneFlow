export interface ServiceDomainEvent<T = unknown> {
  type: string
  data: T
  sequence: number
}

export interface WebRuntimeEventSnapshot {
  sequence: number
  events: ServiceDomainEvent[]
}

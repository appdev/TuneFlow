import type { RuntimeRequest } from './http'
import type { ServiceDomainEvent, WebRuntimeEventSnapshot, WebRuntimeListener } from './types'

interface EventSourceLike {
  onopen: ((event: Event) => void) | null
  addEventListener: (name: string, listener: (event: MessageEvent) => void) => void
  removeEventListener: (name: string, listener: (event: MessageEvent) => void) => void
  close: () => void
}

export type EventSourceConstructor = new(url: string) => EventSourceLike

const decodeParams = (data: unknown): unknown => {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

export class WebEventTransport {
  private readonly listeners = new Map<string, Set<WebRuntimeListener>>()
  private readonly sourceListeners = new Map<string, (event: MessageEvent) => void>()
  private readonly bindings = new Map<string, { domainType: string, select: (data: unknown) => unknown }>()
  private source: EventSourceLike | null = null
  private sourceIdentity: object | null = null
  private opened = false
  private generation = 0
  private reconcilingGeneration: number | null = null
  private queuedEvents: ServiceDomainEvent[] = []

  constructor(
    private readonly request: RuntimeRequest,
    private readonly EventSourceImpl: EventSourceConstructor,
  ) {}

  on<T>(name: string, listener: WebRuntimeListener<T>, domainType = name, select: (data: unknown) => unknown = data => data): void {
    let listeners = this.listeners.get(name)
    if (listeners == null) {
      listeners = new Set()
      this.listeners.set(name, listeners)
      const sourceListener = (event: MessageEvent) => {
        const decoded = decodeParams(event.data) as ServiceDomainEvent
        this.receive(decoded)
      }
      this.sourceListeners.set(name, sourceListener)
      this.bindings.set(name, { domainType, select })
      this.ensureSource().addEventListener(domainType, sourceListener)
    }
    listeners.add(listener as WebRuntimeListener)
  }

  off<T>(name: string, listener: WebRuntimeListener<T>): void {
    const listeners = this.listeners.get(name)
    if (listeners == null) return
    listeners.delete(listener as WebRuntimeListener)
    if (listeners.size !== 0) return
    this.listeners.delete(name)
    const sourceListener = this.sourceListeners.get(name)
    const domainType = this.bindings.get(name)?.domainType ?? name
    if (sourceListener != null) this.source?.removeEventListener(domainType, sourceListener)
    this.sourceListeners.delete(name)
    this.bindings.delete(name)
    if (this.listeners.size === 0) this.close()
  }

  offAll(name: string): void {
    if (!this.listeners.has(name)) return
    this.listeners.delete(name)
    const sourceListener = this.sourceListeners.get(name)
    const domainType = this.bindings.get(name)?.domainType ?? name
    if (sourceListener != null) this.source?.removeEventListener(domainType, sourceListener)
    this.sourceListeners.delete(name)
    this.bindings.delete(name)
    if (this.listeners.size === 0) this.close()
  }

  close(): void {
    this.sourceIdentity = null
    if (this.source != null) {
      for (const [name, listener] of this.sourceListeners) this.source.removeEventListener(this.bindings.get(name)?.domainType ?? name, listener)
      this.source.close()
    }
    this.source = null
    this.opened = false
    this.generation = 0
    this.reconcilingGeneration = null
    this.queuedEvents = []
    this.listeners.clear()
    this.sourceListeners.clear()
    this.bindings.clear()
  }

  private ensureSource(): EventSourceLike {
    if (this.source != null) return this.source
    const sourceIdentity = {}
    const source = new this.EventSourceImpl('/api/v1/events')
    this.sourceIdentity = sourceIdentity
    source.onopen = () => {
      if (sourceIdentity !== this.sourceIdentity) return
      const generation = ++this.generation
      if (!this.opened) {
        this.opened = true
        return
      }
      this.reconcilingGeneration = generation
      void this.restoreSnapshot(sourceIdentity, generation).catch(error => {
        console.error(error)
      })
    }
    this.source = source
    return source
  }

  private dispatch(name: string, params: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener({ event: null, params })
  }

  private dispatchDomain(event: ServiceDomainEvent): void {
    for (const [name, binding] of this.bindings) {
      if (binding.domainType === event.type) this.dispatch(name, binding.select(event.data))
    }
  }

  private receive(event: ServiceDomainEvent): void {
    if (this.reconcilingGeneration === this.generation) {
      this.queuedEvents.push(event)
      return
    }
    this.dispatchDomain(event)
  }

  private async restoreSnapshot(sourceIdentity: object, generation: number): Promise<void> {
    try {
      const snapshot = await this.request<WebRuntimeEventSnapshot>('GET', '/api/v1/events/snapshot')
      if (sourceIdentity !== this.sourceIdentity || generation !== this.generation) return
      for (const event of snapshot.events) this.dispatchDomain(event)
    } finally {
      if (sourceIdentity === this.sourceIdentity && generation === this.generation) {
        const queuedEvents = this.queuedEvents
        this.queuedEvents = []
        this.reconcilingGeneration = null
        for (const event of queuedEvents) this.dispatchDomain(event)
      }
    }
  }
}

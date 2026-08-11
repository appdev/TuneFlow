import { Type } from '@fastify/type-provider-typebox'
import type { ServiceDomainEvent, WebRuntimeEventSnapshot } from '../../web-runtime/types'
import { projectBrowserDto } from '../playback/browserDto'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'

interface EventClient {
  write: (chunk: string) => unknown
  end: () => unknown
}

export class ServiceEvents {
  private readonly clients = new Set<EventClient>()
  private readonly snapshotEvents = new Map<string, ServiceDomainEvent>()
  private sequence = 0

  get clientCount(): number {
    return this.clients.size
  }

  subscribe(client: EventClient): () => void {
    this.clients.add(client)
    return () => {
      this.clients.delete(client)
    }
  }

  publish(type: string, data: unknown): ServiceDomainEvent {
    const event = { type, data: projectBrowserDto(data), sequence: ++this.sequence }
    const message = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`
    for (const client of this.clients) client.write(message)
    return event
  }

  publishSnapshot(type: string, data: unknown): ServiceDomainEvent {
    const event = this.publish(type, data)
    this.snapshotEvents.set(type, event)
    return event
  }

  snapshot(): WebRuntimeEventSnapshot {
    return { sequence: this.sequence, events: [...this.snapshotEvents.values()] }
  }

  close(): void {
    for (const client of this.clients) client.end()
    this.clients.clear()
  }
}

export const registerEventRoutes = (app: ApiFastifyInstance, events: ServiceEvents): void => {
  const event = Type.Object({ type: Type.String(), data: Type.Unknown(), sequence: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
  app.get('/api/v1/events/snapshot', {
    schema: {
      operationId: 'getEventSnapshot',
      tags: ['Events'],
      summary: 'Get recoverable event state',
      response: { 200: ApiSuccess(Type.Object({ sequence: Type.Integer({ minimum: 0 }), events: Type.Array(event) }, { additionalProperties: false })), ...ErrorResponses },
    },
  }, async() => ({ data: events.snapshot() }))
  app.get('/api/v1/events', {
    schema: {
      operationId: 'streamEvents', tags: ['Events'], summary: 'Subscribe to domain events',
    },
  }, async(request, reply) => {
    void reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    reply.raw.write(': connected\n\n')
    const unsubscribe = events.subscribe(reply.raw)
    request.raw.once('close', unsubscribe)
    reply.raw.once('close', unsubscribe)
    return reply
  })
}

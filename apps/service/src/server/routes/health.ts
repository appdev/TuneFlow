import { Type } from '@fastify/type-provider-typebox'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess } from '../api/schemas/common'

const ServiceCapabilitiesSchema = Type.Object({
  runtime: Type.Literal('service'),
  apiVersion: Type.Literal('v1'),
  features: Type.Object({
    settings: Type.Boolean(),
    clientData: Type.Boolean(),
    playlists: Type.Boolean(),
    events: Type.Boolean(),
    sources: Type.Boolean(),
    catalog: Type.Boolean(),
    playback: Type.Boolean(),
    downloads: Type.Boolean(),
    library: Type.Boolean(),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

const ServiceHealthSchema = Type.Object({
  status: Type.Literal('ok'),
  lanOrigin: Type.String(),
  externalOrigin: Type.String(),
}, { additionalProperties: false })

export const registerHealthRoutes = (
  app: ApiFastifyInstance,
  readSettings: () => TuneFlow.AppSetting,
): void => {
  app.get('/api/v1/health', {
    schema: {
      operationId: 'getHealth',
      tags: ['System'],
      summary: 'Get Service health',
      response: { 200: ApiSuccess(ServiceHealthSchema) },
    },
  }, async() => {
    const settings = readSettings()
    return {
      data: {
        status: 'ok' as const,
        lanOrigin: settings['service.lanOrigin'],
        externalOrigin: settings['service.externalOrigin'],
      },
    }
  })
  app.get('/api/v1/capabilities', {
    schema: {
      operationId: 'getCapabilities',
      tags: ['System'],
      summary: 'Get Service capabilities',
      response: { 200: ApiSuccess(ServiceCapabilitiesSchema) },
    },
  }, async() => ({
    data: {
      runtime: 'service' as const,
      apiVersion: 'v1' as const,
      features: { settings: true, clientData: true, playlists: true, events: true, sources: true, catalog: true, playback: true, downloads: true, library: true },
    },
  }))
}

import { Type } from '@fastify/type-provider-typebox'
import type { AppDataRepository } from '../db/appDataRepository'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'

const KeyParams = Type.Object({ key: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false })

export const registerRuntimeRoutes = (app: ApiFastifyInstance, appData: AppDataRepository): void => {
  app.get('/api/v1/runtime', {
    schema: {
      operationId: 'getRuntime',
      tags: ['System'],
      summary: 'Get runtime environment',
      response: { 200: ApiSuccess(Type.Object({ cmdParams: Type.Record(Type.String(), Type.Unknown()), deeplink: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false })) },
    },
  }, async() => ({ data: { cmdParams: {}, deeplink: null } }))

  app.get('/api/v1/client-data/:key', {
    schema: {
      operationId: 'getClientData',
      tags: ['Client Data'],
      summary: 'Get an opaque client-state value',
      params: KeyParams,
      response: { 200: ApiSuccess(Type.Union([Type.Unknown(), Type.Null()])), ...ErrorResponses },
    },
  }, async(request) => {
    const { key } = request.params
    return { data: appData.get(key) ?? null }
  })

  app.put('/api/v1/client-data/:key', {
    schema: {
      operationId: 'putClientData',
      tags: ['Client Data'],
      summary: 'Replace an opaque client-state value',
      params: KeyParams,
      body: Type.Object({ value: Type.Unknown() }, { additionalProperties: false }),
      response: { 200: ApiSuccess(Type.Unknown()), ...ErrorResponses },
    },
  }, async(request) => {
    const { key } = request.params
    const body = request.body
    appData.set(key, body.value)
    return { data: body.value }
  })
}

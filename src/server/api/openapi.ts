import swagger from '@fastify/swagger'
import { Type } from '@fastify/type-provider-typebox'
import type { ApiFastifyInstance } from './types'

export const registerOpenApi = async(app: ApiFastifyInstance): Promise<void> => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'LX Music Service API',
        description: 'Private single-user LX Music Service API.',
        version: '1.0.0',
      },
    },
    transform: ({ schema, url, route }) => {
      const method = (Array.isArray(route.method) ? route.method[0] : route.method).toLowerCase()
      const generatedId = `${method}${url
        .split('/')
        .filter(Boolean)
        .map(part => part.replace(/^:/, ' by ').replace(/[^a-zA-Z0-9]+/g, ' '))
        .flatMap(part => part.trim().split(/\s+/))
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')}`
      return { schema: { operationId: generatedId, ...schema }, url }
    },
  })

  app.get('/openapi.json', {
    schema: {
      operationId: 'getOpenApiDocument',
      tags: ['Contract'],
      summary: 'Get the generated OpenAPI document',
      response: { 200: Type.Unknown() },
    },
  }, async() => app.swagger())
}

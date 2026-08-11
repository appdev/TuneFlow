import { Type, type TSchema } from '@fastify/type-provider-typebox'

export const ApiSuccess = <T extends TSchema>(data: T) => Type.Object({ data }, { additionalProperties: false })

export const ApiErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }, { additionalProperties: false }),
}, { additionalProperties: false, $id: 'ApiError' })

export const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
  502: ApiErrorSchema,
} as const

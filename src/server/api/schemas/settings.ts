import { Type, type TSchema } from '@fastify/type-provider-typebox'
import defaultSetting from '../../../common/defaultSetting'

const valueSchema = (value: unknown): TSchema => {
  if (value === null) return Type.Union([Type.Null(), Type.String(), Type.Number(), Type.Boolean()])
  if (typeof value === 'string') return Type.String()
  if (typeof value === 'number') return Type.Number()
  if (typeof value === 'boolean') return Type.Boolean()
  if (Array.isArray(value)) return Type.Array(Type.Unknown())
  if (typeof value === 'object') return Type.Record(Type.String(), Type.Unknown())
  return Type.Unknown()
}

const properties = Object.fromEntries(Object.entries(defaultSetting).map(([key, value]) => [key, valueSchema(value)]))

export const SettingsSchema = Type.Object(properties, { additionalProperties: false, $id: 'Settings' })
export const SettingsPatchSchema = Type.Partial(SettingsSchema, { additionalProperties: false, $id: 'SettingsPatch' })

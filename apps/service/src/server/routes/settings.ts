import type { SettingsRepository } from '../db/settingsRepository'
import type { ServiceEvents } from './events'
import { setRendererUtilsLanguage } from '../tuneFlowSdk/rendererUtilsShim'
import type { ApiFastifyInstance } from '../api/types'
import { ApiSuccess, ErrorResponses } from '../api/schemas/common'
import { SettingsPatchSchema, SettingsSchema } from '../api/schemas/settings'

export const registerSettingsRoutes = (app: ApiFastifyInstance, settings: SettingsRepository, events?: ServiceEvents): void => {
  app.get('/api/v1/settings', {
    schema: {
      operationId: 'getSettings', tags: ['Settings'], summary: 'Get Service settings', response: { 200: ApiSuccess(SettingsSchema), ...ErrorResponses },
    },
  }, async() => ({ data: settings.getSettings() }))
  app.patch('/api/v1/settings', {
    schema: {
      operationId: 'patchSettings',
      tags: ['Settings'],
      summary: 'Update Service settings',
      body: SettingsPatchSchema,
      response: { 200: ApiSuccess(SettingsSchema), ...ErrorResponses },
    },
  }, async(request) => {
    const patch = request.body as Record<string, unknown>
    const updated = settings.updateSettings(patch)
    if (Object.prototype.hasOwnProperty.call(patch, 'common.langId')) setRendererUtilsLanguage(updated['common.langId'])
    const effectivePatch = Object.fromEntries(Object.keys(patch).map(key => [key, updated[key as keyof TuneFlow.AppSetting]]))
    events?.publish('settings.updated', effectivePatch)
    return { data: updated }
  })
}

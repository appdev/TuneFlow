import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import fastifyStatic from '@fastify/static'
import { close as closeDatabase, init as initDatabase } from './db/core/db'
import { getAudioRoot, normalizeServerOptions, type ServerOptions } from './config'
import { AppDataRepository } from './db/appDataRepository'
import { SettingsRepository } from './db/settingsRepository'
import { ApiError, type ApiErrorBody } from './errors'
import { registerHealthRoutes } from './routes/health'
import { registerListRoutes } from './routes/lists'
import { registerSettingsRoutes } from './routes/settings'
import { registerRuntimeRoutes } from './routes/runtime'
import { registerEventRoutes, ServiceEvents } from './routes/events'
import { SourceRepository } from './sources/repository'
import { registerSourceRoutes, SourcesService } from './routes/sources'
import { registerCatalogRoutes } from './routes/catalog'
import { registerPlaybackRoutes } from './routes/playback'
import { registerPlaybackHistoryRoutes } from './routes/playbackHistory'
import { setRendererUtilsLanguage } from './tuneFlowSdk/rendererUtilsShim'
import { getLyric, getPicture } from './tuneFlowSdk'
import { projectBrowserDto } from './playback/browserDto'
import { LibraryScanner } from './library/scanner'
import { registerLibraryRoutes } from './routes/library'
import { DownloadManager } from './downloads/manager'
import { registerDownloadRoutes } from './routes/downloads'
import { applyDownloadMetadata } from './downloads/metadata'
import { resolveSourceMusicUrl } from './playback/resolver'
import { getAllUserList } from './db/lists'
import { LIST_IDS } from '../common/constants'
import { registerOpenApi } from './api/openapi'
import { PlaybackHistoryRepository } from './playback/historyRepository'

export type { ServerOptions } from './config'

export const createServer = async(options: ServerOptions): Promise<FastifyInstance> => {
  const serverOptions = normalizeServerOptions(options)
  if (initDatabase(serverOptions.storageRoot) == null) throw new Error('Unable to initialize TuneFlow database')

  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } }).withTypeProvider<TypeBoxTypeProvider>()
  await registerOpenApi(app)
  const settings = new SettingsRepository(serverOptions.storageRoot)
  setRendererUtilsLanguage(settings.getSettings()['common.langId'])
  const appData = new AppDataRepository()
  const playbackHistory = new PlaybackHistoryRepository()
  const events = new ServiceEvents()
  const sources = new SourcesService(new SourceRepository(serverOptions.storageRoot), alert => {
    events.publish('sources.update-available', alert)
  })
  const library = new LibraryScanner(serverOptions.storageRoot, () => [getAudioRoot(serverOptions.storageRoot)])
  await library.refresh()
  const downloads = new DownloadManager({
    storageRoot: serverOptions.storageRoot,
    getSettings: () => settings.getSettings(),
    findExistingFile: async musicInfo => (await library.findMatchingFile(musicInfo))?.filePath,
    resolveListName: listId => ({
      [LIST_IDS.DEFAULT]: 'Default',
      [LIST_IDS.LOVE]: 'Loved',
      [LIST_IDS.TEMP]: 'Temporary',
      [LIST_IDS.DOWNLOAD]: 'Downloads',
    })[listId] ?? getAllUserList().find(list => list.id === listId)?.name,
    resolve: async(job, signal) => {
      const source = sources.list().find(item => item.active)
      if (source == null) throw new ApiError(409, 'SOURCE_NOT_FOUND', 'No active source')
      const value = await resolveSourceMusicUrl(sources, source.id, {
        source: job.musicInfo.source,
        quality: job.quality,
        info: { type: job.quality, musicInfo: job.musicInfo },
      }, undefined, signal)
      if (typeof value.url !== 'string' || value.url.length === 0) throw new ApiError(502, 'SOURCE_PROTOCOL_ERROR', 'Download source returned no URL')
      const headers = Object.fromEntries(Object.entries(value.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      return { url: value.url, headers }
    },
    metadata: async(filePath, job, currentSettings) => applyDownloadMetadata(filePath, job, currentSettings, {
      getPicture: async musicInfo => getPicture(musicInfo.source, musicInfo).catch(() => musicInfo.meta.picUrl ?? null),
      getLyrics: async musicInfo => getLyric(musicInfo.source, musicInfo).catch(() => null),
    }),
    publish: jobs => {
      events.publishSnapshot('downloads.updated', jobs)
    },
    onCompleted: async() => library.refresh(),
  })

  app.setErrorHandler((error, _request, reply) => {
    const validation = typeof error === 'object' && error != null && 'validation' in error && Array.isArray(error.validation)
      ? error.validation as Array<{ instancePath?: string, schemaPath?: string, message?: string }>
      : null
    const apiError = validation != null
      ? new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', validation.map(item => ({
        instancePath: item.instancePath,
        schemaPath: item.schemaPath,
        message: item.message,
      })))
      : error instanceof ApiError
        ? error
        : new ApiError(500, 'INTERNAL_ERROR', 'Internal server error')
    void reply.code(apiError.statusCode).send(apiError.toBody() satisfies ApiErrorBody)
  })
  app.addHook('onSend', async(request, _reply, payload) => {
    if (!request.url.startsWith('/api/v1/playlists') || typeof payload !== 'string') return payload
    try {
      return JSON.stringify(projectBrowserDto(JSON.parse(payload)))
    } catch { return payload }
  })
  app.addHook('onClose', async() => {
    downloads.close()
    await sources.close()
    events.close()
    closeDatabase()
  })

  registerHealthRoutes(app)
  registerSettingsRoutes(app, settings, events)
  registerRuntimeRoutes(app, appData)
  registerListRoutes(app, events)
  registerEventRoutes(app, events)
  registerSourceRoutes(app, sources, events)
  registerCatalogRoutes(app, sources)
  registerPlaybackRoutes(app, {
    sources,
    findLocalTrack: async musicInfo => (await library.findMatchingFile(musicInfo))?.track.streamUrl,
    // Test fixtures are local by design; production never relaxes the SSRF boundary.
    allowPrivateNetwork: process.env.NODE_ENV === 'test' && process.env.TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS === '1',
  })
  registerPlaybackHistoryRoutes(app, playbackHistory)
  registerDownloadRoutes(app, downloads)
  registerLibraryRoutes(app, library)
  app.all('/api/v1', { schema: { hide: true } }, async() => {
    throw new ApiError(404, 'NOT_FOUND', 'API route not found')
  })
  app.all('/api/v1/', { schema: { hide: true } }, async() => {
    throw new ApiError(404, 'NOT_FOUND', 'API route not found')
  })
  app.all('/api/v1/*', { schema: { hide: true } }, async() => {
    throw new ApiError(404, 'NOT_FOUND', 'API route not found')
  })

  await app.register(fastifyStatic, { root: serverOptions.webRoot, serve: false })
  app.get('/*', { schema: { hide: true } }, async(request, reply) => {
    const pathname = new URL(request.raw.url ?? '/', 'http://localhost').pathname
    const filePath = path.resolve(serverOptions.webRoot, `.${pathname}`)
    if (filePath.startsWith(`${serverOptions.webRoot}${path.sep}`) && existsSync(filePath) && statSync(filePath).isFile()) {
      return reply.sendFile(path.relative(serverOptions.webRoot, filePath))
    }
    return reply.sendFile('index.html')
  })
  return app
}

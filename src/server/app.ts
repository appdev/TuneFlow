import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import fastifyStatic from '@fastify/static'
import { close as closeDatabase, init as initDatabase } from './db/core/db'
import { normalizeServerOptions, type ServerOptionsInput } from './config'
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
import { findAlternativeMusic, getLyric, getPicture } from './tuneFlowSdk'
import { projectBrowserDto } from './playback/browserDto'
import { LibraryScanner } from './library/scanner'
import { LibraryResourceStore } from './library/resources'
import { registerLibraryRoutes } from './routes/library'
import { DownloadManager } from './downloads/manager'
import type { DownloadFileIntegrity } from './downloads/types'
import { registerDownloadRoutes } from './routes/downloads'
import { applyDownloadMetadata } from './downloads/metadata'
import { getAllUserList } from './db/lists'
import { LIST_IDS } from '../common/constants'
import { registerOpenApi } from './api/openapi'
import { PlaybackHistoryRepository } from './playback/historyRepository'
import { MediaClient } from './playback/mediaClient'
import { PlaybackResourceStore } from './playback/resourceStore'
import { PlaybackBundleResolver } from './playback/bundleResolver'
import { TrackResourceService } from './resources/trackResources'
import { LibraryMetadataEnricher } from './library/metadataEnricher'
import { TrackResourceCoordinator } from './resources/trackResourceCoordinator'

export type { ServerOptions, ServerOptionsInput } from './config'

export const createServer = async(options: ServerOptionsInput): Promise<FastifyInstance> => {
  const serverOptions = normalizeServerOptions(options)
  const { storage } = serverOptions
  if (initDatabase(storage.databaseRoot) == null) throw new Error('Unable to initialize TuneFlow database')

  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } }).withTypeProvider<TypeBoxTypeProvider>()
  await registerOpenApi(app)
  const settings = new SettingsRepository(storage.mediaRoot)
  setRendererUtilsLanguage(settings.getSettings()['common.langId'])
  const appData = new AppDataRepository()
  const playbackHistory = new PlaybackHistoryRepository()
  const events = new ServiceEvents()
  const sources = new SourcesService(new SourceRepository({ sourceRoot: storage.sourceRoot }), alert => {
    events.publish('sources.update-available', alert)
  }, {
    // Test fixtures are local by design; production never relaxes the source-import SSRF boundary.
    allowPrivateNetwork: process.env.NODE_ENV === 'test' && process.env.TUNEFLOW_TEST_ALLOW_PRIVATE_SOURCE_TARGETS === '1',
  })
  let integrityLookup: (filePath: string) => DownloadFileIntegrity | undefined = () => undefined
  let downloadedAtLookup: (filePath: string) => number | undefined = () => undefined
  const libraryResources = new LibraryResourceStore({
    mediaRoot: storage.mediaRoot,
    ...storage.libraryResources,
    tempRoot: storage.tempRoot,
  })
  const library = new LibraryScanner(
    storage.mediaRoot,
    () => [storage.mediaRoot],
    filePath => integrityLookup(filePath),
    libraryResources,
    filePath => downloadedAtLookup(filePath),
    storage.mediaIdentityPrefix,
  )
  await library.refresh()
  const allowPrivatePlaybackTargets = process.env.NODE_ENV === 'test' && process.env.TUNEFLOW_TEST_ALLOW_PRIVATE_PLAYBACK_TARGETS === '1'
  const mediaClient = new MediaClient({ allowPrivateNetwork: allowPrivatePlaybackTargets })
  const playbackResources = new PlaybackResourceStore()
  const trackResources = new TrackResourceService({
    sources,
    mediaClient,
    readLocal: async musicInfo => await library.readMatchingResources(musicInfo),
    findAlternatives: findAlternativeMusic,
    getBuiltinLyrics: async(provider, musicInfo) => await getLyric(provider, musicInfo),
    getBuiltinPicture: async(provider, musicInfo) => await getPicture(provider, musicInfo),
  })
  let resourceCoordinator: TrackResourceCoordinator | undefined
  const findLocalPlayback = async(musicInfo: unknown) => {
    const match = await library.findMatchingFile(musicInfo)
    return match == null
      ? undefined
      : {
          streamUrl: match.track.streamUrl,
          pictureUrl: match.track.pictureUrl,
          lyricsUrl: match.track.lyricsUrl,
        }
  }
  const bundleResolver = new PlaybackBundleResolver({
    sources,
    mediaClient,
    resourceStore: playbackResources,
    findLocal: findLocalPlayback,
    findAlternatives: findAlternativeMusic,
    getBuiltinLyrics: async(provider, musicInfo) => await getLyric(provider, musicInfo),
    getBuiltinPicture: async(provider, musicInfo) => await getPicture(provider, musicInfo),
    onResourcesAvailable: (provider, musicInfo, resources) => {
      const pictureToken = /^\/api\/v1\/playback\/resources\/([a-f0-9]{64})\/picture$/.exec(resources.pictureUrl ?? '')?.[1]
      const picture = pictureToken == null ? undefined : playbackResources.getPicture(pictureToken)
      trackResources.remember(provider, musicInfo, {
        ...(resources.lyrics == null ? {} : { lyrics: resources.lyrics }),
        ...(picture == null ? {} : { picture: { bytes: picture.bytes, mimeType: picture.mimeType } }),
      })
      const missing = new Set<'lyrics' | 'picture'>([
        ...(resources.lyrics == null && resources.lyricsUrl == null ? ['lyrics' as const] : []),
        ...(resources.pictureUrl == null ? ['picture' as const] : []),
      ])
      resourceCoordinator?.resolveMissingForPlayback(provider, musicInfo, missing)
    },
    onAttempt: attempt => { app.log.info({ sourceAttempt: attempt }) },
  })
  const downloads = new DownloadManager({
    mediaClient,
    roots: {
      mode: storage.mode,
      databaseRoot: storage.databaseRoot,
      mediaRoot: storage.mediaRoot,
      tempRoot: storage.tempRoot,
    },
    getSettings: () => settings.getSettings(),
    findExistingFile: async musicInfo => (await library.findMatchingFile(musicInfo))?.filePath,
    resolveListName: listId => ({
      [LIST_IDS.DEFAULT]: 'Default',
      [LIST_IDS.LOVE]: 'Loved',
      [LIST_IDS.TEMP]: 'Temporary',
      [LIST_IDS.DOWNLOAD]: 'Downloads',
    })[listId] ?? getAllUserList().find(list => list.id === listId)?.name,
    resolve: async(job, signal) => {
      const bundle = await bundleResolver.resolve({
        source: job.musicInfo.source,
        quality: job.quality,
        info: { type: job.quality, musicInfo: job.musicInfo },
        preferLocal: false,
      }, signal)
      const resourcesFor = (resources: typeof bundle.resources) => {
        const pictureToken = /^\/api\/v1\/playback\/resources\/([a-f0-9]{64})\/picture$/.exec(resources.pictureUrl ?? '')?.[1]
        const picture = pictureToken == null ? undefined : playbackResources.getPicture(pictureToken)
        return {
          ...(picture == null ? {} : { pictureBytes: picture.bytes, pictureMimeType: picture.mimeType }),
          ...(resources.lyrics == null ? {} : { lyrics: resources.lyrics }),
        }
      }
      const resolvedResources = resourcesFor(bundle.resources)
      const currentSettings = settings.getSettings()
      const missingResources = new Set<'lyrics' | 'picture'>([
        ...((currentSettings['download.isEmbedLyric'] || currentSettings['download.isDownloadLrc']) && resolvedResources.lyrics == null
          ? ['lyrics' as const]
          : []),
        ...(currentSettings['download.isEmbedPic'] && resolvedResources.pictureBytes == null
          ? ['picture' as const]
          : []),
      ])
      resourceCoordinator?.resolveMissingForDownload(job.musicInfo.source, job.musicInfo, missingResources, signal)
      return {
        candidates: bundle.downloadCandidates?.map(candidate => ({
          sourceId: candidate.sourceId,
          url: candidate.url,
          headers: candidate.headers,
          resources: resourcesFor(candidate.resources ?? {}),
          completeness: candidate.completeness,
          sourceIds: candidate.sourceIds,
        })) ?? bundle.streamCandidates,
        resources: resolvedResources,
      }
    },
    metadata: async(filePath, job, currentSettings, resources, lyricFilePath) => await applyDownloadMetadata(filePath, job, currentSettings, {
      ...resources,
      lyricFilePath,
    }),
    materializeResources: async filePath => { await libraryResources.ensure(filePath) },
    publish: jobs => {
      events.publishSnapshot('downloads.updated', jobs)
    },
    onCompleted: async(filePath, job) => {
      if (resourceCoordinator == null) await library.refresh()
      else await resourceCoordinator.onDownloadCompleted(filePath, job)
    },
  })
  const metadataEnricher = new LibraryMetadataEnricher(storage.mediaRoot, {
    publish: input => downloads.publishMetadataPatch(input),
  })
  resourceCoordinator = new TrackResourceCoordinator({
    downloads,
    library,
    libraryResources,
    enricher: metadataEnricher,
    resources: trackResources,
    getSettings: () => settings.getSettings(),
    getCached: identity => trackResources.cached(identity),
    publishEvent: (type, data) => events.publish(type, data),
    publishLibrary: tracks => events.publishSnapshot('library.updated', tracks),
    onError: error => { app.log.error({ error }, 'Track resource backfill failed') },
  })
  const unsubscribeTrackResources = trackResources.subscribe(event => { resourceCoordinator?.accept(event) })
  integrityLookup = filePath => downloads.expectedIntegrity(filePath)
  downloadedAtLookup = filePath => downloads.completedAt(filePath)
  await library.refresh()

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
    unsubscribeTrackResources()
    resourceCoordinator?.close()
    await resourceCoordinator?.waitForIdle()
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
  registerCatalogRoutes(app, sources, { mediaClient, resourceStore: playbackResources, trackResources })
  registerPlaybackRoutes(app, {
    sources,
    findLocalTrack: async musicInfo => (await library.findMatchingFile(musicInfo))?.track.streamUrl,
    bundleResolver,
    mediaClient,
    resourceStore: playbackResources,
    // Test fixtures are local by design; production never relaxes the SSRF boundary.
    allowPrivateNetwork: allowPrivatePlaybackTargets,
  })
  registerPlaybackHistoryRoutes(app, {
    history: playbackHistory,
    onStarted: async session => {
      if (!settings.getSettings()['player.autoDownloadOnPlay'] || session.track.source === 'local') return
      const meta = typeof session.track.meta === 'object' && session.track.meta != null
        ? session.track.meta as Record<string, unknown>
        : {}
      const musicInfo: TuneFlow.Music.MusicInfoOnline = {
        ...session.track,
        source: session.track.source as TuneFlow.OnlineSource,
        name: typeof session.track.name === 'string' ? session.track.name : session.track.id,
        singer: typeof session.track.singer === 'string' ? session.track.singer : '',
        interval: typeof session.track.interval === 'string' ? session.track.interval : null,
        meta: {
          ...meta,
          songId: typeof meta.songId === 'string' || typeof meta.songId === 'number' ? meta.songId : session.track.id,
          albumName: typeof meta.albumName === 'string' ? meta.albumName : '',
          qualitys: Array.isArray(meta.qualitys) ? meta.qualitys as TuneFlow.Music.MusicQualityType[] : [],
          _qualitys: typeof meta._qualitys === 'object' && meta._qualitys != null ? meta._qualitys as TuneFlow.Music._MusicQualityType : {},
        },
      }
      await downloads.createForPlayback(musicInfo)
    },
  })
  registerDownloadRoutes(app, downloads)
  registerLibraryRoutes(app, library, {
    onDeleted: filePath => { downloads.removeCompletedForFile(filePath) },
    publish: tracks => { events.publishSnapshot('library.updated', tracks) },
  })
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

import type { DownloadManager } from '../downloads/manager'
import type { DownloadJobRecord, ResolvedDownload } from '../downloads/types'
import type { LibraryMetadataEnricher } from '../library/metadataEnricher'
import type { LibraryResourceStore } from '../library/resources'
import type { LibraryScanner, LibraryTrackDto } from '../library/scanner'
import { trackResourceIdentity, type TrackResourceIdentity, type TrackResourceService, type TrackResourcesAvailable, type ValidatedTrackResources } from './trackResources'

interface TrackResourceCoordinatorOptions {
  downloads: Pick<DownloadManager, 'attachResolvedResources' | 'publishMetadataPatch'>
  library: Pick<LibraryScanner, 'findMatchingFile' | 'refresh'>
  libraryResources: Pick<LibraryResourceStore, 'invalidate' | 'ensure'>
  enricher: Pick<LibraryMetadataEnricher, 'enrich'>
  resources?: Pick<TrackResourceService, 'resolveLyrics' | 'resolvePicture'>
  getSettings: () => TuneFlow.AppSetting
  getCached?: (identity: TrackResourceIdentity) => ValidatedTrackResources | undefined
  publishEvent: (type: string, data: unknown) => unknown
  publishLibrary: (tracks: LibraryTrackDto[]) => unknown
  onError?: (error: unknown) => void
}

const downloadResources = (resources: ValidatedTrackResources): NonNullable<ResolvedDownload['resources']> => ({
  ...(resources.lyrics == null ? {} : { lyrics: resources.lyrics }),
  ...(resources.picture == null ? {} : {
    pictureBytes: resources.picture.bytes,
    pictureMimeType: resources.picture.mimeType,
  }),
})

export class TrackResourceCoordinator {
  private readonly pending = new Set<Promise<void>>()
  private readonly targetTails = new Map<string, Promise<void>>()
  private closed = false

  constructor(private readonly options: TrackResourceCoordinatorOptions) {}

  resolveMissingForDownload(
    source: string,
    musicInfo: TuneFlow.Music.MusicInfoOnline,
    missing: ReadonlySet<'lyrics' | 'picture'>,
    signal?: AbortSignal,
  ): void {
    if (this.closed || this.options.resources == null) return
    if (missing.has('lyrics')) this.track(this.options.resources.resolveLyrics(source, musicInfo, signal).then(() => {}))
    if (missing.has('picture')) this.track(this.options.resources.resolvePicture(source, musicInfo, signal).then(() => {}))
  }

  resolveMissingForPlayback(
    source: string,
    musicInfo: unknown,
    missing: ReadonlySet<'lyrics' | 'picture'>,
  ): void {
    if (this.closed || this.options.resources == null) return
    if (missing.has('lyrics')) this.track(this.options.resources.resolveLyrics(source, musicInfo).then(() => {}))
    if (missing.has('picture')) this.track(this.options.resources.resolvePicture(source, musicInfo).then(() => {}))
  }

  accept(event: TrackResourcesAvailable): void {
    if (this.closed) return
    this.options.downloads.attachResolvedResources(
      event.musicInfo as TuneFlow.Music.MusicInfoOnline,
      downloadResources(event.resources),
    )
    this.options.publishEvent('track.resources.updated', {
      source: event.identity.source,
      trackId: event.identity.trackId,
      resources: [
        ...(event.resources.lyrics == null ? [] : ['lyrics']),
        ...(event.resources.picture == null ? [] : ['picture']),
      ],
    })
    this.track(this.backfillMatching(event))
  }

  async onDownloadCompleted(filePath: string, job: DownloadJobRecord): Promise<void> {
    const identity = trackResourceIdentity(job.musicInfo.source, job.musicInfo)
    const resources = this.options.getCached?.(identity)
    await this.enqueue(filePath, async() => {
      if (resources != null) await this.options.enricher.enrich(filePath, resources, this.options.getSettings())
      this.options.libraryResources.invalidate(filePath)
      await this.options.libraryResources.ensure(filePath)
      const tracks = await this.options.library.refresh()
      this.options.publishLibrary(tracks)
    })
  }

  async waitForIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }

  close(): void { this.closed = true }

  private async backfillMatching(event: TrackResourcesAvailable): Promise<void> {
    const match = await this.options.library.findMatchingFile(event.musicInfo)
    if (match == null) return
    await this.enqueue(match.filePath, async() => {
      const result = await this.options.enricher.enrich(match.filePath, event.resources, this.options.getSettings())
      if (result.changed.length === 0) return
      this.options.libraryResources.invalidate(match.filePath)
      await this.options.libraryResources.ensure(match.filePath)
      const tracks = await this.options.library.refresh()
      this.options.publishLibrary(tracks)
    })
  }

  private async enqueue(filePath: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.targetTails.get(filePath) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.targetTails.set(filePath, current)
    try {
      await current
    } finally {
      if (this.targetTails.get(filePath) === current) this.targetTails.delete(filePath)
    }
  }

  private track(operation: Promise<void>): void {
    const guarded = operation.catch(error => { this.options.onError?.(error) })
    this.pending.add(guarded)
    void guarded.finally(() => { this.pending.delete(guarded) })
  }
}

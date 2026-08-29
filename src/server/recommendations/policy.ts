export interface RecommendationPolicy {
  algorithmVersion: 'recommendation-v1'
  targetSize: 30
  newTarget: 21
  familiarTarget: 9
  artistLimit: 2
  albumLimit: 2
  neighborLimit: 200
  rawSnapshotRetentionDays: 90
  playlistExpiryDays: 30
  playlistRefreshDays: 7
  implicitHalfLifeDays: 30
  bootstrapPlaylistsPerSource: 50
  dailyRefreshPlaylistsPerSource: 10
  maxTracksPerPlaylist: 100
  explorationRatio: 0.2
  minimumPublishSize: 10
  playbackSignals: Readonly<{
    completed: 1.5
    listenedAtLeast80Percent: 1
    listenedAtLeast50Percent: 0.4
    partialListen: -0.25
    lowCompletion: -0.5
    earlySkip: -1.5
    earlySkipMaxPositionSeconds: 30
    earlySkipMaxRatio: 0.25
    maxImplicitTrackScore: 8
    maxImplicitArtistScore: 16
  }>
}

export const recommendationPolicy: Readonly<RecommendationPolicy> = Object.freeze({
  algorithmVersion: 'recommendation-v1',
  targetSize: 30,
  newTarget: 21,
  familiarTarget: 9,
  artistLimit: 2,
  albumLimit: 2,
  neighborLimit: 200,
  rawSnapshotRetentionDays: 90,
  playlistExpiryDays: 30,
  playlistRefreshDays: 7,
  implicitHalfLifeDays: 30,
  bootstrapPlaylistsPerSource: 50,
  dailyRefreshPlaylistsPerSource: 10,
  maxTracksPerPlaylist: 100,
  explorationRatio: 0.2,
  minimumPublishSize: 10,
  playbackSignals: Object.freeze({
    completed: 1.5,
    listenedAtLeast80Percent: 1,
    listenedAtLeast50Percent: 0.4,
    partialListen: -0.25,
    lowCompletion: -0.5,
    earlySkip: -1.5,
    earlySkipMaxPositionSeconds: 30,
    earlySkipMaxRatio: 0.25,
    maxImplicitTrackScore: 8,
    maxImplicitArtistScore: 16,
  }),
})

export const recommendationWeights = Object.freeze({
  relation: 0.45,
  artistAlbum: 0.20,
  tag: 0.15,
  exploration: 0.10,
  variant: 0.10,
})

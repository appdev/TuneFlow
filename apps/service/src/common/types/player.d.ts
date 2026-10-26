declare namespace TuneFlow {
  namespace Player {
    interface ProgressBarOptions {
      progress: number
      mode?: 'none' | 'normal' | 'indeterminate' | 'error' | 'paused'
    }

    type StatusButtonActions = 'unCollect'
    | 'collect'
    | 'prev'
    | 'pause'
    | 'play'
    | 'next'
    | 'seek'
    | 'volume'
    | 'mute'

    interface LyricInfo extends TuneFlow.Music.LyricInfo {
      rawlrcInfo: TuneFlow.Music.LyricInfo
    }

    interface Status {
      status: 'playing' | 'paused' | 'error' | 'stoped'
      name: string
      singer: string
      albumName: string
      picUrl: string
      progress: number
      duration: number
      playbackRate: number
      lyricLineText: string
      lyricLineAllText: string
      lyric: string
      tlyric: string
      rlyric: string
      verbatimLyric: string
      collect: boolean
      volume: number
      mute: boolean
    }
  }
}

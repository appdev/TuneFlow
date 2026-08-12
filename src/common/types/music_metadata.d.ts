import {
  type IAudioMetadata as iAudioMetadata,
} from 'music-metadata'

declare global {
  namespace TuneFlow {
    namespace MusicMetadataModule {
      type IAudioMetadata = iAudioMetadata
    }
  }
}

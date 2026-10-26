export * from '../../../../../packages/music-core/src/recommendations'
import type { DailyFeed as SharedFeed, PersonalDaily as SharedPersonal } from '../../../../../packages/music-core/src/recommendations'
export type DailyFeed = SharedFeed<LX.Music.MusicInfoOnline>
export type PersonalDaily = SharedPersonal<LX.Music.MusicInfoOnline>

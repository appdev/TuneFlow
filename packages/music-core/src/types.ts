import type { ServiceClient, TrackDto } from './client'
export interface AccountWorkspace<Input, Output extends { id: string }> {
  original(music: Input): TrackDto
  native(track: TrackDto): Output
  playlists(): Promise<Array<{ id: string }>>
  lists(action: string, data: unknown): Promise<unknown>
}
export interface DailyTrack { meta: Record<string, any> }
export interface DailyWorkspace<Track extends DailyTrack> { client: ServiceClient, native(track: TrackDto): Track }

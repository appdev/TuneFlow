import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, init } from '../db/core/db'
import type { PlaybackSession } from '../playback/historyRepository'
import { TasteRepository } from '../recommendations/tasteRepository'
import { buildAIProfileInput, projectAIPlayback } from './aiProjection'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-ai-projection-')); init(root) })
afterEach(() => { close(); rmSync(root, { recursive: true, force: true }) })

const session = (endedAt: number | null): PlaybackSession => ({
  playbackId: 'play-1',
  platform: 'web',
  startedAt: 1,
  endedAt,
  completed: true,
  lastPositionSeconds: 180,
  durationSeconds: 180,
  recommendationItemId: 'recommendation-1',
  track: {
    id: 'track-1',
    source: 'kw',
    name: 'Safe Song',
    singer: 'Safe Artist',
    album: 'Safe Album',
    path: '/private/music.mp3',
    url: 'https://signed.example/audio?token=secret',
    headers: { authorization: 'Bearer secret' },
    cookie: 'private-cookie',
    token: 'private-token',
    serviceOrigin: 'https://private-service',
    downloadPath: '/private/downloads',
    meta: { albumName: 'Meta Album', providerPrivate: { key: 'secret-provider-value' } },
  },
})

describe('AI playback projection', () => {
  it('keeps approved listening facts and drops every provider/private field', () => {
    const projected = projectAIPlayback(session(2))!
    expect(projected).toMatchObject({
      playbackId: 'play-1',
      track: { id: 'track-1', source: 'kw', name: 'Safe Song', singer: 'Safe Artist', album: 'Safe Album' },
      endedAt: 2,
      completed: true,
      recommendationItemId: 'recommendation-1',
    })
    const encoded = JSON.stringify(projected)
    for (const secret of ['/private/music.mp3', 'signed.example', 'Bearer secret', 'private-cookie', 'private-token', 'private-service', '/private/downloads', 'secret-provider-value']) expect(encoded).not.toContain(secret)
  })

  it('does not send open playback sessions', () => { expect(projectAIPlayback(session(null))).toBeNull() })

  it('combines all ended retained rows with a bounded long-term snapshot', () => {
    const taste = new TasteRepository(() => 2)
    taste.applyPlayback(session(2))
    taste.recordFeedback({ type: 'not_interested_artist', artist: 'Blocked Artist' })
    const input = buildAIProfileInput({ history: [session(2), { ...session(null), playbackId: 'open' }], taste, now: 3, timeZone: 'Asia/Shanghai' })
    expect(input.playbackHistory).toHaveLength(1)
    expect(input.longTermProfile.tracks).toHaveLength(1)
    expect(input.explicitFeedback).toContainEqual({ type: 'artist', identity: 'blocked artist' })
    expect(input.detailedHistoryRangeDays).toBe(30)
  })
})

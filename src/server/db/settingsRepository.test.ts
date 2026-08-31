import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, init } from './core/db'
import { SettingsRepository } from './settingsRepository'

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'tuneflow-settings-'))
  init(root)
})
afterEach(() => {
  close()
  rmSync(root, { recursive: true, force: true })
})

describe('SettingsRepository recommendation MusicBrainz address', () => {
  it('normalizes a configured host to its ws/2 base path', () => {
    const repository = new SettingsRepository(root)
    const settings = repository.updateSettings({ 'recommendation.musicBrainzBaseUrl': 'https://musicbrainz.example' })
    expect(settings['recommendation.musicBrainzBaseUrl']).toBe('https://musicbrainz.example/ws/2/')
  })

  it('keeps an empty address as the explicit disabled state', () => {
    const repository = new SettingsRepository(root)
    const settings = repository.updateSettings({ 'recommendation.musicBrainzBaseUrl': '' })
    expect(settings['recommendation.musicBrainzBaseUrl']).toBe('')
  })
})

describe('SettingsRepository AI configuration', () => {
  it('keeps AI disabled with no secret-bearing setting by default', () => {
    const repository = new SettingsRepository(root)
    const settings = repository.getSettings()
    expect(settings['recommendation.ai.enabled']).toBe(false)
    expect(settings['recommendation.ai.baseUrl']).toBe('')
    expect(settings['recommendation.ai.model']).toBe('')
    expect(Object.keys(settings).some(key => /recommendation\.ai\.(apiKey|key|token)/i.test(key))).toBe(false)
  })

  it('normalizes configuration before enabling it', () => {
    const repository = new SettingsRepository(root)
    repository.updateSettings({ 'recommendation.ai.baseUrl': 'https://ai.example/v1', 'recommendation.ai.model': ' model-a ' })
    const settings = repository.updateSettings({ 'recommendation.ai.enabled': true })
    expect(settings['recommendation.ai.baseUrl']).toBe('https://ai.example/v1/')
    expect(settings['recommendation.ai.model']).toBe('model-a')
    expect(settings['recommendation.ai.enabled']).toBe(true)
  })

  it('rejects incomplete enabled configuration atomically', () => {
    const repository = new SettingsRepository(root)
    expect(() => repository.updateSettings({ 'recommendation.ai.enabled': true })).toThrow('AI base URL and model are required')
    expect(repository.getSettings()['recommendation.ai.enabled']).toBe(false)
    repository.updateSettings({ 'recommendation.ai.baseUrl': 'https://ai.example/v1', 'recommendation.ai.model': 'model-a' })
    repository.updateSettings({ 'recommendation.ai.enabled': true })
    expect(() => repository.updateSettings({ 'recommendation.ai.baseUrl': '' })).toThrow('AI base URL and model are required')
    expect(repository.getSettings()['recommendation.ai.baseUrl']).toBe('https://ai.example/v1/')
  })
})

export interface WebCapabilities {
  runtime: 'web'
  settings: true
  appData: true
  environment: true
  lists: true
  events: true
  sources: true
  search: true
  playback: true
  downloads: true
  localLibrary: true
  themes: true
  serverFiles: true
}

export const getWebCapabilities = (): WebCapabilities => ({
  runtime: 'web',
  settings: true,
  appData: true,
  environment: true,
  lists: true,
  events: true,
  sources: true,
  search: true,
  playback: true,
  downloads: true,
  localLibrary: true,
  themes: true,
  serverFiles: true,
})

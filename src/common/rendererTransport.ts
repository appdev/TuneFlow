// The lyric window also imports rendererIpc. Keep this registration boundary
// independent from main-renderer stores, Service DTOs and browser state.
export interface RendererTransport {
  handles: (name: string) => boolean
  invoke: (name: string, params: unknown) => Promise<unknown>
  on: (name: string, listener: (payload: any) => void) => void
  off: (name: string, listener?: (payload: any) => void) => void
  dataKey: (key: string) => string
}
let transport: RendererTransport | undefined
export const registerRendererTransport = (value: RendererTransport) => { transport = value }
export const getRendererTransport = () => transport

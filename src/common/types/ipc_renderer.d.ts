declare namespace TuneFlow {
  interface IpcRendererEvent {
    event: null
  }
  interface IpcRendererEventParams<T> {
    event: null
    params: T
  }
  type IpcRendererEventListener = (params: TuneFlow.IpcRendererEvent) => any
  type IpcRendererEventListenerParams<T> = (params: TuneFlow.IpcRendererEventParams<T>) => any
}

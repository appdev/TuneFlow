declare namespace LX {
  interface IpcRendererEvent {
    event: null
  }
  interface IpcRendererEventParams<T> {
    event: null
    params: T
  }
  type IpcRendererEventListener = (params: LX.IpcRendererEvent) => any
  type IpcRendererEventListenerParams<T> = (params: LX.IpcRendererEventParams<T>) => any
}

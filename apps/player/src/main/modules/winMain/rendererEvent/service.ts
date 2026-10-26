import { mainOn } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { getWebContents } from '../main'

export default () => {
  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.restart_window, ({ event }) => {
    const main = getWebContents()
    if (event.sender !== main) return
    // Reload the already trusted document without widening will-navigate rules.
    main.reload()
  })
}

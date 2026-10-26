export const installWebContextMenuGuard = (target: EventTarget): (() => void) => {
  const preventBrowserMenu = (event: Event) => {
    event.preventDefault()
  }
  target.addEventListener('contextmenu', preventBrowserMenu, { capture: true })
  return () => { target.removeEventListener('contextmenu', preventBrowserMenu, { capture: true }) }
}

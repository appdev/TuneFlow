
const easeInOutQuad = (t: number, b: number, c: number, d: number): number => {
  t /= d / 2
  if (t < 1) return (c / 2) * t * t + b
  t--
  return (-c / 2) * (t * (t - 2) - 1) + b
}

type Noop = () => void
const noop: Noop = () => {}
type ScrollElement<T> = {
  tuneFlow_scrollLockKey?: number
  tuneFlow_scrollNextParams?: [ScrollElement<HTMLElement>, number, number, Noop]
  tuneFlow_scrollTimeout?: number
  tuneFlow_scrollDelayTimeout?: number
} & T

const handleScrollY = (element: ScrollElement<HTMLElement>, to: number, duration = 300, fn = noop): Noop => {
  if (!element) {
    fn()
    return noop
  }
  const clean = () => {
    element.tuneFlow_scrollLockKey = undefined
    element.tuneFlow_scrollNextParams = undefined
    if (element.tuneFlow_scrollTimeout) window.clearTimeout(element.tuneFlow_scrollTimeout)
    element.tuneFlow_scrollTimeout = undefined
  }
  if (element.tuneFlow_scrollLockKey) {
    element.tuneFlow_scrollNextParams = [element, to, duration, fn]
    element.tuneFlow_scrollLockKey = -1
    return clean
  }
  // @ts-expect-error
  const start = element.scrollTop ?? element.scrollY ?? 0
  if (to > start) {
    let maxScrollTop = element.scrollHeight - element.clientHeight
    if (to > maxScrollTop) to = maxScrollTop
  } else if (to < start) {
    if (to < 0) to = 0
  } else {
    fn()
    return noop
  }
  const change = to - start
  const increment = 10
  if (!change) {
    fn()
    return noop
  }

  let currentTime = 0
  let val: number
  let key = Math.random()

  const animateScroll = () => {
    element.tuneFlow_scrollTimeout = undefined
    // if (element.tuneFlow_scrollLockKey != key) {
    if (element.tuneFlow_scrollNextParams && currentTime > duration * 0.75) {
      const [_element, to, duration, fn] = element.tuneFlow_scrollNextParams
      clean()
      handleScrollY(_element, to, duration, fn)
      return
    }

    currentTime += increment
    val = Math.trunc(easeInOutQuad(currentTime, start, change, duration))
    if (element.scrollTo) {
      element.scrollTo(0, val)
    } else {
      element.scrollTop = val
    }
    if (currentTime < duration) {
      element.tuneFlow_scrollTimeout = window.setTimeout(animateScroll, increment)
    } else {
      if (element.tuneFlow_scrollNextParams) {
        const [_element, to, duration, fn] = element.tuneFlow_scrollNextParams
        clean()
        handleScrollY(_element, to, duration, fn)
      } else {
        clean()
        fn()
      }
    }
  }

  element.tuneFlow_scrollLockKey = key
  animateScroll()

  return clean
}
/**
  * 设置滚动条位置
  * @param {*} element 要设置滚动的容器 dom
  * @param {*} to 滚动的目标位置
  * @param {*} duration 滚动完成时间 ms
  * @param {*} fn 滚动完成后的回调
  * @param {*} delay 延迟执行时间
  */
export const scrollTo = (element: ScrollElement<HTMLElement>, to: number, duration = 300, fn = () => {}, delay = 0): () => void => {
  let cancelFn: () => void
  if (element.tuneFlow_scrollDelayTimeout != null) {
    window.clearTimeout(element.tuneFlow_scrollDelayTimeout)
    element.tuneFlow_scrollDelayTimeout = undefined
  }
  if (delay) {
    let scrollCancelFn: Noop
    cancelFn = () => {
      if (element.tuneFlow_scrollDelayTimeout == null) {
        scrollCancelFn?.()
      } else {
        window.clearTimeout(element.tuneFlow_scrollDelayTimeout)
        element.tuneFlow_scrollDelayTimeout = undefined
      }
    }
    element.tuneFlow_scrollDelayTimeout = window.setTimeout(() => {
      element.tuneFlow_scrollDelayTimeout = undefined
      scrollCancelFn = handleScrollY(element, to, duration, fn)
    }, delay)
  } else {
    cancelFn = handleScrollY(element, to, duration, fn) ?? noop
  }
  return cancelFn
}
const handleScrollX = (element: ScrollElement<HTMLElement>, to: number, duration = 300, fn = () => {}): () => void => {
  if (!element) {
    fn()
    return noop
  }
  const clean = () => {
    element.tuneFlow_scrollLockKey = undefined
    element.tuneFlow_scrollNextParams = undefined
    if (element.tuneFlow_scrollTimeout) window.clearTimeout(element.tuneFlow_scrollTimeout)
    element.tuneFlow_scrollTimeout = undefined
  }
  if (element.tuneFlow_scrollLockKey) {
    element.tuneFlow_scrollNextParams = [element, to, duration, fn]
    element.tuneFlow_scrollLockKey = -1
    return clean
  }
  // @ts-expect-error
  const start = element.scrollLeft || element.scrollX || 0
  if (to > start) {
    let maxScrollLeft = element.scrollWidth - element.clientWidth
    if (to > maxScrollLeft) to = maxScrollLeft
  } else if (to < start) {
    if (to < 0) to = 0
  } else {
    fn()
    return noop
  }
  const change = to - start
  const increment = 10
  if (!change) {
    fn()
    return noop
  }

  let currentTime = 0
  let val: number
  let key = Math.random()

  const animateScroll = () => {
    element.tuneFlow_scrollTimeout = undefined
    if (element.tuneFlow_scrollNextParams && currentTime > duration * 0.75) {
      const [_element, to, duration, fn] = element.tuneFlow_scrollNextParams
      clean()
      handleScrollY(_element, to, duration, fn)
      return
    }

    currentTime += increment
    val = Math.trunc(easeInOutQuad(currentTime, start, change, duration))
    if (element.scrollTo) {
      element.scrollTo(val, 0)
    } else {
      element.scrollLeft = val
    }
    if (currentTime < duration) {
      element.tuneFlow_scrollTimeout = window.setTimeout(animateScroll, increment)
    } else {
      if (element.tuneFlow_scrollNextParams) {
        const [_element, to, duration, fn] = element.tuneFlow_scrollNextParams
        clean()
        handleScrollY(_element, to, duration, fn)
      } else {
        clean()
        fn()
      }
    }
  }
  element.tuneFlow_scrollLockKey = key
  animateScroll()
  return clean
}
/**
  * 设置滚动条位置
  * @param {*} element 要设置滚动的容器 dom
  * @param {*} to 滚动的目标位置
  * @param {*} duration 滚动完成时间 ms
  * @param {*} fn 滚动完成后的回调
  * @param {*} delay 延迟执行时间
  */
export const scrollXTo = (element: ScrollElement<HTMLElement>, to: number, duration = 300, fn = () => {}, delay = 0): () => void => {
  let cancelFn: Noop
  if (element.tuneFlow_scrollDelayTimeout != null) {
    window.clearTimeout(element.tuneFlow_scrollDelayTimeout)
    element.tuneFlow_scrollDelayTimeout = undefined
  }
  if (delay) {
    let scrollCancelFn: Noop
    cancelFn = () => {
      if (element.tuneFlow_scrollDelayTimeout == null) {
        scrollCancelFn?.()
      } else {
        window.clearTimeout(element.tuneFlow_scrollDelayTimeout)
        element.tuneFlow_scrollDelayTimeout = undefined
      }
    }
    element.tuneFlow_scrollDelayTimeout = window.setTimeout(() => {
      element.tuneFlow_scrollDelayTimeout = undefined
      scrollCancelFn = handleScrollX(element, to, duration, fn)
    }, delay)
  } else {
    cancelFn = handleScrollX(element, to, duration, fn)
  }
  return cancelFn
}

const handleScrollXR = (element: ScrollElement<HTMLElement>, to: number, duration = 300, fn = () => {}): () => void => {
  if (!element) {
    fn()
    return noop
  }
  const clean = () => {
    element.tuneFlow_scrollLockKey = undefined
    element.tuneFlow_scrollNextParams = undefined
    if (element.tuneFlow_scrollTimeout) window.clearTimeout(element.tuneFlow_scrollTimeout)
    element.tuneFlow_scrollTimeout = undefined
  }
  if (element.tuneFlow_scrollLockKey) {
    element.tuneFlow_scrollNextParams = [element, to, duration, fn]
    element.tuneFlow_scrollLockKey = -1
    return clean
  }
  // @ts-expect-error
  const start = element.scrollLeft || element.scrollX as number || 0
  if (to < start) {
    let maxScrollLeft = -element.scrollWidth + element.clientWidth
    if (to < maxScrollLeft) to = maxScrollLeft
  } else if (to > start) {
    if (to > 0) to = 0
  } else {
    fn()
    return noop
  }

  const change = to - start
  const increment = 10
  if (!change) {
    fn()
    return noop
  }

  let currentTime = 0
  let val: number
  let key = Math.random()

  const animateScroll = () => {
    element.tuneFlow_scrollTimeout = undefined
    if (element.tuneFlow_scrollNextParams && currentTime > duration * 0.75) {
      const [_element, to, duration, fn] = element.tuneFlow_scrollNextParams
      clean()
      handleScrollY(_element, to, duration, fn)
      return
    }

    currentTime += increment
    val = Math.trunc(easeInOutQuad(currentTime, start, change, duration))

    if (element.scrollTo) {
      element.scrollTo(val, 0)
    } else {
      element.scrollLeft = val
    }
    if (currentTime < duration) {
      element.tuneFlow_scrollTimeout = window.setTimeout(animateScroll, increment)
    } else {
      if (element.tuneFlow_scrollNextParams) {
        const [_element, to, duration, fn] = element.tuneFlow_scrollNextParams
        clean()
        handleScrollY(_element, to, duration, fn)
      } else {
        clean()
        fn()
      }
    }
  }

  element.tuneFlow_scrollLockKey = key
  animateScroll()

  return clean
}
/**
  * 设置滚动条位置 （writing-mode: vertical-rl 专用）
  * @param element 要设置滚动的容器 dom
  * @param to 滚动的目标位置
  * @param duration 滚动完成时间 ms
  * @param fn 滚动完成后的回调
  * @param delay 延迟执行时间
  */
export const scrollXRTo = (element: ScrollElement<HTMLElement>, to: number, duration = 300, fn = () => {}, delay = 0): () => void => {
  let cancelFn: Noop
  if (element.tuneFlow_scrollDelayTimeout != null) {
    window.clearTimeout(element.tuneFlow_scrollDelayTimeout)
    element.tuneFlow_scrollDelayTimeout = undefined
  }
  if (delay) {
    let scrollCancelFn: Noop
    cancelFn = () => {
      if (element.tuneFlow_scrollDelayTimeout == null) {
        scrollCancelFn?.()
      } else {
        window.clearTimeout(element.tuneFlow_scrollDelayTimeout)
        element.tuneFlow_scrollDelayTimeout = undefined
      }
    }
    element.tuneFlow_scrollDelayTimeout = window.setTimeout(() => {
      element.tuneFlow_scrollDelayTimeout = undefined
      scrollCancelFn = handleScrollXR(element, to, duration, fn)
    }, delay)
  } else {
    cancelFn = handleScrollXR(element, to, duration, fn)
  }
  return cancelFn
}


/**
  * 设置标题
  */
let dom_title = typeof document === 'undefined' ? undefined : document.getElementsByTagName('title')[0]
export const setTitle = (title: string | null) => {
  title ||= 'TuneFlow · 音流'
  if (dom_title != null) dom_title.innerText = title
}

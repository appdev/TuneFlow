export type DisplayMode = 'auto' | 'phone' | 'tablet' | 'car'

// 按可用 dp 布局；屏幕横竖方向独立传入，软键盘缩短窗口不能触发横屏布局。
export const resolveAdaptiveLayout = (width: number, height: number, mode: DisplayMode, landscape: boolean, automotive = false, smallestScreenWidth = Math.min(width, height)) => {
  const isCar = mode == 'car' || (mode == 'auto' && automotive)
  const wide = mode != 'phone' && (width >= 720 || (width >= 600 && (landscape || mode == 'tablet' || isCar)))
  const railWidth = wide ? (isCar ? 104 : 88) : 0
  const phone = !wide && !isCar && mode != 'tablet' && (mode == 'phone' || smallestScreenWidth < 600)
  return {
    width,
    height,
    wide,
    isCar,
    phone,
    railWidth,
    splitLibrary: wide && width - railWidth >= 680,
    songRowHeight: isCar ? 72 : phone ? 68 : 54,
  }
}

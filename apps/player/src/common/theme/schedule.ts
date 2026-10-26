type ScheduleSettings = Partial<Pick<LX.AppSetting, 'theme.dayStart' | 'theme.nightStart'>>

export const isValidSchedule = (dayStart: string, nightStart: string): boolean => {
  const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  return validTime.test(dayStart) && validTime.test(nightStart) && dayStart != nightStart
}

export const getThemeSchedule = (setting: ScheduleSettings = {}) => {
  const dayStart = setting['theme.dayStart'] ?? '07:00'
  const nightStart = setting['theme.nightStart'] ?? '19:00'
  return isValidSchedule(dayStart, nightStart) ? { dayStart, nightStart } : { dayStart: '07:00', nightStart: '19:00' }
}

// 按设备本地时间判断，支持分钟边界及跨午夜的白天时段。
export const isNightTime = (date = new Date(), setting: ScheduleSettings = {}): boolean => {
  const { dayStart, nightStart } = getThemeSchedule(setting)
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const start = minutes(dayStart)
  const end = minutes(nightStart)
  const now = date.getHours() * 60 + date.getMinutes()
  return !(start < end ? now >= start && now < end : now >= start || now < end)
}

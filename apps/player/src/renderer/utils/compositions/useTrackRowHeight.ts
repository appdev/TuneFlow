import { computed } from '@common/utils/vueTools'
import { isFullscreen } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { getFontSizeWithScreen } from '@renderer/utils'

// One measured height for both virtualized and ordinary track rows (56px at 16px).
export default () => computed(() => Math.max(48, Math.ceil((isFullscreen.value ? getFontSizeWithScreen() : appSetting['common.fontSize']) * 3.5)))

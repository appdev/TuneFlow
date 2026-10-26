import { compareVer } from '@/utils'
import { downloadNewVersion, getVersionInfo, updateApp } from '@/utils/version'
import versionActions from '@/store/version/action'
import versionState, { type InitState } from '@/store/version/state'
import { getIgnoreVersion, getIgnoreVersionFailTipTime, saveIgnoreVersion, saveIgnoreVersionFailTipTime } from '@/utils/data'
import { showVersionModal } from '@/navigation'
import { Navigation } from 'react-native-navigation'
import { toast } from '@/utils/tools'

export const showModal = () => {
  if (versionState.showModal) return
  versionActions.setVisibleModal(true)
  showVersionModal()
}

export const hideModal = (componentId: string) => {
  if (!versionState.showModal) return
  versionActions.setVisibleModal(false)
  void Navigation.dismissOverlay(componentId)
}

const doCheckUpdate = async() => {
  versionActions.setVersionInfo({ status: 'checking', isLatest: false, isUnknown: false, downloadMessage: '' })
  let versionInfo: InitState['versionInfo'] = { ...versionState.versionInfo }
  try {
    const { version, desc, history } = await getVersionInfo()
    versionInfo.newVersion = {
      version,
      desc,
      history,
    }
  } catch (err) {
    versionInfo.newVersion = {
      version: '0.0.0',
      desc: '',
      history: [],
    }
  }
  // const versionInfo = {
  //   version: '1.9.0',
  //   desc: '- 更新xxx\n- 修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达',
  //   history: [{ version: '1.8.0', desc: '- 更新xxx22\n- 修复xxx22' }, { version: '1.7.0', desc: '- 更新xxx22\n- 修复xxx22' }],
  // }
  if (versionInfo.newVersion.version == '0.0.0') {
    versionInfo.isUnknown = true
    versionInfo.status = 'error'
  } else {
    versionInfo.status = 'idle'
    versionInfo.isUnknown = false
    versionInfo.isLatest = compareVer(versionInfo.version, versionInfo.newVersion.version) != -1
  }

  versionActions.setVersionInfo(versionInfo)

  if (!versionInfo.isLatest) {
    if (versionInfo.isUnknown) {
      const time = await getIgnoreVersionFailTipTime()
      if (Date.now() - time < 7 * 86400000) return
      saveIgnoreVersionFailTipTime(Date.now())
      toast(global.i18n.t('version_tip_unknown'))
    } else if (versionInfo.newVersion.version != await getIgnoreVersion()) {
      showModal()
    }
  }
  // console.log(compareVer(process.versions.app, versionInfo.version))
  // console.log(process.versions.app, versionInfo.version)
}

let checkPromise: Promise<void> | null = null
export const checkUpdate = async() => {
  if (versionState.versionInfo.status == 'downloading') return
  if (!checkPromise) checkPromise = doCheckUpdate().finally(() => { checkPromise = null })
  return checkPromise
}

export const downloadUpdate = () => {
  if (versionState.versionInfo.status == 'downloading' || !versionState.versionInfo.newVersion) return
  versionActions.setVersionInfo({ status: 'downloading', downloadMessage: '正在准备下载…' })
  versionActions.setProgress({ total: 0, current: 0 })

  downloadNewVersion(versionState.versionInfo.newVersion.version, (total: number, current: number) => {
    // console.log(total, current)
    versionActions.setProgress({ total, current })
  }, (downloadMessage: string) => {
    versionActions.setVersionInfo({ downloadMessage })
  }).then(async() => {
    versionActions.setVersionInfo({ status: 'downloaded', downloadMessage: '' })
    await installUpdate()
  }).catch((error: Error) => {
    versionActions.setVersionInfo({ status: 'error', downloadMessage: error.message })
  })
}

export const installUpdate = async() => {
  try { await updateApp() } catch {
    // 安装授权失败不丢弃已校验文件，可再次点击安装。
    versionActions.setVersionInfo({ downloadMessage: '安装包已下载，请允许安装此来源的应用后再次点击更新' })
  }
}

export const setIgnoreVersion = (version: InitState['ignoreVersion']) => {
  versionActions.setIgnoreVersion(version)
  saveIgnoreVersion(version)
}

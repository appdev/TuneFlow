import { useRouter } from '@common/utils/vueRouter'
import musicSdk from '@renderer/utils/musicSdk'
import { openUrl, clipboardWriteText } from '@common/utils/electron'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { removeListMusics } from '@renderer/store/list/action'
import { appSetting } from '@renderer/store/setting'
import { formatMusicName, toOldMusicInfo } from '@renderer/utils/index'
import { addDislikeInfo, hasDislike } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { trashLocalMusic } from '@renderer/utils/removeLocalMusic'
import { LIBRARY_ID } from '@renderer/service/workspace'
import { deleteLibrarySelection } from '@renderer/service/libraryActions'


export default ({ props, list, selectedList, removeAllSelect }) => {
  const router = useRouter()
  const t = useI18n()

  const handleSearch = index => {
    const info = list.value[index]
    router.push({
      path: '/search',
      query: {
        text: `${info.name} ${info.singer}`,
      },
    })
  }

  const handleOpenMusicDetail = index => {
    const minfo = list.value[index]
    const url = musicSdk[minfo.source]?.getMusicDetailPageUrl(toOldMusicInfo(minfo))
    if (!url) return
    openUrl(url)
  }

  const handleCopyName = index => {
    const minfo = list.value[index]
    clipboardWriteText(formatMusicName(appSetting['download.fileName'], minfo.name, minfo.singer))
  }

  const handleDislikeMusic = async(index) => {
    const minfo = list.value[index]
    const confirm = await dialog.confirm({
      message: minfo.singer ? t('lists__dislike_music_singer_tip', { name: minfo.name, singer: minfo.singer }) : t('lists__dislike_music_tip', { name: minfo.name }),
      cancelButtonText: t('cancel_button_text_2'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (!confirm) return
    await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
    if (hasDislike(playMusicInfo.musicInfo)) {
      playNext(true)
    }
  }

  const handleRemoveMusic = async(index, single) => {
    const targets = selectedList.value.length && !single ? [...selectedList.value] : [list.value[index]].filter(Boolean)
    if (props.listId === LIBRARY_ID) {
      if (await deleteLibrarySelection(targets)) removeAllSelect()
      return
    }
    if (targets.some(music => music.source == 'local')) {
      const listId = props.listId
      let deleteFiles = false
      if (!await dialog.confirm({
        message: t('local_remove_tip', { count: targets.length }),
        checkboxLabel: t('local_remove_files'),
        onCheckboxChange: checked => { deleteFiles = checked },
        confirmButtonText: t('lists__remove_tip_button'),
      })) return
      const removed = []
      let failed = 0
      for (const music of targets) {
        try {
          if (deleteFiles && music.source == 'local') await trashLocalMusic(music)
          removed.push(music.id)
        } catch { failed++ }
      }
      if (removed.length) await removeListMusics({ listId, ids: removed })
      removeAllSelect()
      if (failed) await dialog({ message: t('local_remove_failed', { count: failed }) })
      return
    }
    if (selectedList.value.length && !single) {
      const confirm = await (selectedList.value.length > 1
        ? dialog.confirm({
          message: t('lists__remove_music_tip', { len: selectedList.value.length }),
          confirmButtonText: t('lists__remove_tip_button'),
        })
        : Promise.resolve(true)
      )
      if (!confirm) return
      removeListMusics({ listId: props.listId, ids: selectedList.value.map(m => m.id) })
      removeAllSelect()
    } else {
      removeListMusics({ listId: props.listId, ids: [list.value[index].id] })
    }
  }

  return {
    handleSearch,
    handleOpenMusicDetail,
    handleCopyName,
    handleDislikeMusic,
    handleRemoveMusic,
  }
}

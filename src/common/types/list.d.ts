declare namespace TuneFlow {
  namespace List {
    interface UserListInfo {
      id: string
      name: string
      // list: TuneFlow.Music.MusicInfo[]
      source?: TuneFlow.OnlineSource
      sourceListId?: string
      // position?: number
      locationUpdateTime: number | null
    }

    interface MyDefaultListInfo {
      id: 'default'
      name: 'list__name_default'
      // name: '试听列表'
      // list: TuneFlow.Music.MusicInfo[]
    }

    interface MyLoveListInfo {
      id: 'love'
      name: 'list__name_love'
      // name: '我的收藏'
      // list: TuneFlow.Music.MusicInfo[]
    }

    interface MyLocalListInfo {
      id: 'local'
      name: 'list__name_local'
    }

    interface MyTempListInfo {
      id: 'temp'
      name: '临时列表'
      // list: TuneFlow.Music.MusicInfo[]
      // TODO: save default lists info
      meta: {
        id?: string
      }
    }

    type MyListInfo = MyDefaultListInfo | MyLoveListInfo | MyLocalListInfo | UserListInfo

    interface MyAllList {
      defaultList: MyDefaultListInfo
      loveList: MyLoveListInfo
      userList: UserListInfo[]
      tempList: MyTempListInfo
    }


    type SearchHistoryList = string[]
    type ListPositionInfo = Record<string, number>
    type ListUpdateInfo = Record<string, {
      updateTime: number
      isAutoUpdate: boolean
    }>

    type ListSaveType = 'myList' | 'downloadList'
    type ListSaveInfo = {
      type: 'myList'
      data: Partial<MyAllList>
    } | {
      type: 'downloadList'
      data: TuneFlow.Download.ListItem[]
    }


    type ListActionDataOverwrite = MakeOptional<TuneFlow.List.ListDataFull, 'tempList'>
    interface ListActionAdd {
      position: number
      listInfos: UserListInfo[]
    }
    type ListActionRemove = string[]
    type ListActionUpdate = UserListInfo[]
    interface ListActionUpdatePosition {
      /**
       * 列表id
       */
      ids: string[]
      /**
       * 位置
       */
      position: number
    }

    interface ListActionMusicAdd {
      id: string
      musicInfos: TuneFlow.Music.MusicInfo[]
      addMusicLocationType: TuneFlow.AddMusicLocationType
    }

    interface ListActionMusicMove {
      fromId: string
      toId: string
      musicInfos: TuneFlow.Music.MusicInfo[]
      addMusicLocationType: TuneFlow.AddMusicLocationType
    }

    interface ListActionCheckMusicExistList {
      listId: string
      musicInfoId: string
    }

    interface ListActionMusicRemove {
      listId: string
      ids: string[]
    }

    type ListActionMusicUpdate = Array<{
      id: string
      musicInfo: TuneFlow.Music.MusicInfo
    }>

    interface ListActionMusicUpdatePosition {
      listId: string
      position: number
      ids: string[]
    }

    interface ListActionMusicOverwrite {
      listId: string
      musicInfos: TuneFlow.Music.MusicInfo[]
    }

    type ListActionMusicClear = string[]

    interface MyDefaultListInfoFull extends MyDefaultListInfo {
      list: TuneFlow.Music.MusicInfo[]
    }
    interface MyLoveListInfoFull extends MyLoveListInfo {
      list: TuneFlow.Music.MusicInfo[]
    }
    interface UserListInfoFull extends UserListInfo {
      list: TuneFlow.Music.MusicInfo[]
    }
    interface MyTempListInfoFull extends MyTempListInfo {
      list: TuneFlow.Music.MusicInfo[]
    }

    interface ListDataFull {
      defaultList: TuneFlow.Music.MusicInfo[]
      loveList: TuneFlow.Music.MusicInfo[]
      userList: UserListInfoFull[]
      tempList: TuneFlow.Music.MusicInfo[]
    }
  }
}

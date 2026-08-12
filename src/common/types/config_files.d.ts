declare namespace TuneFlow {
  namespace ConfigFile {
    interface MyListInfoPart {
      type: 'playListPart_v2'
      data: TuneFlow.List.MyDefaultListInfoFull | TuneFlow.List.MyLoveListInfoFull | TuneFlow.List.UserListInfoFull
    }

  }
}

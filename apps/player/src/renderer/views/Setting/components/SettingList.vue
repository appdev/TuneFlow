<template>
  <dt id="list">{{ $t('setting__list') }}</dt>
  <dd class="tf-preference-group">
    <h3>列表显示</h3>
    <label class="tf-preference-row"><span>{{ $t('setting__list_action_btn') }}</span><input id="setting_list_actionButtonsVisible_enable" type="checkbox" :checked="appSetting['list.actionButtonsVisible']" @change="updateSetting({ 'list.actionButtonsVisible': $event.target.checked })"></label>
    <label class="tf-preference-row"><span>{{ $t('setting__list_source') }}</span><input id="setting_list_showSource_enable" type="checkbox" :checked="appSetting['list.isShowSource']" @change="updateSetting({ 'list.isShowSource': $event.target.checked })"></label>
    <label class="tf-preference-row"><span>{{ $t('setting__list_scroll') }}</span><input id="setting_list_scroll_enable" type="checkbox" :checked="appSetting['list.isSaveScrollLocation']" @change="updateSetting({ 'list.isSaveScrollLocation': $event.target.checked })"></label>
  </dd>
  <dd class="tf-preference-group">
    <h3>{{ $t('setting_single_play') }}</h3>
    <div class="tf-preference-options" role="radiogroup" :aria-label="$t('setting_single_play')">
      <label><input id="single_play_replace" type="radio" name="single_play_mode" :checked="appSetting['list.singlePlayMode'] === 'replace'" @change="updateSetting({ 'list.singlePlayMode': 'replace' })"><span>{{ $t('setting_single_play_replace') }}</span></label>
      <label><input id="single_play_add" type="radio" name="single_play_mode" :checked="appSetting['list.singlePlayMode'] === 'add'" @change="updateSetting({ 'list.singlePlayMode': 'add' })"><span>{{ $t('setting_single_play_add') }}</span></label>
    </div>
    <p class="tf-preference-help">{{ $t('setting_single_play_tip') }}</p>
    <label class="tf-preference-row"><span>{{ $t('setting_prefer_local') }}</span><input id="prefer_local" type="checkbox" :checked="appSetting['player.preferLocal']" @change="updateSetting({ 'player.preferLocal': $event.target.checked })"></label>
    <p class="tf-preference-help">{{ $t('setting_prefer_local_tip') }}</p>
  </dd>
  <dd class="tf-preference-group">
    <h3 id="list_addMusicLocationType">{{ $t('setting__list_add_music_location_type') }}</h3>
    <div class="tf-preference-options" role="radiogroup" :aria-label="$t('setting__list_add_music_location_type')">
      <label><input id="setting_list_add_music_location_type_top" type="radio" name="add_music_location" :checked="appSetting['list.addMusicLocationType'] === 'top'" @change="updateSetting({ 'list.addMusicLocationType': 'top' })"><span>{{ $t('setting__list_add_music_location_type_top') }}</span></label>
      <label><input id="setting_list_add_music_location_type_bottom" type="radio" name="add_music_location" :checked="appSetting['list.addMusicLocationType'] === 'bottom'" @change="updateSetting({ 'list.addMusicLocationType': 'bottom' })"><span>{{ $t('setting__list_add_music_location_type_bottom') }}</span></label>
    </div>
  </dd>
</template>

<script>
// import { ref, onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'

export default {
  name: 'SettingList',
  setup() {
    return {
      appSetting,
      updateSetting,
    }
  },
}
</script>

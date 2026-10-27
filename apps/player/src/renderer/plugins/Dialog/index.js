import Dialog from './Dialog.vue'
import { createApp } from 'vue'
import { i18nPlugin } from '@renderer/plugins/i18n'


const defaultOptions = {
  message: '',
  teleport: '#root',
  showCancel: false,
  cancelButtonText: '',
  confirmButtonText: '',
  selection: false,
}

export const dialog = function(options) {
  const { message, showCancel, cancelButtonText, confirmButtonText, teleport, selection, checkboxLabel = '', onCheckboxChange } =
    Object.assign({}, defaultOptions, typeof options == 'string' ? { message: options } : options || {})
  return new Promise((resolve, reject) => {
    let app = createApp(Dialog, {
      afterLeave() {
        app?.unmount()
        app = null
      },
    })

    app.use(i18nPlugin)
    let instance = app.mount(document.createElement('div'))

    // 属性设置
    instance.visible = true
    instance.message = message
    instance.showCancel = showCancel
    instance.cancelButtonText = cancelButtonText
    instance.confirmButtonText = confirmButtonText
    instance.teleport = teleport
    instance.selection = selection
    instance.checkboxLabel = checkboxLabel
    instance.handleCheckboxChange = checked => {
      instance.checkboxChecked = checked
      onCheckboxChange?.(checked)
    }

    // 挂载
    document.getElementById('container').appendChild(instance.$el)

    instance.handleCancel = () => {
      instance.visible = false
      resolve(false)
    }

    instance.handleComfirm = () => {
      instance.visible = false
      resolve(true)
    }
  })
}

dialog.confirm = options => dialog(
  typeof options == 'string'
    ? { message: options, showCancel: true }
    : { ...options, showCancel: true },
)

const dialogPlugin = {
  install(Vue, options) {
    Vue.config.globalProperties.$dialog = dialog
  },
}

export default dialogPlugin

// 微信网站授权与 QQ 的二维码拉起协议不同，只接受官方页面实际给出的授权链接。
export const isWechatLoginPage = (url: string) => /^https:\/\/open\.weixin\.qq\.com(?::443)?(?:\/connect\/(?:qrconnect|app\/qrconnect)(?:[?#]|$)|\/?$)/i.test(url)

export const getWechatAppUrl = (url: string, pageUrl: string): string | null => {
  if (!isWechatLoginPage(pageUrl)) return null
  return /^weixin:\/\/dl\/business\/\?(?:t|ticket)=[A-Za-z0-9_%=+&.-]+(?:#wechat_redirect)?$/.test(url) ? url : null
}

// 由用户点击后导出当前会话二维码；不重载页面，保留官网自己的授权轮询。
export const getWechatQrScript = (requestId: number) => `
(function () {
  if (location.protocol !== 'https:' || location.hostname !== 'open.weixin.qq.com' || !/^\\/connect\\/(?:app\\/)?qrconnect$/.test(location.pathname)) return;
  function send(type, image) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, image: image, requestId: ${requestId} })); }
  var images = document.querySelectorAll('img');
  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    if (!/^https:\\/\\/open\\.weixin\\.qq\\.com\\/connect\\/qrcode\\/[A-Za-z0-9_-]+$/.test(img.src) || !img.complete || !img.naturalWidth) continue;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 400;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 400);
      ctx.drawImage(img, 20, 20, 360, 360);
      send('wechat-qr-image', canvas.toDataURL('image/png'));
    } catch (error) { send('wechat-qr-unavailable'); }
    return;
  }
  send('wechat-qr-unavailable');
})(); true;`

package cn.toside.music.mobile.utils;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.TimeUnit;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

/** 仅在用户主动配对时连接私有 IPv4 地址；密钥不随网络请求发送。 */
public class AccountTransferModule extends ReactContextBaseJavaModule {
  private static final int SCAN_REQUEST = 29143;
  private Promise scanPromise;
  private volatile Call pending;
  private final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(8, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS).build();

  AccountTransferModule(ReactApplicationContext context) {
    super(context);
    context.addActivityEventListener(new BaseActivityEventListener() {
      @Override public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode != SCAN_REQUEST || scanPromise == null) return;
        Promise result = scanPromise;
        scanPromise = null;
        IntentResult scan = IntentIntegrator.parseActivityResult(resultCode, data);
        result.resolve(scan == null ? null : scan.getContents());
      }
    });
  }
  @Override public String getName() { return "AccountTransferModule"; }

  @ReactMethod public void scan(Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null || scanPromise != null) { promise.reject("scan_unavailable", "Unable to open scanner"); return; }
    scanPromise = promise;
    activity.runOnUiThread(() -> {
      try {
        new IntentIntegrator(activity).setRequestCode(SCAN_REQUEST).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
          .setCaptureActivity(AccountTransferCaptureActivity.class)
          .setPrompt("").setBeepEnabled(false).setBarcodeImageEnabled(false)
          .setOrientationLocked(false).initiateScan();
      } catch (Exception error) { scanPromise = null; promise.reject("scan_unavailable", "Unable to open scanner"); }
    });
  }

  private static byte[] hex(String text) {
    byte[] result = new byte[text.length() / 2];
    for (int i = 0; i < result.length; i++) result[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16);
    return result;
  }
  private static String hex(byte[] data) {
    StringBuilder result = new StringBuilder();
    for (byte value : data) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
    return result.toString();
  }
  private static boolean privateAddress(String host) {
    if (host == null || !host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
    String[] parts = host.split("\\.");
    int[] numbers = new int[4];
    for (int i = 0; i < 4; i++) {
      numbers[i] = Integer.parseInt(parts[i]);
      if (numbers[i] > 255 || !String.valueOf(numbers[i]).equals(parts[i])) return false;
    }
    return numbers[0] == 10 || (numbers[0] == 192 && numbers[1] == 168)
      || (numbers[0] == 172 && numbers[1] >= 16 && numbers[1] <= 31);
  }

  @ReactMethod public synchronized void receive(String link, Promise promise) {
    if (pending != null) { promise.reject("transfer_busy", "Transfer already in progress"); return; }
    try {
      if (link.length() > 1024) throw new IllegalArgumentException();
      Uri uri = Uri.parse(link.trim());
      String host = uri.getQueryParameter("host");
      String id = uri.getQueryParameter("id");
      String secret = uri.getQueryParameter("key");
      int port = Integer.parseInt(uri.getQueryParameter("port"));
      if (!"qmusic".equals(uri.getScheme()) || !"account-transfer".equals(uri.getHost())
        || !"1".equals(uri.getQueryParameter("v")) || !privateAddress(host) || port < 1024 || port > 65535
        || id == null || !id.matches("[a-f0-9]{32}") || secret == null || !secret.matches("[a-f0-9]{64}")) throw new IllegalArgumentException();
      byte[] key = hex(secret);
      byte[] random = new byte[16];
      new SecureRandom().nextBytes(random);
      String nonce = hex(random);
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      String proof = hex(mac.doFinal(("claim:" + id + ":" + nonce).getBytes(StandardCharsets.UTF_8)));
      String body = new JSONObject().put("nonce", nonce).put("proof", proof).toString();
      Request request = new Request.Builder().url("http://" + host + ":" + port + "/qmusic-account-transfer/" + id)
        .post(RequestBody.create(MediaType.parse("application/json"), body)).build();
      Call call = client.newCall(request);
      pending = call;
      call.enqueue(new Callback() {
        private void finish() { synchronized (AccountTransferModule.this) { if (pending == call) pending = null; } java.util.Arrays.fill(key, (byte) 0); }
        @Override public void onFailure(Call call, java.io.IOException error) {
          finish(); promise.reject(call.isCanceled() ? "transfer_cancelled" : "transfer_network", "Unable to connect to computer");
        }
        @Override public void onResponse(Call call, Response response) {
          try (Response closed = response) {
            if (call.isCanceled()) throw new IllegalStateException();
            if (!response.isSuccessful()) { promise.reject("transfer_expired", "Pairing expired or cancelled"); return; }
            ResponseBody responseBody = response.body();
            if (responseBody == null || responseBody.contentLength() > 32768) throw new IllegalArgumentException();
            okio.BufferedSource source = responseBody.source();
            if (source.request(32769)) throw new IllegalArgumentException();
            JSONObject envelope = new JSONObject(source.readUtf8());
            byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
            if (iv.length != 12) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            cipher.updateAAD((id + ":" + nonce).getBytes(StandardCharsets.UTF_8));
            String payload = new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8);
            JSONObject data = new JSONObject(payload);
            if (data.getInt("v") != 1 || !"tx".equals(data.getString("provider")) || data.getLong("expiresAt") < System.currentTimeMillis()) throw new IllegalArgumentException();
            if (call.isCanceled()) throw new IllegalStateException();
            promise.resolve(payload);
          } catch (Exception error) { promise.reject("transfer_invalid", "Unable to verify pairing data"); }
          finally { finish(); }
        }
      });
    } catch (Exception error) { promise.reject("transfer_invalid", "Invalid pairing code"); }
  }
  @ReactMethod public synchronized void cancel() { if (pending != null) pending.cancel(); }
  @Override public void invalidate() { cancel(); super.invalidate(); }
}

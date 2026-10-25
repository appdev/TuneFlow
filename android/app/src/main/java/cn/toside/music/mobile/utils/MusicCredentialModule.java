package cn.toside.music.mobile.utils;

import android.util.AtomicFile;
import android.util.Base64;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** 官方账号与日推凭证只保存在本机，不参与 Android 备份或歌单导出。 */
public class MusicCredentialModule extends ReactContextBaseJavaModule {
  private static final String ALIAS = "qmusic.qq.daily.v1";
  private final AtomicFile storage;
  private static final String KUGOU_ALIAS = "qmusic.kugou.account.v1";
  private final AtomicFile kugouStorage;
  private static final String QQ_ACCOUNT_ALIAS = "qmusic.qq.account.v1";
  private final AtomicFile qqAccountStorage;
  private final AtomicFile legacyStorage;
  private final AtomicFile legacyKugouStorage;
  private final AtomicFile legacyQQAccountStorage;

  MusicCredentialModule(ReactApplicationContext context) {
    super(context);
    storage = new AtomicFile(new File(context.getNoBackupFilesDir(), "qq-daily.json"));
    kugouStorage = new AtomicFile(new File(context.getNoBackupFilesDir(), "kugou-account.json"));
    qqAccountStorage = new AtomicFile(new File(context.getNoBackupFilesDir(), "qq-account.json"));
    legacyStorage = new AtomicFile(new File(context.getNoBackupFilesDir(), "qq-daily.enc"));
    legacyKugouStorage = new AtomicFile(new File(context.getNoBackupFilesDir(), "kugou-account.enc"));
    legacyQQAccountStorage = new AtomicFile(new File(context.getNoBackupFilesDir(), "qq-account.enc"));
  }

  @Override public String getName() { return "MusicCredentialModule"; }

  @ReactMethod public synchronized void getQQAccount(Promise promise) {
    try { JSONObject data = readInternal(qqAccountStorage, legacyQQAccountStorage, QQ_ACCOUNT_ALIAS); promise.resolve(data == null ? null : data.toString()); }
    catch (Exception error) { promise.reject("credential_storage", "Unable to read protected account credentials"); }
  }
  @ReactMethod public synchronized void setQQAccount(String value, Promise promise) {
    try {
      if (value.length() > 16384) throw new IllegalArgumentException();
      JSONObject data = new JSONObject(value);
      if (!data.getString("qqmusic_uin").matches("[1-9][0-9]*") || data.getString("qqmusic_key").isEmpty()) throw new IllegalArgumentException();
      writeInternal(qqAccountStorage, data);
      promise.resolve(null);
    } catch (Exception error) { promise.reject("credential_storage", "Unable to save protected account credentials"); }
  }
  @ReactMethod public synchronized void clearQQAccount(Promise promise) {
    qqAccountStorage.delete();
    legacyQQAccountStorage.delete();
    if (qqAccountStorage.getBaseFile().exists() || legacyQQAccountStorage.getBaseFile().exists()) promise.reject("credential_storage", "Unable to clear account credentials");
    else promise.resolve(null);
  }

  private SecretKey key(String alias) throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
    throw new IllegalStateException("legacy_credential_unavailable");
  }

  private JSONObject readInternal(AtomicFile file, AtomicFile legacy, String alias) throws Exception {
    if (file.getBaseFile().exists()) return new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
    if (!legacy.getBaseFile().exists()) return null;
    // Read old encrypted records once, keeping the original for recovery. New
    // records live only in the app-private no-backup directory, without Keystore.
    JSONObject data = readProtected(legacy, alias);
    if (data != null) writeInternal(file, data);
    return data;
  }

  private JSONObject readProtected(AtomicFile file, String alias) throws Exception {
    if (!file.getBaseFile().exists()) return null;
    JSONObject envelope = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, key(alias), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
    cipher.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
    return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
  }

  private void writeInternal(AtomicFile file, JSONObject data) throws Exception {
    FileOutputStream stream = null;
    try {
      stream = file.startWrite();
      stream.write(data.toString().getBytes(StandardCharsets.UTF_8));
      file.finishWrite(stream);
    } catch (Exception error) {
      if (stream != null) file.failWrite(stream);
      throw error;
    }
  }

  @ReactMethod public synchronized void getQQDailyKey(String owner, Promise promise) {
    try {
      JSONObject data = readInternal(storage, legacyStorage, ALIAS);
      promise.resolve(data != null && owner.equals(data.getString("owner")) ? data.getString("key") : null);
    } catch (Exception error) {
      // 不把加密内容或凭证带进异常日志。
      promise.reject("credential_storage", "Unable to read protected recommendation credentials");
    }
  }

  @ReactMethod public synchronized void setQQDailyKey(String owner, String value, Promise promise) {
    try {
      if (!owner.matches("[0-9]+") || !value.matches("qmk-[A-Za-z0-9_-]{12,1024}")) throw new IllegalArgumentException();
      JSONObject data = new JSONObject().put("owner", owner).put("key", value);
      writeInternal(storage, data);
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("credential_storage", "Unable to save protected recommendation credentials");
    }
  }

  @ReactMethod public synchronized void clearQQDailyKey(Promise promise) {
    storage.delete();
    legacyStorage.delete();
    if (storage.getBaseFile().exists() || legacyStorage.getBaseFile().exists()) promise.reject("credential_storage", "Unable to clear recommendation credentials");
    else promise.resolve(null);
  }

  @ReactMethod public synchronized void getKugouSession(Promise promise) {
    try {
      JSONObject data = readInternal(kugouStorage, legacyKugouStorage, KUGOU_ALIAS);
      promise.resolve(data == null ? null : data.toString());
    } catch (Exception error) {
      promise.reject("credential_storage", "Unable to read protected account credentials");
    }
  }

  @ReactMethod public synchronized void setKugouSession(String value, Promise promise) {
    try {
      if (value.length() > 16384) throw new IllegalArgumentException();
      JSONObject data = new JSONObject(value);
      if (!data.getString("userId").matches("[1-9][0-9]*") || data.getString("token").isEmpty()
        || data.getString("token").length() > 4096 || !data.getString("mid").matches("[a-fA-F0-9]{32}")) throw new IllegalArgumentException();
      writeInternal(kugouStorage, data);
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("credential_storage", "Unable to save protected account credentials");
    }
  }

  @ReactMethod public synchronized void clearKugouSession(Promise promise) {
    kugouStorage.delete();
    legacyKugouStorage.delete();
    if (kugouStorage.getBaseFile().exists() || legacyKugouStorage.getBaseFile().exists()) promise.reject("credential_storage", "Unable to clear account credentials");
    else promise.resolve(null);
  }
}

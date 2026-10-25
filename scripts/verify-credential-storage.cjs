// Exercise the actual Java bridge on the host without an AndroidKeyStore
// provider. Only Android/React platform services are stubbed; data is synthetic.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const jsonJar = process.env.Q_MUSIC_JSON_JAR
assert.ok(jsonJar && fs.existsSync(jsonJar), 'Q_MUSIC_JSON_JAR must point to an existing org.json runtime jar')
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qmusic-native-credentials-'))
const sources = {
  'android/util/AtomicFile.java': `package android.util;
import java.io.*;import java.nio.file.*;
public class AtomicFile { private final File file; public AtomicFile(File f){file=f;}
public File getBaseFile(){return file;} public byte[] readFully()throws Exception{return Files.readAllBytes(file.toPath());}
public FileOutputStream startWrite()throws Exception{return new FileOutputStream(file+".new");}
public void finishWrite(FileOutputStream s)throws Exception{s.close();Files.move(new File(file+".new").toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING);}
public void failWrite(FileOutputStream s)throws Exception{s.close();new File(file+".new").delete();} public void delete(){file.delete();}}`,
  'android/util/Base64.java': `package android.util;public class Base64 {public static final int NO_WRAP=2;public static byte[] decode(String s,int flags){return java.util.Base64.getDecoder().decode(s);}}`,
  'com/facebook/react/bridge/Promise.java': `package com.facebook.react.bridge;public interface Promise {void resolve(Object value);void reject(String code,String message);}`,
  'com/facebook/react/bridge/ReactMethod.java': `package com.facebook.react.bridge;public @interface ReactMethod {}`,
  'com/facebook/react/bridge/ReactApplicationContext.java': `package com.facebook.react.bridge;import java.io.File;public class ReactApplicationContext {private final File dir;public ReactApplicationContext(File d){dir=d;}public File getNoBackupFilesDir(){return dir;}}`,
  'com/facebook/react/bridge/ReactContextBaseJavaModule.java': `package com.facebook.react.bridge;public abstract class ReactContextBaseJavaModule {public ReactContextBaseJavaModule(ReactApplicationContext context){} public abstract String getName();}`,
  'cn/toside/music/mobile/utils/StorageCheck.java': `package cn.toside.music.mobile.utils;
import java.io.*;import java.nio.file.*;import java.security.*;import org.json.*;import com.facebook.react.bridge.*;
public class StorageCheck {
static class Result implements Promise {Object value;String error;public void resolve(Object v){value=v;}public void reject(String c,String m){error=c;}void ok(){if(error!=null)throw new AssertionError(error);}}
static void check(boolean v){if(!v)throw new AssertionError();}
public static void main(String[] args)throws Exception {
File dir=new File(args[0]);dir.mkdirs();ReactApplicationContext context=new ReactApplicationContext(dir);
check(Security.getProvider("AndroidKeyStore")==null);
MusicCredentialModule module=new MusicCredentialModule(context); Result r=new Result();module.getQQAccount(r);r.ok();check(r.value==null);
String qq=new JSONObject().put("qqmusic_uin","123").put("qqmusic_key","fixture-cookie").toString();
r=new Result();module.setQQAccount(qq,r);r.ok();check(new File(dir,"qq-account.json").isFile());
module=new MusicCredentialModule(context);r=new Result();module.getQQAccount(r);r.ok();check(new JSONObject((String)r.value).getString("qqmusic_key").equals("fixture-cookie"));
r=new Result();module.setQQDailyKey("123","qmk-fixture_daily_123456",r);r.ok();r=new Result();module.getQQDailyKey("456",r);r.ok();check(r.value==null);
r=new Result();module.getQQDailyKey("123",r);r.ok();check(r.value.equals("qmk-fixture_daily_123456"));
String kg=new JSONObject().put("userId","123").put("token","fixture-token").put("mid","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").toString();
r=new Result();module.setKugouSession(kg,r);r.ok();r=new Result();module.getKugouSession(r);r.ok();check(new JSONObject((String)r.value).getString("userId").equals("123"));
r=new Result();module.setQQAccount("{}",r);check("credential_storage".equals(r.error));r=new Result();module.getQQAccount(r);r.ok();check(r.value.equals(qq));
Files.writeString(new File(dir,"qq-account.enc").toPath(),"legacy-fixture");
r=new Result();module.clearQQAccount(r);r.ok();check(!new File(dir,"qq-account.json").exists()&&!new File(dir,"qq-account.enc").exists());
r=new Result();module.getQQAccount(r);r.ok();check(r.value==null);
r=new Result();module.clearQQDailyKey(r);r.ok();r=new Result();module.clearKugouSession(r);r.ok();
String old="{\\"iv\\":\\"AAAAAAAAAAAAAAAA\\",\\"data\\":\\"AAAA\\"}";
Files.writeString(new File(dir,"qq-account.enc").toPath(),old);r=new Result();module.getQQAccount(r);check("credential_storage".equals(r.error));check(Files.readString(new File(dir,"qq-account.enc").toPath()).equals(old));
r=new Result();module.setQQAccount(qq,r);r.ok();r=new Result();module.getQQAccount(r);r.ok();check(r.value.equals(qq));
System.out.println("PASS: native app-private persistence/restart, owner isolation, validation, logout, legacy retention and fresh authorization without AndroidKeyStore");
}}
`,
}
try {
  const files = []
  for (const [name, source] of Object.entries(sources)) {
    const file = path.join(folder, name)
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); files.push(file)
  }
  files.push(path.resolve(__dirname, '../android/app/src/main/java/cn/toside/music/mobile/utils/MusicCredentialModule.java'))
  const classes = path.join(folder, 'classes'); fs.mkdirSync(classes)
  execFileSync('javac', ['-cp', jsonJar, '-d', classes, ...files], { stdio: 'inherit' })
  execFileSync('java', ['-cp', `${classes}${path.delimiter}${jsonJar}`, 'cn.toside.music.mobile.utils.StorageCheck', path.join(folder, 'no-backup')], { stdio: 'inherit' })
} finally { fs.rmSync(folder, { recursive: true, force: true }) }

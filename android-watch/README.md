# 小学习机 · ColorOS 手表包

- `applicationId`: `com.xiaoxuexiji.watch`
- `versionName`: `0.1.0`
- ABI: `armeabi-v7a` only
- WebView 壳 + `StudyHubNative.deepseekChat` 原生请求绕过 CORS
- `setDefaultFocusHighlightEnabled(false)` 去掉系统黄框

```bash
../scripts/sync-www.sh
./gradlew :app:assembleRelease
../scripts/publish-apk.sh
```

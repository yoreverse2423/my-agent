# Yore's agent · ColorOS 手表包

- `applicationId`: `com.xiaoxuexiji.watch`
- `versionName`: `0.3.5`
- ABI: `armeabi-v7a` only
- WebView 壳 + `StudyHubNative.deepseekChat` / `StudyHubNative.deepseekSearch` 原生请求绕过 CORS
- `StudyHubNative.httpGet(id, cb, url)` 仅允许 https，作为通用 GET 备用通道
- `setDefaultFocusHighlightEnabled(false)` 去掉系统黄框

```bash
../scripts/sync-www.sh
./gradlew :app:assembleRelease
../scripts/publish-apk.sh
```

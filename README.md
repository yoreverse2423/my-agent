# Yore's agent

网页 + ColorOS 手表 APK：看监工头bot / 科目 bot 下发的**今日任务**，用 **DeepSeek** 问题目，把学习存档同步回 GitHub，方便主 bot 分析薄弱点并调整计划。

- Pages：https://yoreverse2423.github.io/my-agent/
- 仓库：https://github.com/yoreverse2423/my-agent
- 对标：[小单词机](https://github.com/yoreverse2423/English)

## 学生怎么用

1. 打开网页（手表 APK 网页验证后再提供）。
2. **设置 → GitHub 与令牌**：填 Owner `yoreverse2423`、Repo `my-agent`，粘贴有 **Contents 读写** 的 PAT，保存。**必须先保存令牌**：未保存时首页「今日任务」和「每日任务」只显示中文引导空态，不会加载本地缓存、样例或公开 raw 文件。
3. **设置 → DeepSeek**：到 [API Keys](https://platform.deepseek.com/api_keys) 创建密钥，粘贴保存（只存本机，不进仓库）。
4. 点右上角 **同步** 或「存档 → 拉取任务」，拉取成功后才能在 **今日** 看到任务、勾完成、写备注。没有令牌时点同步会提示先保存令牌。
5. **问答**：底部单行输入 → 发送。发送后会显示「正在思考」等待状态。请在真实浏览器里确认 DeepSeek 是否被 CORS 拦截；公式/Markdown 由本地 KaTeX 渲染。
   - 输入框上方可开 **搜索**：默认走 **DeepSeek 官方联网搜索**（`/v1/tools/search`，与问答共用同一把 DeepSeek Key），再由 DeepSeek（默认 `deepseek-flash`）整理，回答末尾附来源链接。
   - 博查 / Tavily 为可选覆盖：在 **设置 → 联网搜索** 填写后优先使用；不填则用 DeepSeek 联网搜索。
6. 到 **存档 → 上传存档**。问答「清屏」只藏界面；完整对话在 `days[].chats`，主 bot 自行分析。

## 手表 APK

- 下载：[downloads/xiaoxuexiji-watch-armeabi-v7a.apk](downloads/xiaoxuexiji-watch-armeabi-v7a.apk)（versionName **0.3.6**，armeabi-v7a）
- 校验：同目录 `.sha256`
- 安装：`adb install -r xiaoxuexiji-watch-armeabi-v7a.apk`
- 内置最新网页资源；DeepSeek 问答与联网搜索走原生桥；设置里填 Token/Key（只存手表本地）


## Bot 协作

见 [docs/bot-protocol.md](docs/bot-protocol.md)。数据文件：

| 路径 | 谁写 | 谁读 |
|------|------|------|
| `data/daily-tasks.json` | 监工头bot / 科目 bot | 学生 App（只下载） |
| `data/student-archive.json` | 学生 App 上传 | 监工头bot 分析 |
| `data/bot-notes.json` | 监工头bot（可选） | bot 自己防重复 |

学习日：`Asia/Shanghai`，凌晨 **4:00** 换日。

## 本地开发（手表包暂缓）

```bash
# 同步网页进 APK assets
./scripts/sync-www.sh
cd android-watch && ./gradlew :app:assembleRelease
# 产物复制到 downloads/
./scripts/publish-apk.sh
```

Android SDK / JDK 路径写在 `android-watch/local.properties`（已 gitignore）。

## 安全

- **不要**把 DeepSeek Key 或 GitHub Token 提交进 git。
- Token 与 Key 仅存在浏览器 `localStorage` / 应用 WebView 存储。

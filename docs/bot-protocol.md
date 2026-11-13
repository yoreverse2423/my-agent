# Yore's agent · Bot 协议（v0.1）

给学生端（网页 / 手表 APK）看的任务与存档镜像。完整备考约定仍以 `/workspace/gaokao/protocol.md` 为准；`gaokao/daily/` 可继续保留，Yore's agent 仓库是**学生可读的 JSON 镜像**。

仓库：`yoreverse2423/my-agent`  
Pages：`https://yoreverse2423.github.io/my-agent/`

仓库内样例 `daily-tasks.json` 带 `demo: true` / 【演示】标题，**不是真实作业**；正式任务由监工头bot 写入并去掉演示标记。

## 角色

- **监工头bot**（主 bot）：每天把任务写入 `data/daily-tasks.json`；定期读 `data/student-archive.json`，分析完成情况与薄弱点；再通知对应科目 bot 调整计划；可选写入 `data/bot-notes.json` 避免重复催。
- **科目 bot**：可向监工头建议任务；或在授权下直接追加 `daily-tasks.json` 中本科条目。
- **学生 App**：只下载任务；本地勾完成 / 问答摘要后上传 `student-archive.json`。

## 学习日

`Asia/Shanghai`，凌晨 **4:00** 换日。`date` 字段格式 `YYYY-MM-DD`。

## `data/daily-tasks.json`（bot 写，学生只读）

学生同步时**下载覆盖**本地任务缓存，**不**回写此文件。

```json
{
  "schemaVersion": 1,
  "timezone": "Asia/Shanghai",
  "updatedAt": "2026-11-08T12:00:00+08:00",
  "tasks": [
    {
      "id": "math-2026-11-08-1",
      "date": "2026-11-08",
      "subject": "数学",
      "from": "监工头bot",
      "title": "导数小题 20 分钟",
      "body": "……（不要附答案）",
      "slot": "午间",
      "status": "active",
      "priority": 1
    }
  ]
}
```

约定：

- `id` 全局唯一，建议 `{subjectEn}-{date}-{n}`。
- `status`：`active` | `cancelled` | `done`（学生完成以存档 `completedTaskIds` 为准；bot 不必改 status）。
- `slot`：与 gaokao 协议一致时可用 `午间` / `傍晚` / `晚自习` / `夜间` 等。
- 任务量匹配 20–30 分钟；**不提前给答案**。

写入方式（Contents API 或直接改仓库后 push）：

1. 读出当前文件（保留其它日期未过期任务，或只保留近 7 天）。
2. 替换/追加今日条目，更新 `updatedAt`（带 `+08:00`）。
3. 提交 message 建议：`chore(tasks): 2026-11-08`。

也可从 `gaokao/daily/<日期>/tasks.md` 整理后镜像过来。

## `data/student-archive.json`（学生上传；监工头提取问答后须清空当天记录）

```json
{
  "schemaVersion": 1,
  "timezone": "Asia/Shanghai",
  "updatedAt": "2026-11-08T22:00:00+08:00",
  "days": [
    {
      "date": "2026-11-08",
      "completedTaskIds": ["math-2026-11-08-1"],
      "notes": "导数几何意义还不熟",
      "weakTopics": [{"subject": "数学", "topic": "导数几何意义", "detail": "符号判断易错"}],
      "chatSummary": [
        {"subject": "数学", "q": "导数几何意义是什么", "aBrief": "切线斜率…", "at": "2026-11-08T19:10:00+08:00"}
      ],
      "chats": [],
      "clearedChatIds": ["m_abc", "m_def"],
      "minutesSpent": 35
    }
  ]
}
```

- **完成勾选 / 备注 / 薄弱点**：仍由学生端写入；科目 bot **不要和学生抢写这些字段**。
- **问答 / 搜索记录（`chats`、`chatSummary`）**：监工头bot **每天提取完后必须从仓库删掉当天已提取条目**，否则学生端同步合并时旧记录会再次冒出来。
- 学生端合并：先 GET 远程，按 `date` 合并后再 PUT——`completedTaskIds` 取并集；`weakTopics` 合并去重；`notes` 两侧都有且不同时按 `本地 + "\n---\n" + 远程` 拼接（本地在前）；`minutesSpent` 取较大值；`clearedChatIds` 取并集；`chats` / `chatSummary` 先按原规则并集，再**去掉** `clearedChatIds` 里的 id（摘要无 id 的按已清除对待）。PUT 遇 409 会重新 GET 合并再试，最多 2 次。保留约 30 天。

### `days[].chats`（完整问答，含搜索）

学生端把每条问答以稳定 `id` 写入 `chats`（例如 `m_xxx`）。**清屏只隐藏界面**（之后提问也不再带上已隐藏的上下文），不删本地/远程 `chats`，刷新后仍按「清屏游标」隐藏已看过的气泡；上传仍带尚未被提取清除的对话。不要依赖用户点「生成摘要」。

```json
"chats": [
  {"id":"m_abc","role":"user","content":"导数几何意义？","subject":"数学","at":"2026-11-08T19:10:00+08:00"},
  {"id":"m_def","role":"assistant","content":"...","subject":"数学","at":"2026-11-08T19:10:05+08:00"}
]
```

合并规则：按 `id` 去重并集；无 `id` 的旧条目用 `legacy_<at>_<role>_<content前缀>` 兜底；再过滤 `clearedChatIds`。`chatSummary` 仍兼容旧数据，新客户端以 `chats` 为准。

### 监工头bot：每日提取搜索/问答后清空（强制）

对学习日（Asia/Shanghai，04:00 换日）或约定要处理的日期：

1. GET `data/student-archive.json`（需 Contents 写权限的 token）。
2. 读取该日 `chats`（优先）与 `chatSummary`：提取学生搜索与问答，写入本机分析笔记（如 `gaokao/daily/<日>/` 或 `data/bot-notes.json`），再按需 `SendToAgent` 通知科目 bot。
3. **立刻写回仓库清空当天已提取的问答记录**：
   - 把该日现有每条 `chats[].id`（及无 id 时的 legacy id）并入 `clearedChatIds`；
   - 将该日 `chats`、`chatSummary` 设为 `[]`；
   - **保留** `completedTaskIds` / `notes` / `weakTopics` / `minutesSpent`；
   - 更新顶层 `updatedAt`（`+08:00`），PUT 回 `student-archive.json`（带 sha，冲突则重新 GET 再清再 PUT）。
4. 科目 bot **不要**把已提取的对话再写回 archive；需要跟进时用监工头通知或 bot-notes。
5. 未提取前不要空清；提取与清空应在同一轮完成，避免学生同步又把旧气泡合并回来。

### 监工头bot 读存档后建议流程

1. 看今日 `completedTaskIds` vs `daily-tasks` 里 active 任务 → 完成率。
2. 读 `notes`、`weakTopics`、`chats`/`chatSummary` → 归纳薄弱点；**提取后按上一节清空当天问答**。
3. `SendToAgent` 通知对应科目 bot（一句话：科目、问题、建议调整）。
4. 可选写入 `data/bot-notes.json`：

```json
{
  "schemaVersion": 1,
  "timezone": "Asia/Shanghai",
  "updatedAt": "2026-11-08T22:30:00+08:00",
  "notes": [
    {
      "date": "2026-11-08",
      "summary": "数学导数几何意义薄弱；英语任务已完成",
      "notified": ["数学bot"],
      "at": "2026-11-08T22:30:00+08:00"
    }
  ]
}
```

## 与 gaokao 协议的衔接

| gaokao | StudyHub |
|--------|----------|
| `gaokao/daily/<日>/tasks.md` | 镜像为 `data/daily-tasks.json` |
| 科目汇报 / summary.md | 可参考 `student-archive` 的 notes / chatSummary |
| 知识库 / 错题本 | 仍写 gaokao/knowledge；存档只给信号 |

时段分工、晚自习离线背书、不提前给答案等规则**原样遵守** gaokao/protocol.md。

## DeepSeek（学生端）

学生在 App 内自备 Key。系统提示为广西高考一轮辅导、步骤清晰。Bot 侧大批量生成仍用 `/workspace/gaokao/tools/deepseek.py`，与学生端 Key 分离。

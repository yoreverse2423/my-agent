# 小学习机 · Bot 协议（v0.1）

给学生端（网页 / 手表 APK）看的任务与存档镜像。完整备考约定仍以 `/workspace/gaokao/protocol.md` 为准；`gaokao/daily/` 可继续保留，StudyHub 是**学生可读的 JSON 镜像**。

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

## `data/student-archive.json`（学生上传，bot 只读）

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
      "minutesSpent": 35
    }
  ]
}
```

Bot **不要和学生抢写**：读完分析即可。上传冲突策略在学生端：先 GET 远程，按 `date` 合并后再 PUT——`completedTaskIds` 取并集；`chatSummary` 按 `(at|q)` 去重合并；`weakTopics` 合并去重；`notes` 两侧都有且不同时按 `本地 + "\n---\n" + 远程` 拼接（本地在前）；`minutesSpent` 取较大值。PUT 遇 409 会重新 GET 合并再试，最多 2 次，不盲覆盖。保留约 30 天。

### `days[].chats`（完整问答，推荐）

学生端把每条问答以稳定 `id` 写入 `chats`（例如 `m_xxx`）。**清屏只隐藏界面**，不删本地/远程 `chats`，刷新后仍按「清屏游标」隐藏已看过的气泡，但上传仍带全部原始对话，供监工头bot 自行分析。不要依赖用户点「生成摘要」。

```json
"chats": [
  {"id":"m_abc","role":"user","content":"导数几何意义？","subject":"数学","at":"2026-11-08T19:10:00+08:00"},
  {"id":"m_def","role":"assistant","content":"...","subject":"数学","at":"2026-11-08T19:10:05+08:00"}
]
```

合并规则：按 `id` 去重并集；无 `id` 的旧条目用 `legacy_<at>_<role>_<content前缀>` 兜底。`chatSummary` 仍兼容旧数据，新客户端以 `chats` 为准。


### 监工头bot 读存档后建议流程

1. 看今日 `completedTaskIds` vs `daily-tasks` 里 active 任务 → 完成率。
2. 读 `notes`、`weakTopics`、`chatSummary` → 归纳薄弱点。
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

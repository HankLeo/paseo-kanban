# AGENTS.md — paseo-kanban

给 AI coding agent 的项目规则与上下文。改动前请先读完本文件；涉及插件 API 细节时，优先查「参考依赖」列出的 paseo 源仓库文件，不要凭记忆猜 API。

## 项目概述

- Paseo 0.8 看板插件（plugin id：`paseo-kanban`，`requirements.paseo: ^0.8.0`）。
- 以 **session（agent 会话）为卡片粒度**聚合本机与远程 daemon 的活跃会话，提供泳道 / 列表 / 甘特图三种视图。
- 安装方式：`paseo plugin install <本仓库绝对路径>`（directory source，信任模式运行）。

## 仓库结构

```
paseo-plugin.json          # 插件 manifest；改 paseo 版本要求在这里
index.client.tsx           # 客户端入口：addSurface/addSidebarItem/addWorkspacePanel/addCommandCenterItem + navigation-bus 绑定
index.server.ts            # daemon 侧入口：全部 RPC handler + registerSettings
shared/                    # 两端共用（纯逻辑，禁止 Node/RN API）
  model.ts                 #   基础纯函数：activity 派生、PR 摘要、时间格式化、provider 图标/标签
  session-model.ts         #   SessionCard 模型、泳道 lane 划分、甘特条计算（全部纯函数，核心逻辑都在这里）
  contracts.ts             #   RPC 契约（命名空间 paseo-kanban.*）+ zod schema
  preferences.ts           #   defineSettings 视图偏好（view/laneDimension/ganttWindow）
  session-model.test.ts    #   纯函数单测
server/                    # daemon 子进程（可用 Node API）
  snapshot.ts              #   多 host 盘点（持久 PaseoClient 连接、30s 缓存、离线快照）
  hosts.ts                 #   手动远程 host 注册表（hosts.json，0600）
  app-hosts.ts             #   app host 注册表镜像（app-hosts.json，全量替换语义）
  unread-marks.ts          #   未读标记持久化（marks.json）
  open-agent.ts            #   远程会话跳转（paseo agent open --server CLI）
  paseo-home.ts            #   PASEO_HOME 解析
  *.test.ts                #   node:test 单测
client/                    # app 内运行（仅 React Native API）
  kanban-surface.tsx       #   主 surface：数据装配、过滤、工具栏、视图分发
  navigation-bus.ts        #   entry 级 emitter，让 surface 能调 client.openPanel
  web.ts                   #   【唯一允许 DOM 全局的文件】读 app host 注册表（localStorage，Platform.OS==="web" 门控）
  views/                   #   swimlane-view / list-view / gantt-view
  components/              #   session-card / filter-bar / session-detail-panel
```

## 硬性约束（违反即构建失败或线上 bug）

1. **运行时边界**：根目录只允许两个入口文件；`client/` 禁止 import `server/`（反之亦然）；`shared/` 禁止 Node/RN API；client 里禁止任何 `node:` import（含类型传递依赖）。
2. **移动端兼容**：client 只用 React Native 组件（`View/Text/Pressable/ScrollView/TextInput/ActivityIndicator/Linking`），禁止 HTML 元素、`className`、`onClick`；DOM 全局只允许出现在 `client/web.ts` 且必须 `Platform.OS === "web"` 门控。改完 client 必跑审计：
   ```bash
   grep -rnE "document\.|window\.|localStorage|navigator\.|className=|onClick=" client/ index.client.tsx
   # 唯一合法命中：client/web.ts 里的 localStorage
   ```
3. **主题**：所有颜色必须取自 `theme.colors`（11 个 token），样式用 `useMemo(() => createStyles(theme, compact), [theme, compact])` 重建；theme 未覆盖的状态色走 `shared/colors.ts` 的镜像调色板（按 `themeScheme` 明暗取值）。禁止硬编码颜色（identity 调色板除外）。
4. **布局**：`layout.compact` 为 true 时必须有合理的紧凑形态（泳道退化分节纵列、工具栏图标化）。
5. **zod 契约**：所有 RPC 输入输出在 `shared/contracts.ts` 定义，两端校验；改契约需同步 handler 与调用点。
6. **提交纪律**：在任何代码修改前先创建 feature 分支（`git checkout -b feature/<描述>`），严禁直接提交/推送到 main。

## 关键设计（改之前先理解）

- **数据流**：客户端 TanStack Query（30s 轮询）→ RPC `snapshot.get` → server 端本地用注入的 `paseo`、远程用持久 `PaseoClient`（最多 21 host 并发、12s 单 host 超时、失败 host 回退最近成功快照并标 `cached`）→ 返回原始 workspaces/agents/marks → **客户端**用 `buildSessionCards` 纯函数装配卡片（过滤/排序/lane/甘特都在客户端做）。
- **session 粒度**：根 agent 为卡片，子 agent 经 `labels["paseo.parent-agent-id"]` 归组嵌在父卡片内；archived agent / archiving workspace 直接过滤。
- **未读标记**：插件私有（server 端 marks.json，0600），idle + 有效 mark → 显示 unread；打开会话时自动清除。**paseo 未开放设置原生未读的 API，无法同步到 app 侧边栏绿点**（已确认 `PaseoAgentHandle` 无此方法）。
- **远程 host 双来源**：手动 `hosts.json`（Add host）+ 自动镜像 `app-hosts.json`（客户端经 `client/web.ts` 读 app 注册表 `@paseo:daemon-registry`，随快照周期全量同步；仅支持 directTcp/relay，SSH 隧道类 app 专有连接跳过；同名时手动优先；`localServerId` 排除本机）。
- **点击行为**：`navigation.openAgent({agentId})` 跳转 reveal 聊天页 + `navigation-bus` 调 `client.openPanel("session-detail", {workspaceId, agentId, location:"explorer"})` 展开侧边栏详情面板；远程 host 降级为 `paseo agent open --server` CLI（需要 host 带 serverId，relay 天然有、directTcp 由 app 镜像注入）。
- **视图偏好**：`useSettings(boardPreferences)`（host 作用域持久化），未 ready 时用默认值。

## 已知平台限制（不要试图"修复"，是 paseo 侧的缺口）

- 插件没有内置侧边栏 reveal API（explorer 侧边栏只列 Files/Changes/PR，不列 agent）→ 用 openPanel explorer 详情面板替代。
- agent/workspace 只有 createdAt/updatedAt/activityAt/statusEnteredAt/attentionTimestamp 等字段，**无历史状态流转记录** → 甘特条是生命期而非状态迁移。
- 全局 surface 里没有 `PluginClientStateProvider`，`useWorkspace/useAgent` 只在 workspace 面板内可用 → surface 数据走 RPC。
- app.paseo.sh 托管 web app 构建可能落后于桌面 app：旧构建上插件面板（openPanel）会静默无效，属宿主版本问题，不要在插件侧绕行。
- iOS/Android 无 localStorage，app host 自动镜像静默关闭（手动 Add host 仍可用）。

## 开发命令

```bash
npm install                # 首次
npm run typecheck          # 改完必跑，零错误为准
npm test                   # tsx --test server/*.test.ts shared/*.test.ts
paseo plugin reload paseo-kanban   # 改代码后重载（禁止重启 daemon——会杀掉正在跑的会话）
paseo plugin logs paseo-kanban     # daemon 侧日志
paseo plugin ls            # 确认 running 无 error
```

## 验证要求（UI 改动必做）

1. `npm run typecheck && npm test` + 上面的移动端审计 grep。
2. `paseo plugin reload paseo-kanban` 且 `paseo plugin ls` 为 running。
3. 浏览器实测：用 Tabbit（`~/.local/bin/tabbit-cli`）打开 `https://app.paseo.sh`（已连本机 daemon）或直接访问看板 URL：
   `https://app.paseo.sh/h/<serverId>/plugin/paseo-kanban/sidebar/kanban?pluginId=paseo-kanban&contributionKind=sidebar&contributionId=kanban`
   端到端点击验证改动点 + 截图确认渲染 + 检查相邻功能无回归；主题切换（Settings→外观）后颜色仍正确；窄视口 compact 正常。
4. 不要在用户的真实数据上测破坏性操作（归档、改名）；标记未读可用 marks.json 落盘核对。

## 参考依赖（相对本仓库的路径）

- **`../paseo`**（paseo 源仓库，API 事实来源）：
  - 插件客户端 API 类型：`packages/plugin/src/client/contracts.ts`（addSurface/addWorkspacePanel/openPanel/导航/SettingsState）
  - PluginTheme 与快照类型：`packages/plugin/src/contracts.ts`
  - 面板内 hooks：`packages/plugin/src/client/client-state.tsx`
  - app 侧插件宿主实现：`packages/app/src/plugins/`（surface-screen、client-runtime、navigation、actions、workspace-panels/）
  - 协议 schema（PaseoAgent/PaseoWorkspace 字段）：`packages/protocol/src/messages.ts`
  - 官方插件参考（维护者指引）：`public-docs/plugins/v0.8/reference.md`、`docs/plugins.md`
  - 示例插件：`plugin-examples/`（local-plugin 实时订阅、settings 设置、modal-ui 面板）
- **`../paseo-fleet-dashboard`**（本项目的代码起点，MIT/Apache-2.0，见 LICENSE/NOTICE）：多 daemon 聚合、hosts 管理、离线缓存、状态派生的原始实现，移植后已独立演化，**两仓库零依赖零共享**。
- 仓库内文档：`README.md`（用户视角功能说明与已知限制）。

## 血统与许可

以 paseo-fleet-dashboard 一次性复制为起点（其上游：paseo-x-comms Apache-2.0、agents-dash-list MIT）。改动保持 MIT；LICENSE、LICENSE-APACHE、NOTICE 必须保留并随新来源补充。

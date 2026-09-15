# Paseo Kanban

一个 Paseo 0.8 看板插件：以 **session（agent 会话）为卡片粒度**，聚合本机与远程 daemon 上的活跃会话，提供**泳道 / 列表 / 甘特图**三种可切换视图。主题自动跟随 Paseo app。

## 安装

```sh
npm install
npm run typecheck
paseo plugin install "$PWD"
```

在侧边栏打开 **Kanban**。需要远程 daemon 时，在远程机器上运行 `paseo daemon pair --json`，然后在看板顶部 **Add host** 粘贴配对 URL（或直接填 daemon 地址）。

## 三种视图

| 视图 | 说明 |
|---|---|
| **泳道（Swimlane）** | 行 = 泳道（可按 workspace / host / project 切换），列 = 5 种会话状态（Waiting / Unread / Working / Failing / Idle）。窄屏自动退化为按泳道分节的纵向列表。 |
| **列表（List）** | 按 workspace 分节的会话卡片流，按状态优先级 + 最近活动排序；节头提供 workspace 改名与归档。 |
| **甘特图（Gantt）** | 行 = 会话（按 workspace 分节），条 = 会话生命周期（创建 → 最近活动，进行中的画到当前时刻），按当前状态着色；时间窗 24h / 7d / 30d 可切换，带 "now" 参考线。 |

视图、泳道维度、时间窗会通过插件设置按 host 持久化。

## 点击行为

- **点卡片 / 甘特条 / 子会话条目**：本机会话 → 跳转打开该会话（`navigation.openAgent`），并**展开 explorer 侧边栏**显示 Session detail 面板（会话与所属 workspace 的实时信息、改名/归档操作）；远程会话 → 通过 `paseo agent open --server` 在桌面端打开。
- **点卡片上的 workspace 名**：跳转到该 workspace 页面。
- 子 agent 会话嵌在父卡片内，可独立点击直达。

## 能力清单

- 多 daemon 聚合：本机 + 最多 20 个远程 host，30s 快照缓存 + 手动刷新。远程 host 有两个来源：
  - **自动镜像（推荐）**：看板客户端会读取 Paseo app 自己的 host 注册表（web/桌面端经 AsyncStorage 落地的 `@paseo:daemon-registry`）并镜像到 daemon 侧——在 Paseo 里添加/移除 host 后，看板在下一个刷新周期（≤30s）自动跟随，无需任何插件侧配置。仅支持 directTcp 与 relay 连接；SSH 隧道类连接 app 专有，无法镜像。
  - **手动添加**：顶部 **Add host**（与 fleet-dashboard 同链路，配对 URL / 直连地址），适合看板运行在另一台机器的 daemon 上、读不到本机 app 注册表的场景。
  - 两个来源独立存储（app-hosts.json 为全量镜像、每次同步替换；hosts.json 为手动管理），手动条目在重名时优先。
- host、agent provider（All providers / Claude / Codex …，按快照中真实存在的 provider 生成）与 5 种会话状态的过滤。
- 会话快捷操作：打开、归档（进行中/等待确认的会先确认）、标记/取消未读。**未读标记为插件私有**（存于 marks.json，打开会话时自动清除），paseo 未开放设置原生未读/attention 的 API，因此不会同步到 paseo 侧边栏的绿点。
- workspace 操作：内联改名、归档（列表视图节头与详情面板内均有入口）。
- 离线容错：host 不可达时展示最近一次成功快照并标记 `cached`，不阻塞其他 host。
- 主题跟随：全部颜色取自 `theme.colors`，随 Paseo 主题（含自定义主题）实时更新；明暗方案从背景亮度推导。
- 移动端适配：仅使用 React Native 组件，compact 布局下泳道与甘特自动退化。

## 数据存储

远程 host 连接串与本地缓存均以仅属主权限存放：

```text
$PASEO_HOME/plugin-data/paseo-kanban/app-hosts.json   # app host 注册表镜像（凭据级，全量替换）
$PASEO_HOME/plugin-data/paseo-kanban/hosts.json      # 手动添加的远程 host（凭据级，含配对材料）
$PASEO_HOME/plugin-data/paseo-kanban/snapshot.json   # 最近一次成功快照（离线展示用）
$PASEO_HOME/plugin-data/paseo-kanban/marks.json      # 会话未读标记
```

与 fleet-dashboard **不共享任何数据**；两个插件可独立安装、互不影响。

## 已知限制

- Paseo 不暴露会话的历史状态流转，甘特条表示**生命期**而非状态迁移。
- 看板为只读 + 快捷操作，不支持拖拽改状态（状态是从实时数据派生的）。
- 远程 host 的「展开侧边栏定位」不可用（app 侧边栏只连本机 daemon），远程会话跳转走 CLI 打开。
- Session detail 面板依赖当前版本的插件面板 API：桌面 app 0.8.0 可用；旧版托管 web app（app.paseo.sh）构建较老，面板不会展开（不影响跳转与看板本体）。

## 来源

本项目以 [`paseo-fleet-dashboard`](../paseo-fleet-dashboard) 的一次性代码复制为起点，改造为 session 粒度的看板；其跨 daemon 盘点方案改编自 [`paseo-x-comms`](https://github.com/xpufx/paseo-x-comms)（Apache-2.0），最初设计源自 [`agents-dash-list`](https://github.com/panrafal/paseo-plugins/tree/main/agents-dash-list)（MIT）。详见 `LICENSE` 与 `NOTICE`。

## 开发

```sh
npm run typecheck   # 类型检查
npm test            # server 与 shared 纯函数单测（tsx --test）
paseo plugin reload paseo-kanban   # 改完代码后重载
paseo plugin logs paseo-kanban     # 查看 daemon 侧日志
```

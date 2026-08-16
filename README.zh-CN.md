# dsh-weixin-ui

DeepSeek Harness(DSH)设置页里的微信桥管理面板。

在 DSH 设置 → 微信桥 里:扫码登录微信 bot、选 agent 模式(标准/PTC/极简/创造/自定义 preset)、配模型与思考强度、管凭据。配合独立进程 [weixin-bot](https://github.com/Culeot/dsh-weixin-bridge)(iLink 官方通道)使用——bot 通过 DSH web 会话 API 对话,**真会话上下文,preset 的插件(记忆/MCP/skill)全加载**。

## 功能

- **设置页面板**:连接状态/扫码登录/凭据管理/删除机器人,与通用设置同级。
- **Agent 模式**:标准 / PTC / 极简 / 创造(官方 preset)+ 自定义 agent(选你的用户 preset,如 potato)。
- **模型与思考强度**:从 DSH 动态读取可用模型及其思考强度选项;留空 = 跟主 agent 同配置。
- **访问控制**:仅允许扫码登录的账号(owner)连接。
- **会话上下文**:微信消息走 DSH web 会话 API,上下文连续,preset 插件生效(记忆、MCP、skill 都有)。

## 架构

```
微信 → weixin-bot(bridge.js,独立进程,iLink 官方通道)
        → DSH web 会话 API(session.create / prompt / history)
        → 按 UI 选择的 preset 建会话 → 真上下文执行 → 回复回微信
```

- 插件本体(`dsh-weixin-ui`):DSH 设置面板 + RPC(`/dsh-weixin-login`:状态/扫码/配置/模型目录)。
- 独立进程(`weixin-bot`):微信消息收发 + 会话编排,读同一份配置(`~/.dsh/weixin-bridge-config.json`)+ 账号(`~/.dsh/weixin-bot-account.json`)。
- 免公网:腾讯官方 iLink Bot 通道,不需要公网 IP、不需要电脑端微信。

## 安装

```bash
# 1. web profile 加依赖
cd ~/.dsh/profiles/web
npm install dsh-weixin-ui
```

```yaml
# 2. agent preset 加一行(~/.dsh/.agent-presets/<preset>/agent.cordis.yml)
- id: weixin-ui
  name: 'dsh-weixin-ui'
```

```bash
# 3. 重启 DSH,设置 → 微信桥 出现面板
# 4. 独立进程桥(消息收发):node weixin-bot/bridge.js(建议配开机自启/看门狗)
```

## 独立进程(weixin-bot)

面板只负责登录与配置,**消息收发由独立进程 bridge.js 完成**,两者读同一份账号/配置文件。

- 来源:GitHub [Culeot/dsh-weixin-bridge](https://github.com/Culeot/dsh-weixin-bridge)(或本地 weixin-bot 项目目录)
- 运行:`node bridge.js`(需要 Node ≥ 20,DSH web 在跑)
- 开机自启:Windows 计划任务/注册表 Run 里加一条;崩溃可配看门狗自动拉起
- 日志:`bridge.log`(bridge.js 同目录)

## 配置

| 项 | 说明 |
|---|---|
| Agent 模式 | 标准/PTC/极简/创造/自定义 agent(preset) |
| 模型/思考强度 | 动态读 DSH 模型目录;留空 = 跟主 agent 同配置 |
| 工作目录 | agent 执行目录(留空 = DSH 默认) |
| 访问控制 | 固定仅 owner |

配置存 `~/.dsh/weixin-bridge-config.json`,改动自动保存,bridge 实时读取。

## 要求

- DSH web 运行中(微信 bot 复用其会话)
- Node.js ≥ 20(weixin-bot 独立进程)

## License

MIT。非官方项目,与 DeepSeek 官方无隶属关系。

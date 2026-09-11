# dsh-update-notifier

`dsh web` 启动时自动检测 `@deepseek-ai/dsh` 是否有可更新版本。

## 功能

- 启动后 5 秒首检 + 每 6 小时轮询 + 手动“立即检查”
- 对比本地 `package.json#version` 与 `registry.npmmirror.com`（回落 `registry.npmjs.org`）的 `dist-tags.latest / next`，`semver` 兼容 `x.y.z-rc.n`
- 有更新时：
  - `shell.overlay` 顶部居中卡片（可关闭，`localStorage` 按版本记忆 dismiss，下次新版本自动复现）
  - 卡片关闭后，`conversation.input.dock` 输入框上方显示轻量胶囊，点击可重新展开
  - 卡片内提供 `npm i -g @deepseek-ai/dsh@{latest|next}` 一键复制 + Release notes 链接

## 界面

卡片跟随 DSH 主题（浅色 / 深色），全部颜色取自 `--dsw-alias-*` 设计变量，无硬编码色值。

- 状态色：有更新 = business 蓝，已最新 = success 绿，检查失败 = warn 橙
- 版本来源以 npm dist-tags + GitHub tag 胶囊呈现，命中当前版本的一枚高亮并标注「当前」
- 右上角为图标操作：立即检查（检查中转圈）、常驻、关闭
- 依赖的 hover / focus / 动画规则由插件自带的一个 `<style>` 提供，随插件卸载一并移除
- 支持 `prefers-reduced-motion`，图标按钮均带 `title` + `aria-label`

## 结构

```
dsh-update-notifier/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js   # host: /dsh-update-rpc getStatus/checkNow
    └── client.js  # client: overlay banner + dock pill
```

## 安装

```powershell
dsh plugin --profile web add https://github.com/xia-sc/dsh-update-notifier
# 重启 dsh web 生效
```

验证：

```powershell
dsh --profile web --dump-config  # 应含 update-notifier
# 浏览器 GET http://127.0.0.1:3080/plugins/dsh-update-notifier/client.js 200
# RPC: POST /dsh-update-rpc/getStatus  {"type":"client-request","rpcId":"1","method":"getStatus","payload":{"args":{}}}
```

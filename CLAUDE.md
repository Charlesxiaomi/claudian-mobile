# CLAUDE.md

Claudian Mobile 是一个 Obsidian 插件（TypeScript + esbuild），主要在**手机端**使用。
本地已连接一台安卓手机，`scrcpy` 和 `adb` 都已安装（`/opt/homebrew/bin/`）。

## 随时可以抓取手机屏幕

改 UI（`src/ui/`、`src/style/`）时，不要凭空猜测效果——直接抓一张手机截图看实际渲染。
不需要每次都问用户要截图，也不需要用户手动截图发过来。

抓图（推荐，最快，直接落地成 PNG）：

```bash
adb exec-out screencap -p > /tmp/phone.png
```

然后用 Read 工具读 `/tmp/phone.png` 就能直接看到手机当前画面。

几点注意：

- 截图全黑通常是屏幕熄了/锁屏。先唤醒再抓：
  `adb shell input keyevent KEYCODE_WAKEUP`
- 确认设备在线：`adb devices -l`（应能看到 `device` 状态，当前机型 PLN110）。
- 需要**实时**看操作过程或者需要用鼠标键盘操控手机时，再开镜像窗口：
  `scrcpy`（`scrcpy --no-audio -m 1024` 更轻量）。日常只是想"看一眼"用上面的
  `screencap` 就够了，不用开 scrcpy 窗口。
- 也可以用 adb 直接操作，方便复现某个界面状态：
  - 点击：`adb shell input tap <x> <y>`
  - 滑动：`adb shell input swipe <x1> <y1> <x2> <y2> <ms>`
  - 输入文本：`adb shell input text "hello"`
  - 返回/主页：`adb shell input keyevent KEYCODE_BACK` / `KEYCODE_HOME`
- 截图坐标是设备物理像素（当前 1080x2372），和 CSS px 不是一回事，量间距时注意换算。

## 改完 UI 的常规验证流程

1. `npm run build`（会先跑 `scripts/build-css.mjs` 再 esbuild）
2. 把 `main.js` / `manifest.json` / `styles.css` 放进 vault 的
   `.obsidian/plugins/claudian-mobile/`。桌面 vault 可以设 `OBSIDIAN_VAULT=/path/to/vault`
   让构建直接拷过去；手机 vault 用 `adb push`。
3. 在 Obsidian 里重载插件，然后
   `adb exec-out screencap -p > /tmp/phone.png` 抓图确认效果

## 常用命令

```bash
npm run dev        # 开发构建
npm run build      # 生产构建
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # jest
```

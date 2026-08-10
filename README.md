# ✏️ 围桌写字

多人实时在线聚会游戏：每位玩家围着一张虚拟桌子坐下，每人面前有一块文字板。

- **别人可以在你面前的板子上写字**，但你**看不到**自己板子上的内容；
- 你可以看到并编辑**其他所有人**面前的板子；
- 手机 / 平板 / 电脑都能玩，推荐**横屏**使用；
- 是 PWA 网页应用：打开链接即玩，无需安装；也可以「添加到主屏幕」，像 App 一样全屏运行。

## 快速开始

```bash
cd circle-write
npm install
npm start
```

然后浏览器打开 <http://localhost:3000>。

## 局域网聚会（同一 Wi-Fi）

服务器启动时会在终端打印局域网地址，例如 `http://192.168.1.5:3000`。
同一 Wi-Fi 下的手机 / 平板 / 电脑用浏览器打开这个地址即可。

> 注意：iOS 浏览器可能需要手动输入该地址；Android 建议用 Chrome。

## 部署到公网（远程朋友一起玩）

有两种方式：

### 方式一：Cloudflare 免费隧道（最快，免注册，临时在线）

适合聚会时临时把游戏分享给朋友，不需要注册任何账号。

```bash
brew install cloudflared        # 只装一次
./start-online.sh               # 一键联网启动
```

等几秒后终端会出现一个 `https://xxxx.trycloudflare.com` 网址，把它发给朋友，
任何人用浏览器打开就能加入。两个窗口都开着时网址有效，按 `Ctrl+C` 关闭。

> 如果朋友打不开或很慢，说明被网络环境影响，改用下面的方式二部署到云端。

### 方式二：Render 免费托管（永久在线，需要 GitHub 账号）

1. 在 <https://github.com> 注册账号并新建一个仓库（仓库名随意，如 `circle-write`）；
2. 把代码推上去：

```bash
cd circle-write
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/circle-write.git
git push -u origin main
```

> 不会命令行 Git？用 GitHub 网页的 "Add file → Upload files" 直接上传整个项目文件也行。

3. 打开 <https://render.com> 注册 → **New → Web Service** → 连接你的 GitHub 仓库；
4. Build Command 填 `npm install`，Start Command 填 `npm start`；
5. 部署完成后会得到一个 `https://xxx.onrender.com` 的永久网址，分享即可。

> Glitch / Railway / Fly.io 等其他平台同理，导入仓库即可。

## 怎么像 App 一样用（PWA）

- **iOS**：Safari 打开网址 → 分享按钮 → 「添加到主屏幕」
- **Android**：Chrome 打开网址 → 菜单 → 「安装应用」或「添加到主屏幕」

之后从主屏幕图标进入，会全屏运行并自动锁定横屏。

## 玩法

1. 一个人点「创建房间」，把 4 位房间码告诉朋友；
2. 大家输入昵称和房间码入座（最多 8 人一桌）；
3. 每人面前有一块文字板：你能看到并编辑**别人**的板子；
4. 你自己面前的板子是**遮住的**，别人写了什么你看不到；
5. 正在被编辑的板子会显示「XX 正在编辑…」，其他人只读，避免互相覆盖；
6. 房主可以一键「清空板子」重新开始；
7. 房主退出时自动移交给下一个人。

## 技术栈与结构

```
circle-write/
├── server.js              # Node.js + Express + Socket.IO 服务器
├── package.json
├── public/                # 前端（无构建步骤）
│   ├── index.html         # 首页 + 房间页
│   ├── style.css          # 横屏围桌布局样式
│   ├── client.js          # 实时同步 / 编辑锁 / 断线重连
│   ├── manifest.webmanifest  # PWA 清单（横屏、独立窗口）
│   └── icons/             # 应用图标（脚本生成）
└── scripts/
    ├── generate-icons.js  # 零依赖 PNG 图标生成器
    └── smoke-test.js      # 多人同步冒烟测试
```

## 测试

```bash
PORT=3999 node server.js &        # 先启动服务器
npm test                          # 运行多人同步冒烟测试
```

## 备注

- 单个板子最多 500 字；
- 单房间最多 8 人；
- 数据保存在服务器内存中，重启后房间清空（适合聚会场景）。

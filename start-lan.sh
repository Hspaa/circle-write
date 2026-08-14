#!/bin/bash
# 围桌写字 - 局域网聚会一键启动
# 所有朋友连【同一个 Wi-Fi】，用手机/平板/电脑的浏览器打开终端显示的地址即可玩。
# 完全不需要外网 / VPN / 注册，路由器断网也能玩。
#
# 用法:
#   ./start-lan.sh

cd "$(dirname "$0")"
PORT="${PORT:-3000}"

echo "🚀 正在启动「围桌写字」局域网服务器..."
node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; echo; echo "已停止。"' EXIT

# 等待服务器就绪
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT"; then break; fi
  sleep 0.4
done

echo ""
echo "=============================================================="
echo "  🎉 服务器已就绪！"
echo ""
echo "  👉 请让朋友们连【同一个 Wi-Fi】，然后用浏览器打开上面"
echo "     「局域网访问」里的任意地址（或扫上面的二维码）。"
echo ""
echo "  📵 无需外网：只要设备在同一局域网就能玩（路由器没网也行）"
echo "  🔓 macOS 首次启动若弹出「是否允许 node 接收传入连接」，请点【允许】"
echo "  ⏹  要停止就按键盘左下角的 Control + C（⌃C），或直接关闭本窗口"
echo "=============================================================="

# 保持脚本运行（否则脚本一结束就会把服务器一起杀掉）
wait $SERVER_PID

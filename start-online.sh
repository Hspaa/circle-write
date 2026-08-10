#!/bin/bash
# 围桌写字 - 一键联网启动
# 启动本地服务器 + Cloudflare 免费公网隧道，把生成的 https 网址分享给朋友即可
#
# 首次使用需先安装 cloudflared:
#   brew install cloudflared
#
# 用法:
#   ./start-online.sh

cd "$(dirname "$0")"
PORT="${PORT:-3000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "❌ 未检测到 cloudflared，请先安装："
  echo "   brew install cloudflared"
  echo "安装完成后再运行 ./start-online.sh"
  exit 1
fi

echo "🚀 正在启动本地服务器 (端口 $PORT)..."
node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; echo; echo "已停止。"' EXIT

# 等待服务器就绪
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT"; then break; fi
  sleep 0.4
done

# 检测代理/VPN（常见工具使用 198.18.0.0/15 虚拟网段接管流量）
if ifconfig 2>/dev/null | grep -qE 'inet (198\.18\.|10\.10\.)'; then
  echo ""
  echo "⚠️  检测到代理/VPN 正在接管网络（198.18.x.x），它可能会拦截隧道连接！"
  echo "    如果一会儿网址打不开，请先【暂时关闭代理/VPN】，再运行本脚本。"
fi

echo ""
echo "🌐 正在建立公网隧道（Cloudflare）..."
echo "   请等待出现 https://xxxx.trycloudflare.com 这样的网址，"
echo "   把它发给朋友，任何人用浏览器打开即可加入！"
echo "   （两个窗口同时开着时网址有效，Ctrl+C 即关闭）"
echo ""
cloudflared tunnel --url "http://127.0.0.1:$PORT"

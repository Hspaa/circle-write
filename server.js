/**
 * 围桌写字 - 服务器
 *
 * 玩法：多位玩家在一个房间里围桌而坐，每人面前有一块文字板。
 *  - 你可以看到并编辑【别人】面前的板子；
 *  - 你自己面前的板子被遮住，你看不到内容；
 *  - 为了避免多人同时编辑同一块板子互相打架，采用“编辑锁”：
 *    谁先聚焦某块板子，谁就暂时拥有它，其他人只读。
 *
 * 技术栈：Node.js + Express + Socket.IO
 */
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_SEATS = 8; // 一桌最多 8 人
const CODE_LENGTH = 4; // 房间码长度
// 房间码字符表（去掉易混淆的 0/O、1/I）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TEXT = 500; // 单块板子最大字数

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// roomCode -> room
const rooms = new Map();

/* ---------------- 工具函数 ---------------- */

function genRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 12);
  return n || '玩家';
}

/** 找出第一个空座位 */
function nextSeat(room) {
  for (let i = 0; i < MAX_SEATS; i++) {
    if (!room.players[i]) return i;
  }
  return -1;
}

/** 让一个 socket 坐到某个座位上并加入房间 */
function addPlayer(socket, room, name, seat) {
  room.players[seat] = { id: socket.id, name };
  socket.data.roomCode = room.code;
  socket.data.seat = seat;
  socket.join(room.code);
}

/** 把玩家移出房间，同时释放 TA 持有的编辑锁；房主离开则移交房主 */
function removePlayer(socket, room, seat) {
  delete room.players[seat];
  for (const s of Object.keys(room.editors)) {
    if (room.editors[s] === socket.id) {
      delete room.editors[s];
      io.to(room.code).emit('board:unlocked', { seat: Number(s) });
    }
  }
  if (room.hostId === socket.id) {
    const rest = Object.values(room.players);
    room.hostId = rest.length ? rest[0].id : null;
  }
}

/** 房间状态快照（发给客户端用） */
function roomState(room) {
  const players = Object.entries(room.players)
    .filter(([, p]) => p)
    .map(([seat, p]) => ({ seat: Number(seat), id: p.id, name: p.name }));
  return {
    roomCode: room.code,
    hostId: room.hostId,
    maxSeats: MAX_SEATS,
    players,
    boards: room.boards,
    editors: Object.fromEntries(
      Object.entries(room.editors).map(([s, id]) => [Number(s), id])
    ),
  };
}

function getRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

/* ---------------- Socket 事件 ---------------- */

io.on('connection', (socket) => {
  /** 创建房间（创建者自动坐在 0 号位，是房主） */
  socket.on('createRoom', ({ name } = {}, cb) => {
    const code = genRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: {},
      boards: Array(MAX_SEATS).fill(''),
      editors: {},
    };
    rooms.set(code, room);
    addPlayer(socket, room, cleanName(name), 0);
    if (typeof cb === 'function') cb({ ok: true, state: roomState(room) });
  });

  /** 加入房间 */
  socket.on('joinRoom', ({ roomCode, name } = {}, cb) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      if (typeof cb === 'function') cb({ ok: false, error: '房间不存在，请检查房间码' });
      return;
    }
    const seat = nextSeat(room);
    if (seat === -1) {
      if (typeof cb === 'function') cb({ ok: false, error: '房间已满（最多 8 人）' });
      return;
    }
    addPlayer(socket, room, cleanName(name), seat);
    if (typeof cb === 'function') cb({ ok: true, state: roomState(room) });
    socket.to(code).emit('roomState', roomState(room));
  });

  /** 网络中断后的重连：尽量回到原来的座位 */
  socket.on('rejoinRoom', ({ roomCode, seat, name } = {}, cb) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      if (typeof cb === 'function') cb({ ok: false, error: '房间不存在' });
      return;
    }
    let target = -1;
    const desired = Number(seat);
    if (Number.isInteger(desired) && desired >= 0 && desired < MAX_SEATS) {
      const cur = room.players[desired];
      // 原座位空着，或原来那个人已经掉线了，都可以坐回去
      const dead = !cur || !io.sockets.sockets.get(cur.id) || !io.sockets.sockets.get(cur.id).connected;
      if (!cur || dead) target = desired;
    }
    if (target === -1) target = nextSeat(room);
    if (target === -1) {
      if (typeof cb === 'function') cb({ ok: false, error: '房间已满' });
      return;
    }
    if (room.editors[target]) {
      delete room.editors[target];
      io.to(code).emit('board:unlocked', { seat: target });
    }
    addPlayer(socket, room, cleanName(name), target);
    if (typeof cb === 'function') cb({ ok: true, state: roomState(room) });
    socket.to(code).emit('roomState', roomState(room));
  });

  /** 请求编辑锁（聚焦某块板子） */
  socket.on('board:lock', ({ seat } = {}, cb) => {
    const room = getRoom(socket);
    if (!room) return;
    seat = Number(seat);
    if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS) return;
    if (seat === socket.data.seat) return; // 不能编辑自己面前的板子
    if (!room.players[seat]) return;
    if (room.editors[seat] && room.editors[seat] !== socket.id) {
      if (typeof cb === 'function') cb({ ok: false, error: 'occupied' });
      return;
    }
    room.editors[seat] = socket.id;
    const name = room.players[socket.data.seat].name;
    io.to(room.code).emit('board:locked', { seat, id: socket.id, name });
    if (typeof cb === 'function') cb({ ok: true });
  });

  /** 释放编辑锁 */
  socket.on('board:unlock', ({ seat } = {}) => {
    const room = getRoom(socket);
    if (!room) return;
    seat = Number(seat);
    if (room.editors[seat] === socket.id) {
      delete room.editors[seat];
      io.to(room.code).emit('board:unlocked', { seat });
    }
  });

  /** 写入文字（同步给其他人） */
  socket.on('board:update', ({ seat, text } = {}) => {
    const room = getRoom(socket);
    if (!room) return;
    seat = Number(seat);
    if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS) return;
    if (seat === socket.data.seat) return; // 不能写自己面前的板子
    if (!room.players[seat]) return;
    if (room.editors[seat] && room.editors[seat] !== socket.id) return; // 被锁住
    const t = String(text == null ? '' : text).slice(0, MAX_TEXT);
    room.boards[seat] = t;
    socket.to(room.code).emit('board:updated', { seat, text: t });
  });

  /** 房主清空所有板子 */
  socket.on('board:clearAll', (cb) => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    room.boards = Array(MAX_SEATS).fill('');
    room.editors = {};
    io.to(room.code).emit('board:cleared');
    if (typeof cb === 'function') cb({ ok: true });
  });

  /** 主动退出房间 */
  socket.on('leaveRoom', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    removePlayer(socket, room, socket.data.seat);
    socket.leave(code);
    socket.data.roomCode = null;
    socket.data.seat = null;
    if (!Object.keys(room.players).length) rooms.delete(code);
    else io.to(code).emit('roomState', roomState(room));
  });

  /** 断线清理 */
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    removePlayer(socket, room, socket.data.seat);
    socket.data.roomCode = null;
    socket.data.seat = null;
    if (!Object.keys(room.players).length) rooms.delete(code);
    else io.to(code).emit('roomState', roomState(room));
  });
});

/* ---------------- 启动 ---------------- */

server.listen(PORT, '0.0.0.0', () => {
  console.log('✏️ 围桌写字 已启动');
  console.log(`  本机访问:     http://localhost:${PORT}`);

  // 只列出真正的局域网地址（跳过代理/隧道等虚拟网卡）
  const lan = Object.entries(os.networkInterfaces())
    .flatMap(([name, addrs]) =>
      (addrs || [])
        .filter((a) => a.family === 'IPv4' && !a.internal)
        .filter((a) => !/^(utun|awdl|llw|anpi|bridge|gif|stf|ap|lo)/.test(name))
        .map((a) => a.address)
    );
  for (const ip of lan) {
    console.log(`  局域网访问:   http://${ip}:${PORT}   （同一 Wi-Fi 下的手机/平板/电脑都能打开）`);
  }

  // 二维码：手机相机扫码直接加入（需已安装 qrcode-terminal）
  if (lan.length) {
    try {
      const qr = require('qrcode-terminal');
      console.log('\n  📱 让朋友用手机相机扫下面的二维码加入:');
      qr.generate(`http://${lan[0]}:${PORT}`, { small: true });
    } catch (e) {
      /* qrcode-terminal 未安装时跳过（不影响使用） */
    }
  }
});

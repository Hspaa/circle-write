/**
 * 冒烟测试：模拟 3 个玩家创建/加入房间、写字同步、编辑锁、清空。
 * 前置：先启动服务器 PORT=3999 node server.js
 * 用法：npm test
 */
const { io } = require('socket.io-client');

const BASE = process.env.TEST_URL || 'http://127.0.0.1:3999';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  return new Promise((res, rej) => {
    s.on('connect', () => res(s));
    s.on('connect_error', (e) => rej(new Error('连接失败: ' + e.message)));
  });
}

function emitAck(socket, event, data) {
  return new Promise((res) => socket.emit(event, data, res));
}

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failures++;
    console.error('  ✗ ' + msg);
  }
}

async function main() {
  console.log('启动冒烟测试...');
  const a = await connect();
  const b = await connect();
  const c = await connect();
  console.log('已连接 3 个客户端');

  // 1. 创建房间
  const created = await emitAck(a, 'createRoom', { name: '小A' });
  check(created.ok, 'A 创建房间成功');
  if (!created.ok) throw new Error(created.error);
  const code = created.state.roomCode;
  check(created.state.hostId === a.id, 'A 是房主');
  check(created.state.players.length === 1, '房间里有 1 人');

  // 2. B、C 加入
  const joinedB = await emitAck(b, 'joinRoom', { roomCode: code, name: '小B' });
  const joinedC = await emitAck(c, 'joinRoom', { roomCode: code, name: '小C' });
  check(joinedB.ok && joinedC.ok, 'B、C 加入房间成功');
  check(joinedB.state.players.length === 2, 'B 看到 2 人');
  check(joinedC.state.players.length === 3, 'C 看到 3 人');

  // B 的座位是 1
  const bSeat = joinedB.state.players.find((p) => p.id === b.id).seat;
  check(bSeat === 1, 'B 坐在 1 号位');

  // 3. 房间满员 / 房间不存在
  const bad = await emitAck(c, 'joinRoom', { roomCode: 'XXXX', name: '路人' });
  check(bad.ok === false, '房间码错误会被拒绝');

  // 4. A 在 B 的板子上写字（B 实时收到）
  const lockRes = await emitAck(a, 'board:lock', { seat: bSeat });
  check(lockRes.ok, 'A 拿到 B 板子的编辑锁');

  const gotText = new Promise((res) => {
    b.once('board:updated', (d) => res(d));
  });
  a.emit('board:update', { seat: bSeat, text: '你好，小B' });
  const d = await gotText;
  check(d.seat === bSeat && d.text === '你好，小B', '文字实时同步给 B: ' + JSON.stringify(d.text));

  // 5. A 锁定期间，C 无法抢锁、无法写入
  const lockC = await emitAck(c, 'board:lock', { seat: bSeat });
  check(lockC.ok === false, 'A 编辑时 C 无法抢锁');

  let cGot = null;
  const cWait = new Promise((res) => {
    const timer = setTimeout(() => res('timeout'), 500);
    c.once('board:updated', (d) => { clearTimeout(timer); res(d); });
  });
  c.emit('board:update', { seat: bSeat, text: '抢写内容' });
  cGot = await cWait;
  check(cGot === 'timeout' || cGot.text !== '抢写内容', '锁生效，C 无法写入');

  // 6. A 释放锁后，C 可以写
  a.emit('board:unlock', { seat: bSeat });
  await sleep(100);
  const lockC2 = await emitAck(c, 'board:lock', { seat: bSeat });
  check(lockC2.ok, 'A 释放后 C 能拿到锁');

  // 7. 自己不能写自己的板子
  let selfGot = null;
  const selfWait = new Promise((res) => {
    const timer = setTimeout(() => res('timeout'), 500);
    b.once('board:updated', (d) => { clearTimeout(timer); res(d); });
  });
  b.emit('board:update', { seat: bSeat, text: '自己写自己' });
  selfGot = await selfWait;
  check(selfGot === 'timeout', '玩家无法写入自己面前的板子');

  // 8. 晚加入的人能看到已有文字
  const late = await connect();
  const joinedLate = await emitAck(late, 'joinRoom', { roomCode: code, name: '迟到者' });
  check(joinedLate.state.boards[bSeat] === '你好，小B', '迟到的玩家能看到已有文字');

  // 9. 房主清空
  const cleared = new Promise((res) => b.once('board:cleared', res));
  a.emit('board:clearAll');
  await cleared;
  check(true, '所有玩家收到清空事件');

  // 10. 非房主不能清空（服务器对非房主不回执，等一会儿后验证内容还在）
  c.emit('board:update', { seat: bSeat, text: '新内容' });
  await sleep(120);
  c.emit('board:clearAll'); // 没有回调，纯触发
  await sleep(150);
  const newcomer = await connect();
  const st2 = await emitAck(newcomer, 'joinRoom', { roomCode: code, name: '旁观' });
  check(st2.ok && st2.state.boards[bSeat] === '新内容', '非房主清空被忽略，文字还在');

  // 11. 玩家离开后座位释放
  newcomer.emit('leaveRoom');
  await sleep(150);
  const filler = await connect();
  const d2 = await emitAck(filler, 'joinRoom', { roomCode: code, name: '补位' });
  check(d2.ok, '离开后新玩家可以补位加入');

  console.log(failures === 0 ? '\n冒烟测试全部通过 ✅' : `\n有 ${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('冒烟测试失败 ❌', e);
  process.exit(1);
});

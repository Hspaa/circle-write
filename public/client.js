/* ============ 围桌写字 - 客户端 ============ */
const socket = io();

// 注册 Service Worker（PWA：离线缓存 + 可安装）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

const $ = (sel) => document.querySelector(sel);

const state = {
  roomCode: null,
  mySeat: null,
  myName: '',
  hostId: null,
  players: [],      // [{ seat, id, name }]
  boards: [],       // 按座位索引的文字
  editors: {},      // seat -> socketId（谁正在编辑）
  maxSeats: 8,
  inRoom: false,
  leftRoom: false,
};

let activeSeat = null; // 当前聚焦的板子座位号

/* ---------------- 小工具 ---------------- */

function toast(msg, ms = 2000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function showHome() {
  state.inRoom = false;
  $('#screen-home').classList.remove('hidden');
  $('#screen-room').classList.add('hidden');
}

function showRoom() {
  $('#screen-home').classList.add('hidden');
  $('#screen-room').classList.remove('hidden');
}

function nameOf(id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : '某位玩家';
}

function seatCard(seat) {
  return $('#table').querySelector('.seat[data-seat="' + seat + '"]');
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('房间码已复制：' + t);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('房间码已复制：' + t);
  }
}

/* ---------------- 状态应用 ---------------- */

function applyState(s) {
  state.roomCode = s.roomCode;
  state.hostId = s.hostId;
  state.players = s.players || [];
  state.boards = (s.boards || []).slice();
  state.editors = s.editors || {};
  state.maxSeats = s.maxSeats || 8;
  const me = state.players.find((p) => p.id === socket.id);
  state.mySeat = me ? me.seat : null;
  renderRoom();
}

/* ---------------- 房间渲染 ---------------- */

function renderRoom() {
  $('#room-code').textContent = state.roomCode;
  $('#center-code').textContent = state.roomCode;
  $('#player-count').textContent = '👥 ' + state.players.length + '/' + state.maxSeats;
  $('#btn-clear').classList.toggle('hidden', state.hostId !== socket.id);
  renderSeats();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderSeats() {
  const table = $('#table');
  const prevActive = activeSeat;
  const prevText = prevActive != null ? (state.boards[prevActive] || '') : null;

  table.innerHTML = '';
  const sorted = state.players.slice().sort((a, b) => a.seat - b.seat);
  for (const p of sorted) table.appendChild(buildSeat(p));
  table.classList.toggle('crowded', sorted.length >= 7);
  layoutSeats();

  // 重建后尽量恢复正在编辑的板子（焦点 + 编辑锁）
  if (prevActive != null) {
    const card = seatCard(prevActive);
    const ta = card && card.querySelector('textarea');
    if (ta && ta.value === prevText) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }
}

function buildSeat(p) {
  const isSelf = p.id === socket.id;
  const card = el('div', 'seat' + (isSelf ? ' self' : ''));
  card.dataset.seat = p.seat;

  // 头部：头像 + 名字 + 徽章
  const head = el('div', 'seat-head');
  const av = el('span', 'avatar', (p.name || '?').trim().slice(0, 1).toUpperCase());
  const nm = el('span', 'sname', p.name);
  nm.title = p.name;
  head.appendChild(av);
  head.appendChild(nm);
  if (isSelf) head.appendChild(el('span', 'badge you', '你'));
  if (state.hostId === p.id) head.appendChild(el('span', 'badge host', '房主'));

  // 身体：自己 = 遮住；别人 = 可编辑文本框
  const body = el('div', 'seat-body');
  if (isSelf) {
    body.appendChild(el('div', 'cover-icon', '🔒'));
    body.appendChild(el('div', 'cover-text', '这是你面前的板子'));
    body.appendChild(el('div', 'cover-sub', '别人在上面写了什么，你看不到'));
  } else {
    const ta = document.createElement('textarea');
    ta.className = 'board-input';
    ta.placeholder = '在 ' + p.name + ' 的板子上写字…';
    ta.maxLength = 500;
    ta.value = state.boards[p.seat] || '';
    const lockbar = el('div', 'lockbar');
    lockbar.classList.add('hidden');
    body.appendChild(ta);
    body.appendChild(lockbar);
    bindInput(ta, lockbar, p.seat);
    syncLockbar(ta, lockbar, p.seat);
  }

  card.appendChild(head);
  card.appendChild(body);
  return card;
}

/* ---------------- 编辑锁与输入 ---------------- */

function bindInput(ta, lockbar, seat) {
  ta.addEventListener('focus', () => {
    activeSeat = seat;
    if (state.editors[seat] && state.editors[seat] !== socket.id) {
      ta.blur();
      return;
    }
    socket.emit('board:lock', { seat }, (res) => {
      if (res && res.ok === false) {
        toast('这块板子正有人在写，等 TA 写完吧');
        ta.blur();
      }
    });
  });

  ta.addEventListener('input', () => {
    socket.emit('board:update', { seat, text: ta.value });
  });

  ta.addEventListener('blur', () => {
    if (activeSeat === seat) activeSeat = null;
    socket.emit('board:unlock', { seat });
  });
}

function syncLockbar(ta, lockbar, seat) {
  const editorId = state.editors[seat];
  if (!editorId) {
    lockbar.classList.add('hidden');
    lockbar.textContent = '';
    ta.disabled = false;
  } else if (editorId === socket.id) {
    lockbar.classList.remove('hidden');
    lockbar.textContent = '✍️ 正在编辑（其他人只读）';
    ta.disabled = false;
  } else {
    lockbar.classList.remove('hidden');
    lockbar.textContent = '✍️ ' + nameOf(editorId) + ' 正在编辑…';
    ta.disabled = true;
  }
}

function refreshSeatLock(seat) {
  const card = seatCard(seat);
  if (!card) return;
  const ta = card.querySelector('textarea');
  const lockbar = card.querySelector('.lockbar');
  if (ta && lockbar) syncLockbar(ta, lockbar, seat);
}

/* ---------------- 围桌布局（椭圆围坐） ---------------- */

function layoutSeats() {
  const table = $('#table');
  const cards = table.querySelectorAll('.seat');
  if (!cards.length) return;
  const w = table.clientWidth;
  const h = table.clientHeight;
  const cx = w / 2;
  const cy = h / 2;
  const cardW = cards[0].offsetWidth;
  const cardH = cards[0].offsetHeight;
  const rx = Math.max(90, Math.min(w / 2 - cardW / 2 - 8, 320));
  const ry = Math.max(64, Math.min(h / 2 - cardH / 2 - 8, 200));
  const n = cards.length;
  cards.forEach((card, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n; // 从最上方开始
    const x = Math.round(cx + rx * Math.cos(ang) - cardW / 2);
    const y = Math.round(cy + ry * Math.sin(ang) - cardH / 2);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  });
}

let rsTimer;
window.addEventListener('resize', () => {
  clearTimeout(rsTimer);
  rsTimer = setTimeout(layoutSeats, 80);
});

/* ---------------- Socket 事件 ---------------- */

socket.on('roomState', (s) => {
  applyState(s);
});

socket.on('board:updated', ({ seat, text }) => {
  if (seat == null || text == null) return;
  state.boards[seat] = text;
  const card = seatCard(seat);
  if (!card) return;
  const ta = card.querySelector('textarea');
  if (ta && document.activeElement !== ta) ta.value = text;
});

socket.on('board:locked', ({ seat, id }) => {
  state.editors[seat] = id;
  refreshSeatLock(seat);
});

socket.on('board:unlocked', ({ seat }) => {
  delete state.editors[seat];
  refreshSeatLock(seat);
});

socket.on('board:cleared', () => {
  state.boards = Array(state.maxSeats).fill('');
  state.editors = {};
  renderSeats();
  toast('房主清空了所有板子');
});

/* ---------------- 连接状态与断线重连 ---------------- */

socket.on('connect', () => {
  $('#conn-status').textContent = '已连接 ✓';
  if (state.inRoom && !state.leftRoom) {
    socket.emit('rejoinRoom', { roomCode: state.roomCode, seat: state.mySeat, name: state.myName }, (res) => {
      if (res && res.ok) {
        state.inRoom = true;
        showRoom();
        applyState(res.state);
        toast('网络已恢复，自动回到了座位');
      } else {
        state.leftRoom = true;
        showHome();
        toast('连接中断，请重新加入房间');
      }
    });
  }
});

socket.on('disconnect', () => {
  $('#conn-status').textContent = '连接断开，重连中…';
  if (state.inRoom) toast('网络断开，正在重连…');
});

/* ---------------- 首页交互 ---------------- */

const nameInput = $('#input-name');
nameInput.value = localStorage.getItem('cw-name') || '';
nameInput.addEventListener('input', () => {
  localStorage.setItem('cw-name', nameInput.value);
});

function getDisplayName() {
  return nameInput.value.trim().slice(0, 12);
}

function showHomeError(msg) {
  $('#home-error').textContent = msg || '';
}

function enterRoom(s, msg) {
  state.inRoom = true;
  state.leftRoom = false;
  showRoom();          // 先显示房间屏，保证布局尺寸可用
  applyState(s);
  toast(msg || '已进入房间');
}

$('#btn-create').addEventListener('click', () => {
  const name = getDisplayName();
  if (!name) { showHomeError('请先输入昵称'); return; }
  state.myName = name;
  socket.emit('createRoom', { name }, (res) => {
    if (res.ok) enterRoom(res.state, '房间创建成功，把房间码告诉朋友吧 🎉');
    else showHomeError(res.error || '创建失败，请重试');
  });
});

function joinByCode() {
  const name = getDisplayName();
  if (!name) { showHomeError('请先输入昵称'); return; }
  const code = $('#input-code').value.trim().toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(code)) { showHomeError('请输入 4 位房间码（不含 0、1、O）'); return; }
  state.myName = name;
  socket.emit('joinRoom', { roomCode: code, name }, (res) => {
    if (res.ok) enterRoom(res.state, '已加入房间');
    else showHomeError(res.error || '加入失败');
  });
}

$('#btn-join').addEventListener('click', joinByCode);
$('#input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
$('#input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if ($('#input-code').value.trim()) joinByCode();
    else $('#btn-create').click();
  }
});
$('#input-code').addEventListener('input', () => {
  $('#input-code').value = $('#input-code').value.toUpperCase();
  showHomeError('');
});

/* ---------------- 房间页交互 ---------------- */

$('#room-code-chip').addEventListener('click', () => {
  if (state.roomCode) copyText(state.roomCode);
});

$('#btn-leave').addEventListener('click', () => {
  socket.emit('leaveRoom');
  state.leftRoom = true;
  state.inRoom = false;
  state.roomCode = null;
  state.players = [];
  showHome();
  toast('已退出房间');
});

$('#btn-clear').addEventListener('click', () => {
  if (confirm('确定要清空所有板子上的字吗？')) socket.emit('board:clearAll');
});

/* ---------------- 竖屏提示 ---------------- */

function updatePortraitWarning() {
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  $('#portrait-warning').classList.toggle('hidden', !(isPortrait && isTouch));
}
window.addEventListener('resize', updatePortraitWarning);
window.addEventListener('orientationchange', updatePortraitWarning);
updatePortraitWarning();


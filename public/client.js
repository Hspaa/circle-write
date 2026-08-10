/* ============ 围桌写字 - 客户端 ============ */
const socket = io();

// 注册 Service Worker（PWA：离线缓存 + 可安装）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

const $ = (sel) => document.querySelector(sel);

// 触摸设备（手机/平板）用「列表 + 全屏编辑」，电脑用「围桌椭圆」
const isCoarse = window.matchMedia('(pointer: coarse)').matches;

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

let activeSeat = null;  // 桌面端：当前聚焦的板子座位号
let editingSeat = null; // 触摸端：全屏编辑中的板子座位号

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

/* ---------------- 自定义确认框 ---------------- */

let confirmCallback = null;

function showConfirm(title, onYes) {
  $('#confirm-title').textContent = title;
  confirmCallback = onYes;
  $('#confirm-modal').classList.remove('hidden');
}

function hideConfirm() {
  confirmCallback = null;
  $('#confirm-modal').classList.add('hidden');
}

$('#confirm-no').addEventListener('click', hideConfirm);
$('#confirm-yes').addEventListener('click', () => {
  const cb = confirmCallback;
  hideConfirm();
  if (cb) cb();
});

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

  if (!isCoarse) {
    layoutSeats();
    // 桌面端：重建后尽量恢复正在编辑的板子（焦点 + 编辑锁）
    if (prevActive != null) {
      const card = seatCard(prevActive);
      const ta = card && card.querySelector('textarea');
      if (ta && ta.value === prevText) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  } else if (editingSeat != null) {
    // 触摸端：如果正在编辑的板子还在，保持编辑弹窗
    const still = state.players.some((x) => x.seat === editingSeat);
    if (!still) closeEdit(true);
    else updateEditLockbar();
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

  const body = el('div', 'seat-body');
  if (isSelf) {
    // 自己面前的板子：遮住
    body.appendChild(el('div', 'cover-icon', '🔒'));
    body.appendChild(el('div', 'cover-text', '这是你面前的板子'));
    body.appendChild(el('div', 'cover-sub', '别人在上面写了什么，你看不到'));
  } else if (isCoarse) {
    // 触摸端：只读预览，点一下进入全屏编辑
    const preview = el('div', 'board-preview');
    preview.textContent = state.boards[p.seat] || '';
    if (!preview.textContent) {
      preview.textContent = '✏️ 点这里，在 ' + p.name + ' 的板子上写字…';
      preview.classList.add('empty');
    }
    const lockbar = el('div', 'lockbar');
    lockbar.classList.add('hidden');
    body.appendChild(preview);
    body.appendChild(lockbar);
    preview.addEventListener('click', () => {
      if (state.editors[p.seat] && state.editors[p.seat] !== socket.id) {
        toast(nameOf(state.editors[p.seat]) + ' 正在编辑这块板子');
        return;
      }
      openEdit(p.seat);
    });
    syncPreviewLock(preview, lockbar, p.seat);
  } else {
    // 桌面端：就地编辑
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

/* ---------------- 桌面端：就地编辑锁 ---------------- */

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
    state.boards[seat] = ta.value;
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

/* ---------------- 触摸端：预览与锁 ---------------- */

function updatePreview(preview, seat) {
  const t = state.boards[seat] || '';
  if (t) {
    preview.textContent = t;
    preview.classList.remove('empty');
  } else {
    const p = state.players.find((x) => x.seat === seat);
    preview.textContent = p ? '✏️ 点这里，在 ' + p.name + ' 的板子上写字…' : '';
    preview.classList.add('empty');
  }
}

function syncPreviewLock(preview, lockbar, seat) {
  const editorId = state.editors[seat];
  if (editorId && editorId !== socket.id) {
    lockbar.classList.remove('hidden');
    lockbar.textContent = '✍️ ' + nameOf(editorId) + ' 正在编辑…';
    preview.classList.add('locked');
  } else {
    lockbar.classList.add('hidden');
    lockbar.textContent = '';
    preview.classList.remove('locked');
  }
}

function refreshSeatLock(seat) {
  const card = seatCard(seat);
  if (!card) return;
  if (isCoarse) {
    const preview = card.querySelector('.board-preview');
    const lockbar = card.querySelector('.lockbar');
    if (preview && lockbar) syncPreviewLock(preview, lockbar, seat);
  } else {
    const ta = card.querySelector('textarea');
    const lockbar = card.querySelector('.lockbar');
    if (ta && lockbar) syncLockbar(ta, lockbar, seat);
  }
}
/* ---------------- 围桌布局（仅桌面端） ---------------- */

function layoutSeats() {
  if (isCoarse) return;
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

/* ---------------- 触摸端：全屏编辑模式 ---------------- */

function openEdit(seat) {
  const p = state.players.find((x) => x.seat === seat);
  if (!p || seat === state.mySeat) return;
  if (state.editors[seat] && state.editors[seat] !== socket.id) {
    toast(nameOf(state.editors[seat]) + ' 正在编辑这块板子');
    return;
  }
  editingSeat = seat;
  $('#edit-target-name').textContent = p.name;
  const ta = $('#edit-input');
  ta.value = state.boards[seat] || '';
  ta.maxLength = 500;
  $('#edit-modal').classList.remove('hidden');
  updateEditLockbar();
  ta.focus(); // 立即聚焦，保证手机键盘弹出
  socket.emit('board:lock', { seat }, (res) => {
    if (res && res.ok === false) {
      toast('这块板子正有人在写，等 TA 写完吧');
      closeEdit(true);
    }
  });
}

function closeEdit(skipUnlock) {
  const seat = editingSeat;
  editingSeat = null;
  $('#edit-modal').classList.add('hidden');
  if (!skipUnlock && seat != null) socket.emit('board:unlock', { seat });
}

function updateEditLockbar() {
  const lockbar = $('#edit-lockbar');
  if (editingSeat == null) return;
  const editorId = state.editors[editingSeat];
  if (!editorId) {
    lockbar.classList.add('hidden');
    lockbar.textContent = '';
  } else if (editorId === socket.id) {
    lockbar.classList.remove('hidden');
    lockbar.textContent = '✍️ 正在编辑（其他人只读）';
  } else {
    lockbar.classList.remove('hidden');
    lockbar.textContent = '✍️ ' + nameOf(editorId) + ' 正在编辑…';
  }
}

$('#edit-input').addEventListener('input', () => {
  if (editingSeat != null) {
    const t = $('#edit-input').value;
    state.boards[editingSeat] = t;
    socket.emit('board:update', { seat: editingSeat, text: t });
  }
});

$('#edit-done').addEventListener('click', () => closeEdit(false));

$('#edit-modal').addEventListener('click', (e) => {
  if (e.target === $('#edit-modal')) closeEdit(false); // 点遮罩空白处关闭
});

/* ---------------- Socket 事件 ---------------- */

socket.on('roomState', (s) => {
  applyState(s);
});

socket.on('board:updated', ({ seat, text }) => {
  if (seat == null || text == null) return;
  state.boards[seat] = text;
  const card = seatCard(seat);
  if (card) {
    if (isCoarse) {
      const preview = card.querySelector('.board-preview');
      if (preview) updatePreview(preview, seat);
    } else {
      const ta = card.querySelector('textarea');
      if (ta && document.activeElement !== ta) ta.value = text;
    }
  }
  if (editingSeat === seat) {
    const ta = $('#edit-input');
    if (document.activeElement !== ta) ta.value = text;
  }
});

socket.on('board:locked', ({ seat, id }) => {
  state.editors[seat] = id;
  refreshSeatLock(seat);
  if (editingSeat === seat) updateEditLockbar();
});

socket.on('board:unlocked', ({ seat }) => {
  delete state.editors[seat];
  refreshSeatLock(seat);
  if (editingSeat === seat) updateEditLockbar();
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
  if (editingSeat != null) closeEdit(true);
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
  showConfirm('确定要退出房间吗？', () => {
    socket.emit('leaveRoom');
    state.leftRoom = true;
    state.inRoom = false;
    state.roomCode = null;
    state.players = [];
    showHome();
    toast('已退出房间');
  });
});

$('#btn-clear').addEventListener('click', () => {
  showConfirm('确定要清空所有板子上的字吗？', () => socket.emit('board:clearAll'));
});


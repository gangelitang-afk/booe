// ============================================================
// 飞行棋房间 —— Durable Object
// 每个房间一个实例：WebSocket 连接 + 完整规则引擎
// ============================================================

// 颜色顺序（玩家加入顺序）：红 黄 蓝 绿
export const COLORS = [
  { key: 'red', name: '红', hex: '#C0362C' },
  { key: 'yellow', name: '黄', hex: '#D9A11C' },
  { key: 'blue', name: '蓝', hex: '#2E5FA3' },
  { key: 'green', name: '绿', hex: '#2E7D46' }
];

// 每色起飞点（主路绝对位置 0-51，顺时针）
export const START = { red: 39, yellow: 13, blue: 26, green: 0 };

// 特殊格（主路绝对位置）
export const SPECIAL = {
  jump:  { green: 5,  yellow: 18, blue: 31, red: 44 },   // 跳格（+4）
  bomb:  { green: 8,  yellow: 21, blue: 34, red: 47 },   // 炸弹（回巢）
  meteor:{ green: 11, yellow: 24, blue: 37, red: 50 }    // 流星（+4）
};

// 位置编码：0=停机坪 1-52=主路步数 53-58=终点跑道 59=已到达
const DOCK = 0, TRACK_MAX = 52, RUNWAY_START = 53, FINISH = 59;

export class LudoRoom {
  constructor(state, env) {
    this.state = state;
    this.roomId = state.id.name;
    this.conns = new Map();   // ws -> { playerId }
    this.players = [];        // [{ id, name, color, planes:[0,0,0,0], connected }]
    this.phase = 'waiting';   // waiting | playing | ended
    this.current = 0;
    this.dice = null;
    this.sixStreak = 0;
    this.turnStage = 'roll';  // roll | choose
    this.movable = [];        // 可移动飞机索引
    this.winner = null;
    this.log = [];
  }

  // ============ WebSocket 入口 ============
  async fetch(request) {
    const url = new URL(request.url);

    // 房间状态探测（用于创建房间时避免重复）
    if (!request.headers.get('Upgrade') && url.pathname === '/status') {
      return new Response(JSON.stringify({ exists: this.players.length > 0 }), {
        status: this.players.length > 0 ? 200 : 404
      });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('not found', { status: 404 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(ws) {
    this.conns.set(ws, { playerId: null });
    ws.addEventListener('message', (event) => {
      try {
        this.onMessage(ws, JSON.parse(event.data));
      } catch (e) {
        this.send(ws, { type: 'error', msg: '消息格式错误' });
      }
    });
    ws.addEventListener('close', () => this.onClose(ws));
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  }

  broadcast(obj) {
    for (const ws of this.conns.keys()) {
      this.send(ws, obj);
    }
  }

  pushLog(text) {
    this.log.push(`[${this.players[this.current] ? this.players[this.current].name : ''}] ${text}`);
    if (this.log.length > 30) this.log.shift();
  }

  emitState() {
    this.broadcast({
      type: 'state',
      roomId: this.roomId,
      phase: this.phase,
      players: this.players.map(p => ({
        id: p.id, name: p.name, color: p.color, planes: p.planes, connected: p.connected
      })),
      current: this.current,
      dice: this.dice,
      turnStage: this.turnStage,
      movable: this.movable,
      winner: this.winner,
      log: this.log.slice(-12),
      myId: null
    });
  }

  // ============ 消息处理 ============
  onMessage(ws, msg) {
    const conn = this.conns.get(ws);
    if (!conn) return;

    switch (msg.type) {
      case 'join': {
        if (this.phase === 'playing') {
          this.send(ws, { type: 'error', msg: '游戏已开始，不能加入' });
          return;
        }
        if (conn.playerId) return; // 已加入
        if (this.players.length >= 4) {
          this.send(ws, { type: 'error', msg: '房间已满（最多4人）' });
          return;
        }
        const name = String(msg.name || '玩家').trim().slice(0, 12) || '玩家';
        const player = {
          id: crypto.randomUUID().slice(0, 8),
          name,
          color: COLORS[this.players.length].key,
          planes: [0, 0, 0, 0],
          connected: true
        };
        this.players.push(player);
        conn.playerId = player.id;
        this.pushLog(`${name} 加入（${COLORS[this.players.length - 1].name}）`);
        this.send(ws, { type: 'joined', playerId: player.id, color: player.color });
        this.emitState();
        break;
      }

      case 'start': {
        const me = this.getPlayer(ws);
        if (!me) break;
        if (this.players[0].id !== me.id) {
          this.send(ws, { type: 'error', msg: '只有房主可以开始' });
          break;
        }
        if (this.players.length < 2) {
          this.send(ws, { type: 'error', msg: '至少需要 2 人' });
          break;
        }
        this.phase = 'playing';
        this.current = 0;
        this.dice = null;
        this.turnStage = 'roll';
        this.sixStreak = 0;
        this.pushLog('游戏开始！');
        this.emitState();
        break;
      }

      case 'roll': {
        if (this.phase !== 'playing') break;
        const me = this.getPlayer(ws);
        const cur = this.players[this.current];
        if (!me || me.id !== cur.id) {
          this.send(ws, { type: 'error', msg: '还没轮到你' });
          break;
        }
        if (this.turnStage !== 'roll') {
          this.send(ws, { type: 'error', msg: '请先移动飞机' });
          break;
        }
        this.doRoll();
        break;
      }

      case 'move': {
        if (this.phase !== 'playing') break;
        const me = this.getPlayer(ws);
        const cur = this.players[this.current];
        if (!me || me.id !== cur.id) {
          this.send(ws, { type: 'error', msg: '还没轮到你' });
          break;
        }
        if (this.turnStage !== 'choose') {
          this.send(ws, { type: 'error', msg: '现在不能移动' });
          break;
        }
        const plane = Number(msg.plane);
        if (!this.movable.includes(plane)) {
          this.send(ws, { type: 'error', msg: '这架飞机不能移动' });
          break;
        }
        this.doMove(plane);
        break;
      }

      case 'restart': {
        const me = this.getPlayer(ws);
        if (!me) break;
        if (this.players[0].id !== me.id) break;
        this.players.forEach(p => { p.planes = [0, 0, 0, 0]; });
        this.phase = 'playing';
        this.current = 0;
        this.dice = null;
        this.turnStage = 'roll';
        this.sixStreak = 0;
        this.winner = null;
        this.log = [];
        this.pushLog('再来一局！');
        this.emitState();
        break;
      }
    }
  }

  onClose(ws) {
    const conn = this.conns.get(ws);
    if (conn && conn.playerId) {
      const p = this.players.find(x => x.id === conn.playerId);
      if (p) {
        p.connected = false;
        this.pushLog(`${p.name} 掉线了`);
      }
    }
    this.conns.delete(ws);
    this.emitState();
  }

  getPlayer(ws) {
    const conn = this.conns.get(ws);
    if (!conn || !conn.playerId) return null;
    return this.players.find(p => p.id === conn.playerId) || null;
  }

  // ============ 规则引擎 ============
  doRoll() {
    const cur = this.players[this.current];
    const dice = Math.floor(Math.random() * 6) + 1;
    this.dice = dice;
    this.pushLog(`掷出 ${dice} 点`);

    if (dice === 6) {
      this.sixStreak++;
      if (this.sixStreak >= 3) {
        // 连续三次 6：作废，罚停
        this.sixStreak = 0;
        this.turnStage = 'roll';
        this.pushLog('连续三次 6！作废罚停');
        this.emitState();
        setTimeout(() => { this.nextTurn(); }, 1500);
        return;
      }
    } else {
      this.sixStreak = 0;
    }

    this.movable = this.getMovable(cur, dice);
    if (this.movable.length === 0) {
      this.pushLog('没有可移动的飞机');
      this.emitState();
      setTimeout(() => { this.nextTurn(); }, 1200);
      return;
    }
    if (this.movable.length === 1) {
      // 唯一选择，自动移动
      this.turnStage = 'choose';
      this.emitState();
      setTimeout(() => { this.doMove(this.movable[0]); }, 800);
      return;
    }
    // 多个选择：等待玩家点击
    this.turnStage = 'choose';
    this.emitState();
  }

  getMovable(player, dice) {
    const list = [];
    for (let i = 0; i < 4; i++) {
      const pos = player.planes[i];
      if (pos === FINISH) continue; // 已到终点
      if (pos === DOCK) {
        // 停机坪：只有 6 能起飞
        if (dice === 6) list.push(i);
        continue;
      }
      // 主路或跑道：都能动（终点折返由 movePlane 处理）
      list.push(i);
    }
    return list;
  }

  doMove(planeIdx) {
    const cur = this.players[this.current];
    const dice = this.dice;
    let pos = cur.planes[planeIdx];
    const wasDock = pos === DOCK;
    const name = cur.name;

    if (wasDock) {
      // 起飞：落位 1，剩余 5 步
      pos = 1 + (dice - 1);
      this.pushLog(`${name} 起飞！`);
    } else {
      pos += dice;
    }

    // 终点判定
    if (pos > FINISH) {
      pos = FINISH - (pos - FINISH); // 折返
    }

    let bounced = false; // 是否因炸弹回巢

    // 特殊格判定（主路内）
    if (pos >= 1 && pos <= TRACK_MAX) {
      const abs = (START[cur.color] + pos - 1) % 52;
      if (SPECIAL.jump[cur.color] === abs) {
        pos += 4;
        this.pushLog(`${name} 踩到跳格，飞跃 4 格！`);
      } else if (SPECIAL.bomb[cur.color] === abs) {
        pos = DOCK;
        bounced = true;
        this.pushLog(`${name} 踩到炸弹，飞机回巢！`);
      } else if (SPECIAL.meteor[cur.color] === abs) {
        pos += 4;
        this.pushLog(`${name} 踩到流星，前进 4 格！`);
      }
    }

    cur.planes[planeIdx] = pos;

    // 踩踏判定（主路上）
    if (!bounced && pos >= 1 && pos <= TRACK_MAX) {
      const abs = (START[cur.color] + pos - 1) % 52;
      let kicked = false;
      for (const other of this.players) {
        if (other.id === cur.id) continue;
        for (let j = 0; j < 4; j++) {
          const op = other.planes[j];
          if (op >= 1 && op <= TRACK_MAX) {
            const oAbs = (START[other.color] + op - 1) % 52;
            if (oAbs === abs) {
              other.planes[j] = DOCK;
              kicked = true;
            }
          }
        }
      }
      if (kicked) this.pushLog(`${name} 踢飞了敌人的飞机！`);
    }

    // 到达终点
    const finishedCount = cur.planes.filter(p => p === FINISH).length;
    this.dice = dice;

    // 判断胜利
    if (finishedCount === 4) {
      this.phase = 'ended';
      this.winner = this.current;
      this.pushLog(`${name} 四机全部到达，获胜！`);
      this.emitState();
      return;
    }

    // 奖励再掷：掷出 6 起飞/移动 或 踢飞敌人
    const reward = (dice === 6) || kicked;
    if (reward && this.movable.length >= 0) {
      this.pushLog('奖励再掷一次！');
      this.turnStage = 'roll';
      this.emitState();
      return;
    }

    this.emitState();
    setTimeout(() => { this.nextTurn(); }, 900);
  }

  nextTurn() {
    if (this.phase !== 'playing') return;
    this.dice = null;
    this.turnStage = 'roll';
    this.movable = [];
    do {
      this.current = (this.current + 1) % this.players.length;
    } while (this.players[this.current].planes.every(p => p === FINISH));
    this.pushLog(`轮到 ${this.players[this.current].name}`);
    this.emitState();
  }
}

// ============================================================
// 五子棋房间 —— Durable Object
// 每个房间一个实例：2 个座位（先到执黑，后到执白），
// 第 2 人加入即自动开局；其余连接为观战。
// 棋盘 board[y][x]：0=空 1=黑 2=白（与 gomoku-core.js 一致）
// ============================================================

const SIZE = 15, EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function inBoard(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }

// 落子 (x,y) 后检查胜利，返回连线坐标数组（>=5 子）或 null
function winLineAt(board, x, y) {
  const color = board[y][x];
  if (!color) return null;
  for (const [dx, dy] of DIRS) {
    const line = [[x, y]];
    for (let s = -1; s <= 1; s += 2) {
      let nx = x + dx * s, ny = y + dy * s;
      while (inBoard(nx, ny) && board[ny][nx] === color) {
        line.push([nx, ny]);
        nx += dx * s; ny += dy * s;
      }
    }
    if (line.length >= 5) {
      line.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return line;
    }
  }
  return null;
}

function emptyBoard() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
}

// 棋盘瘦身：二维 -> 15 行字符串（"01212..."），比二维数组 JSON 小 3 倍
function encodeBoard(board) {
  return board.map(row => row.join(''));
}

export class GomokuRoom {
  constructor(state, env) {
    this.state = state;
    this.roomId = state.id.name;
    this.conns = new Map();   // ws -> { playerId, spectator }
    this.players = [];        // 最多 2 席 [{ id, name, color('black'|'white'), connected }]
    this.phase = 'waiting';   // waiting | playing | ended
    this.board = emptyBoard();
    this.turn = 'black';
    this.lastMove = null;     // { x, y, color }
    this.winner = null;       // 'black' | 'white' | 'draw'
    this.winLine = null;      // [[x,y],...] 或 'draw'
    this.moveCount = 0;
    this.log = [];
    this.rev = 0;             // 棋局版本号：仅对局状态变化时才自增
  }

  // ============ WebSocket 入口 ============
  async fetch(request) {
    const url = new URL(request.url);

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
    this.conns.set(ws, { playerId: null, spectator: false });
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
    for (const ws of this.conns.keys()) this.send(ws, obj);
  }

  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
  }

  emitState() {
    this.broadcast(this.buildState());
  }

  // 轻量广播：只同步「谁在房间」，不含棋盘 —— 避免多人进出时的广播风暴
  emitRoster(excludeWs) {
    const payload = {
      type: 'roster',
      roomId: this.roomId,
      rev: this.rev,
      phase: this.phase,
      players: this.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
      spectators: this.spectatorCount()
    };
    for (const ws of this.conns.keys()) {
      if (ws !== excludeWs) this.send(ws, payload);
    }
  }

  // 只发给某一个连接（入座时给新人同步完整棋盘，不给全员增加负载）
  emitStateTo(ws) {
    this.send(ws, this.buildState());
  }

  buildState() {
    return {
      type: 'state',
      roomId: this.roomId,
      rev: this.rev,
      phase: this.phase,
      players: this.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected })),
      spectators: this.spectatorCount(),
      board: encodeBoard(this.board),
      turn: this.turn,
      lastMove: this.lastMove,
      winner: this.winner,
      winLine: this.winLine,
      moveCount: this.moveCount,
      log: this.log.slice(-12)
    };
  }

  spectatorCount() {
    let n = 0;
    for (const c of this.conns.values()) if (c.spectator) n++;
    return n;
  }

  // ============ 消息处理 ============
  onMessage(ws, msg) {
    const conn = this.conns.get(ws);
    if (!conn) return;

    switch (msg.type) {
      case 'join': {
        if (conn.playerId || conn.spectator) return; // 已加入
        const name = String(msg.name || '玩家').trim().slice(0, 12) || '玩家';

        if (this.players.length < 2) {
          // 入座：先到执黑，后到执白
          const color = this.players.length === 0 ? 'black' : 'white';
          const player = { id: crypto.randomUUID().slice(0, 8), name, color, connected: true };
          this.players.push(player);
          conn.playerId = player.id;
          this.pushLog(`${name} 加入（${color === 'black' ? '黑' : '白'}）`);
          this.send(ws, { type: 'joined', playerId: player.id, color });
          const startedNow = (this.players.length === 2 && this.phase === 'waiting');
          if (startedNow) {
            this.phase = 'playing';
            this.rev++;
            this.pushLog('游戏开始！黑先行');
          }
          // 自己先拿完整棋盘
          this.emitStateTo(ws);
          if (startedNow) {
            // 开局是「棋局状态变化」，必须全员同步 state（否则只监听 state 的客户端永远等不到开局）
            this.emitState();
          } else {
            // 纯成员变动：在场的人只收轻量名单
            this.emitRoster(ws);
          }
          break;
        }
        // 满员：明确告知是观看者身份
        conn.spectator = true;
        this.pushLog(`${name} 进入观战`);
        this.send(ws, {
          type: 'joined', playerId: null, color: null, spectator: true
        });
        this.send(ws, {
          type: 'notice',
          msg: '对局位置已满（黑、白两个座位都有人了），你已进入观看模式：只能看棋，不能落子。'
        });
        this.emitStateTo(ws);
        this.emitRoster(ws);
        break;
      }

      case 'move': {
        if (this.phase !== 'playing') {
          this.send(ws, { type: 'error', msg: '对局未在进行中' });
          break;
        }
        const me = this.getPlayer(ws);
        if (!me) {
          this.send(ws, { type: 'error', msg: '观战不能落子' });
          break;
        }
        if (me.color !== this.turn) {
          this.send(ws, { type: 'error', msg: '还没轮到你' });
          break;
        }
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || !inBoard(x, y)) {
          this.send(ws, { type: 'error', msg: '坐标不合法' });
          break;
        }
        if (this.board[y][x] !== EMPTY) {
          this.send(ws, { type: 'error', msg: '这里已经有子了' });
          break;
        }
        const v = this.turn === 'black' ? BLACK : WHITE;
        this.board[y][x] = v;
        this.moveCount++;
        this.rev++;
        this.lastMove = { x, y, color: this.turn };
        const line = winLineAt(this.board, x, y);
        if (line) {
          this.phase = 'ended';
          this.winner = this.turn;
          this.winLine = line;
          this.pushLog(`${me.name}（${this.turn === 'black' ? '黑' : '白'}）五子连珠，获胜！`);
        } else if (this.moveCount >= SIZE * SIZE) {
          this.phase = 'ended';
          this.winner = 'draw';
          this.winLine = 'draw';
          this.pushLog('棋盘满了，平局！');
        } else {
          this.turn = this.turn === 'black' ? 'white' : 'black';
        }
        this.emitState();
        break;
      }

      case 'restart': {
        const me = this.getPlayer(ws);
        if (!me) {
          this.send(ws, { type: 'error', msg: '观战不能重开' });
          break;
        }
        // 重开并交换黑白，输的先行
        this.players = this.players.map(p => ({
          ...p, color: p.color === 'black' ? 'white' : 'black'
        }));
        this.board = emptyBoard();
        this.turn = 'black';
        this.lastMove = null;
        this.winner = null;
        this.winLine = null;
        this.moveCount = 0;
        this.phase = 'playing';
        this.rev++;
        this.pushLog('再来一局！黑白互换，黑先行');
        this.emitState();
        // 换色后重发 joined，让每个客户端知道自己的新颜色
        for (const [cws, c] of this.conns) {
          if (c.playerId) {
            const p = this.players.find(pp => pp.id === c.playerId);
            if (p) this.send(cws, { type: 'joined', playerId: p.id, color: p.color });
          }
        }
        break;
      }
    }
  }

  onClose(ws) {
    const changed = !!this.conns.get(ws) && (!!this.conns.get(ws).playerId || !!this.conns.get(ws).spectator);
    const conn = this.conns.get(ws);
    if (conn && conn.playerId) {
      const p = this.players.find(x => x.id === conn.playerId);
      if (p) {
        p.connected = false;
        this.pushLog(`${p.name} 掉线了`);
      }
    } else if (conn && conn.spectator) {
      this.pushLog('一位观看者离开了');
    }
    this.conns.delete(ws);
    if (changed) this.emitRoster();   // 离开只同步名单，不重发全棋盘
  }

  getPlayer(ws) {
    const conn = this.conns.get(ws);
    if (!conn || !conn.playerId) return null;
    return this.players.find(p => p.id === conn.playerId) || null;
  }
}

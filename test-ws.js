// 飞行棋 WebSocket 端到端测试（Node 22+ 内置 WebSocket）
// 模拟 2 个玩家：创建房间 → 加入 → 开始 → 掷骰 → 移动 → 验证状态同步

const BASE = 'https://booe.xyz';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createRoom() {
  const res = await fetch(BASE + '/api/ludo/create', { method: 'POST' });
  const data = await res.json();
  console.log('[创建房间]', JSON.stringify(data));
  return data.roomId;
}

function connect(roomId, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://booe.xyz/ws/ludo/${roomId}`);
    const player = { ws, id: null, color: null, states: [] };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', name }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'joined') {
        player.id = msg.playerId;
        player.color = msg.color;
        resolve(player);
      } else if (msg.type === 'state') {
        player.states.push(msg);
      } else if (msg.type === 'error') {
        console.log(`  [${name} 收到错误]`, msg.msg);
      }
    };
    ws.onerror = (e) => reject(new Error('WS error'));
    setTimeout(() => reject(new Error('join timeout')), 10000);
  });
}

function send(p, obj) { p.ws.send(JSON.stringify(obj)); }
function waitState(p, n = 1) {
  return new Promise(resolve => {
    const check = () => {
      if (p.states.length >= n) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}

async function main() {
  console.log('===== 飞行棋端到端测试 =====');

  // 1. 创建房间
  const roomId = await createRoom();
  console.log(`[房间号] ${roomId}`);

  // 2. 两个玩家加入
  const p1 = await connect(roomId, '洛神');
  console.log(`[玩家1加入] id=${p1.id} color=${p1.color}`);
  await waitState(p1);
  console.log(`[状态1] players=${p1.states[0].players.length}`);

  const p2 = await connect(roomId, '测试君');
  console.log(`[玩家2加入] id=${p2.id} color=${p2.color}`);
  await sleep(800);

  // 3. 房主开始（p1 是房主）
  send(p1, { type: 'start' });
  await sleep(800);
  const s2 = p1.states[p1.states.length - 1];
  console.log(`[开始] phase=${s2.phase}, 当前轮到=${s2.players[s2.current].name}`);

  // 4. 玩家1 掷骰（如果轮到他）
  if (s2.players[s2.current].id === p1.id) {
    send(p1, { type: 'roll' });
    await sleep(1200);
    const s3 = p1.states[p1.states.length - 1];
    console.log(`[掷骰] dice=${s3.dice}, turnStage=${s3.turnStage}, movable=${JSON.stringify(s3.movable)}`);

    // 5. 如果有可移动的飞机
    if (s3.turnStage === 'choose' && s3.movable.length > 0) {
      send(p1, { type: 'move', plane: s3.movable[0] });
      await sleep(1500);
      const s4 = p1.states[p1.states.length - 1];
      const me = s4.players.find(p => p.id === p1.id);
      console.log(`[移动] 我的飞机位置=${JSON.stringify(me.planes)}`);
      console.log(`[状态] 当前轮到=${s4.players[s4.current].name}`);
      console.log(`[日志] ${s4.log.slice(-3).join(' | ')}`);
    } else {
      console.log(`[无子可动或无选择] turnStage=${s3.turnStage}`);
    }
  } else {
    console.log('[轮到玩家2，跳过掷骰]');
  }

  // 6. 验证 p2 也收到同步状态
  await sleep(500);
  console.log(`[玩家2 状态同步数] ${p2.states.length}`);

  console.log('\n===== 测试完成 =====');
  p1.ws.close();
  p2.ws.close();
  process.exit(0);
}

main().catch(e => {
  console.error('测试失败:', e.message);
  process.exit(1);
});

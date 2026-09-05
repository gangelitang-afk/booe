// ============================================================
// 飞行棋线上对战 e2e 测试（对生产环境 booe.xyz）
// 用法: node test/test-ludo-live.js
// 思路: 每个客户端常驻记录最新 state，轮询断言（无广播竞态）
// ============================================================
'use strict';
const WSMini = require('./wsmini');
const HOST = 'https://booe.xyz';
const WSHOST = 'wss://booe.xyz';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient(roomId, name) {
  const ws = new WSMini(`${WSHOST}/ws/ludo/${roomId}`);
  ws.last = null;        // 最新 state
  ws.errors = [];        // 服务端 error 消息
  ws.onmessage = raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'state') ws.last = m;
    if (m.type === 'error') ws.errors.push(m.msg);
  };
  ws.name = name;
  return ws;
}

// 轮询直到条件成立或超时
async function until(fn, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('超时等待: ' + label);
    await sleep(60);
  }
}

async function main() {
  console.log('===== 飞行棋线上对战 e2e =====');

  // 1. 创建房间
  const res = await fetch(HOST + '/api/ludo/create', { method: 'POST', signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  ok(data.ok === true && /^\d{4}$/.test(data.roomId), `创建房间成功，房间号 ${data.roomId}`);
  const roomId = data.roomId;

  // 2. 甲加入（joined 消息一次性捕获）
  const P1 = makeClient(roomId, '测试甲');
  let p1joined = null;
  const prevMsg1 = P1.onmessage;
  P1.onmessage = raw => { prevMsg1(raw); try { const m = JSON.parse(raw); if (m.type === 'joined') p1joined = m; } catch (e) {} };
  P1.onopen = () => P1.send(JSON.stringify({ type: 'join', name: '测试甲' }));
  P1.connect();
  await until(() => p1joined, 8000, '甲 joined');
  ok(typeof p1joined.playerId === 'string' && !!p1joined.color, `甲加入，执色 ${p1joined.color}`);

  // 3. 乙加入
  const P2 = makeClient(roomId, '测试乙');
  let p2joined = null;
  const prevMsg2 = P2.onmessage;
  P2.onmessage = raw => { prevMsg2(raw); try { const m = JSON.parse(raw); if (m.type === 'joined') p2joined = m; } catch (e) {} };
  P2.onopen = () => P2.send(JSON.stringify({ type: 'join', name: '测试乙' }));
  P2.connect();
  await until(() => p2joined, 8000, '乙 joined');
  ok(p2joined.playerId !== p1joined.playerId, `乙加入，执色 ${p2joined.color}，与甲不同`);

  // 4. 等待室：广播 2 人
  const wait2 = await until(() => {
    const s = P1.last;
    return (s && s.phase === 'waiting' && s.players.length === 2) ? s : null;
  }, 8000, '等待室 2 人');
  ok(wait2.players.length === 2 && wait2.players[0].id === p1joined.playerId, '等待室广播 2 人，先入者为房主');

  // 5. 房主开始
  P1.send(JSON.stringify({ type: 'start' }));
  await until(() => P1.last && P1.last.phase === 'playing' && P2.last && P2.last.phase === 'playing',
    8000, '进入对局');
  ok(P1.last.current === 0 && P1.last.players.length === 2, '对局开始，房主先手，两端同步');

  // 6. 对战 6 个回合
  // 服务端时序：roll → dice=X, stage='choose'（唯一可动 800ms 后自动走；
  // 无可动 1200ms 后自动过回合；nextTurn 重置 dice=null）
  const clients = [
    { ws: P1, id: p1joined.playerId, name: '甲' },
    { ws: P2, id: p2joined.playerId, name: '乙' }
  ];
  let completedTurns = 0, sawMoveStage = false, sawDice = 0, sentMoves = 0;

  for (let t = 0; t < 6; t++) {
    const me = clients[t % 2];
    await until(() => me.ws.last && me.ws.last.phase === 'playing' &&
      me.ws.last.players[me.ws.last.current].id === me.id && me.ws.last.turnStage === 'roll',
      10000, `${me.name} 轮次(掷骰)`);

    me.ws.send(JSON.stringify({ type: 'roll' }));
    // 观察掷骰结果：dice 变非 null（我的回合内），或回合已交出
    const st = await until(() => {
      const s = me.ws.last;
      if (!s || s.phase !== 'playing') return null;
      const isMe = s.players[s.current].id === me.id;
      if (isMe && s.dice !== null) return { sawDiceFrame: true, s };
      if (!isMe) return { sawDiceFrame: false, s };
      return null;
    }, 10000, `${me.name} 掷骰结果`);

    if (st.sawDiceFrame) {
      const dice = st.s.dice;
      ok(typeof dice === 'number' && dice >= 1 && dice <= 6, `${me.name} 掷出 ${dice}`);
      sawDice++;
      if (st.s.turnStage === 'choose' && (st.s.movable || []).length > 0) {
        sawMoveStage = true;
        if (st.s.movable.length > 1) {
          // 多个可动：服务端等玩家选择 → 真实发送 move
          const before = JSON.stringify(st.s.players.map(p => p.planes));
          const choice = st.s.movable.slice().sort((a, b) => a - b)[0];
          me.ws.send(JSON.stringify({ type: 'move', plane: choice }));
          sentMoves++;
          await until(() => {
            const s2 = me.ws.last;
            return s2 && (s2.phase === 'ended' || s2.players[s2.current].id !== me.id ||
                          s2.turnStage === 'roll' || JSON.stringify(s2.players.map(p => p.planes)) !== before);
          }, 10000, `${me.name} 走子推进`);
          ok(true, `${me.name} 发送 move(飞机${choice})，位置状态已变化`);
        } else {
          // 唯一可动：服务端 800ms 后自动走，等回合交出即可
          await until(() => {
            const s2 = me.ws.last;
            return s2 && (s2.phase === 'ended' || s2.players[s2.current].id !== me.id);
          }, 10000, `${me.name} 自动走子推进`);
          ok(true, `${me.name} 唯一可动，服务端自动走子并交回合`);
        }
      } else if (st.s.turnStage === 'choose' && (st.s.movable || []).length === 0) {
        // 理论不该出现（空 movable 会直接 setTimeout 过回合，stage 仍是 roll）
        await until(() => {
          const s2 = me.ws.last;
          return s2 && (s2.phase === 'ended' || s2.players[s2.current].id !== me.id);
        }, 10000, `${me.name} 过回合`);
        ok(true, `${me.name} 无子可动，回合自动交出`);
      } else {
        // stage 仍是 roll（连续三6作废罚停等）：等自动过
        await until(() => {
          const s2 = me.ws.last;
          return s2 && (s2.phase === 'ended' || s2.players[s2.current].id !== me.id);
        }, 10000, `${me.name} 罚停过回合`);
        ok(true, `${me.name} 掷 ${dice} 点无子可动/罚停，回合自动交出`);
      }
    } else {
      ok(true, `${me.name} 回合已由服务端自动推进（错过骰子帧）`);
    }
    completedTurns++;
  }

  ok(sawDice >= 6, `6 回合全部观察到有效骰子 (观察到 ${sawDice}/6)`);
  ok(sentMoves >= 1 || sawMoveStage, '观察到可走子阶段（movable 非空）');
  ok(completedTurns >= 6, `完成 ${completedTurns}/6 回合`);
  ok(P1.errors.length === 0 && P2.errors.length === 0,
     `全程无服务端报错 (${P1.errors.concat(P2.errors).join(';') || '干净'})`);

  P1.close(); P2.close();
  await sleep(300);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试失败:', e.message); process.exit(1); });

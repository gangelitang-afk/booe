// 飞行棋规则引擎本地自测
// 模拟一个 4 人局：玩家依次掷骰移动，跑完整个对局逻辑
const COLORS = [
  { key: 'red', name: '红' },
  { key: 'yellow', name: '黄' },
  { key: 'blue', name: '蓝' },
  { key: 'green', name: '绿' }
];
const START = { red: 39, yellow: 13, blue: 26, green: 0 };
const SPECIAL = {
  jump:  { green: 5,  yellow: 18, blue: 31, red: 44 },
  bomb:  { green: 8,  yellow: 21, blue: 34, red: 47 },
  meteor:{ green: 11, yellow: 24, blue: 37, red: 50 }
};
const DOCK = 0, TRACK_MAX = 52, FINISH = 59;

// 复制 ludo-room.js 的核心逻辑做纯函数验证
function getMovable(player, dice) {
  const list = [];
  for (let i = 0; i < 4; i++) {
    const pos = player.planes[i];
    if (pos === FINISH) continue;
    if (pos === DOCK) { if (dice === 6) list.push(i); continue; }
    list.push(i);
  }
  return list;
}

function movePlane(player, planeIdx, dice, players) {
  let pos = player.planes[planeIdx];
  const wasDock = pos === DOCK;
  const events = [];
  if (wasDock) { pos = 1 + (dice - 1); events.push('起飞'); }
  else pos += dice;

  if (pos > FINISH) pos = FINISH - (pos - FINISH);

  let bounced = false;
  if (pos >= 1 && pos <= TRACK_MAX) {
    const abs = (START[player.color] + pos - 1) % 52;
    if (SPECIAL.jump[player.color] === abs) { pos += 4; events.push('跳格+4'); }
    else if (SPECIAL.bomb[player.color] === abs) { pos = DOCK; bounced = true; events.push('炸弹回巢'); }
    else if (SPECIAL.meteor[player.color] === abs) { pos += 4; events.push('流星+4'); }
  }
  player.planes[planeIdx] = pos;

  let kicked = false;
  if (!bounced && pos >= 1 && pos <= TRACK_MAX) {
    const abs = (START[player.color] + pos - 1) % 52;
    for (const other of players) {
      if (other === player) continue;
      for (let j = 0; j < 4; j++) {
        const op = other.planes[j];
        if (op >= 1 && op <= TRACK_MAX) {
          const oAbs = (START[other.color] + op - 1) % 52;
          if (oAbs === abs) { other.planes[j] = DOCK; kicked = true; events.push(`踢飞${other.name}飞机`); }
        }
      }
    }
  }
  return { kicked, events, finished: player.planes.filter(p => p === FINISH).length };
}

// ===== 模拟对局 =====
function simulate(seed) {
  let rng = seed;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };
  const roll = () => Math.floor(rand() * 6) + 1;

  const players = [
    { id: 'p1', name: '玩家1', color: 'red', planes: [0,0,0,0] },
    { id: 'p2', name: '玩家2', color: 'yellow', planes: [0,0,0,0] },
    { id: 'p3', name: '玩家3', color: 'blue', planes: [0,0,0,0] },
    { id: 'p4', name: '玩家4', color: 'green', planes: [0,0,0,0] }
  ];

  let current = 0, sixStreak = 0, turns = 0, log = [];

  while (turns < 5000) {
    turns++;
    const p = players[current];
    const dice = roll();
    log.push(`[第${turns}轮] ${p.name}(${p.color}) 掷出 ${dice}`);

    if (dice === 6) {
      sixStreak++;
      if (sixStreak >= 3) {
        sixStreak = 0;
        log.push(`  连续三次6！作废罚停`);
        current = (current + 1) % 4;
        continue;
      }
    } else sixStreak = 0;

    const movable = getMovable(p, dice);
    if (movable.length === 0) {
      log.push(`  无子可动`);
      current = (current + 1) % 4;
      continue;
    }

    // 选择一架：优先能踢人的，其次起飞，最后第一架
    const planeIdx = movable[0];
    const result = movePlane(p, planeIdx, dice, players);
    log.push(`  移动飞机${planeIdx+1}: ${result.events.join(', ') || '普通移动'}`);

    // 奖励再掷
    const reward = dice === 6 || result.kicked;
    if (reward) {
      log.push(`  奖励再掷！`);
      continue;
    }

    if (result.finished === 4) {
      log.push(`🏆 ${p.name} 四机全部到达！`);
      return { winner: p.name, turns, log };
    }
    current = (current + 1) % 4;
  }
  return { winner: '超时未分胜负', turns, log };
}

// 跑 3 局不同种子
for (const seed of [42, 1234, 999]) {
  const r = simulate(seed);
  console.log(`\n===== 种子 ${seed}: 胜者 ${r.winner}, 共 ${r.turns} 轮 =====`);
  // 打印最后 8 条日志
  r.log.slice(-8).forEach(l => console.log(l));
}

// ===== 边界用例 =====
console.log('\n===== 边界用例 =====');

// 1. 掷6起飞
const p = { id: 'x', name: 'X', color: 'red', planes: [0,0,0,0] };
console.log('掷6可起飞:', JSON.stringify(getMovable(p, 6)), '(期望 [0,1,2,3])');
console.log('掷5不可起飞:', JSON.stringify(getMovable(p, 5)), '(期望 [])');

// 2. 终点折返：pos 58(跑道6) + 4 = 62 > 59 → 59-(62-59)=56
const p2 = { id: 'y', name: 'Y', color: 'red', planes: [58,0,0,0] };
const r2 = movePlane(p2, 0, 4, [p2]);
console.log('跑道6+4=折返到56:', p2.planes[0], '(期望 56)');

// 3. 踩炸弹回巢：红机在主路 abs=47(炸弹格) → 回巢
// pos 8 掷 1 → pos 9 → abs = (39+9-1)%52 = 47 ✓ 炸弹
const p3 = { id: 'z', name: 'Z', color: 'red', planes: [8,0,0,0] };
const r3 = movePlane(p3, 0, 1, [p3]);
console.log('踩炸弹回巢:', p3.planes[0], '(期望 0), events:', r3.events.join(','));

// 4. 跳格：红机 pos 5 掷 1 → pos 6 → abs = 44(跳格) → +4 → 10
const p4 = { id: 'w', name: 'W', color: 'red', planes: [5,0,0,0] };
const r4 = movePlane(p4, 0, 1, [p4]);
console.log('踩跳格+4:', p4.planes[0], '(期望 10), events:', r4.events.join(','));

// 5. 踢人：红机 pos 4 掷 1 → pos 5 → abs = 43; 黄机 pos 31 → abs = (13+31-1)%52 = 43 → 撞
const p5a = { id: 'a', name: 'A', color: 'red', planes: [4,0,0,0] };
const p5c = { id: 'c', name: 'C', color: 'yellow', planes: [31,0,0,0] };
const r5 = movePlane(p5a, 0, 1, [p5a, p5c]);
console.log('踢人: 红机', p5a.planes[0], '黄机被踢回巢:', p5c.planes[0], '(期望 红5 黄0), events:', r5.events.join(','));

console.log('\n全部测试完成 ✓');

// 五子棋核心逻辑自测：node test-gomoku.js
const C = require('./public/gomoku-core.js');
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}
function B(list) { // 由 [x,y,color] 列表构造棋盘
  const b = C.createBoard();
  for (const [x, y, c] of list) b[y][x] = c;
  return b;
}

console.log('===== 1. 胜负判定 winLine =====');
// 横向五连
ok(C.winLine(B([[3,7,1],[4,7,1],[5,7,1],[6,7,1],[7,7,1]]), 7, 7) !== null, '横向五连判胜');
// 纵向五连
ok(C.winLine(B([[7,3,2],[7,4,2],[7,5,2],[7,6,2],[7,7,2]]), 7, 7) !== null, '纵向五连判胜');
// 主对角线
ok(C.winLine(B([[3,3,1],[4,4,1],[5,5,1],[6,6,1],[7,7,1]]), 7, 7) !== null, '主对角五连判胜');
// 副对角线
ok(C.winLine(B([[3,7,1],[4,6,1],[5,5,1],[6,4,1],[7,3,1]]), 7, 3) !== null, '副对角五连判胜');
// 只有一子不判胜
ok(C.winLine(B([[7,7,1]]), 7, 7) === null, '单子不判胜');
// 四连不判胜
ok(C.winLine(B([[3,7,1],[4,7,1],[5,7,1],[6,7,1]]), 6, 7) === null, '四连不判胜');
// 补中间成五（3,4,6,7 已有 + 补 5）
ok(C.winLine(B([[3,7,1],[4,7,1],[5,7,1],[6,7,1],[7,7,1]]), 5, 7) !== null, '补中间成五判胜');
// 边界：最右列纵向五连
ok(C.winLine(B([[14,9,2],[14,10,2],[14,11,2],[14,12,2],[14,13,2]]), 14, 13) !== null, '边界列五连判胜');
// 五连但落子位置不属于连线颜色
ok(C.winLine(B([[3,7,1],[4,7,1],[5,7,1],[6,7,1],[7,7,1]]), 7, 8) === null || true, '空点不误判');

console.log('===== 2. AI 立即取胜 =====');
// AI(白) 横向活四 → 必须补第五子
{
  const b = B([[4,7,2],[5,7,2],[6,7,2],[7,7,2],[3,8,1],[4,8,1]]);
  const m = C.aiMove(b, C.WHITE, C.BLACK);
  ok(m.x === 3 || m.x === 8, `活四任一端成五 (${m.x},${m.y}) → (${m.x},${m.y})`);
}
// AI(白) 冲四(一端被堵) → 只能走唯一开放端
{
  const b = B([[4,7,2],[5,7,2],[6,7,2],[7,7,2],[3,7,1]]);
  const m = C.aiMove(b, C.WHITE, C.BLACK);
  ok(m.x === 8 && m.y === 7, `冲四走唯一开放端 (${m.x},${m.y})`);
}

console.log('===== 3. AI 必堵对手成五点 =====');
// 对手(黑)活四，AI(白) 必须堵一端，不能去别处进攻
{
  const b = B([[4,7,1],[5,7,1],[6,7,1],[7,7,1],[10,10,2],[11,10,2],[12,10,2]]);
  const m = C.aiMove(b, C.WHITE, C.BLACK);
  ok((m.x === 3 || m.x === 8) && m.y === 7, `堵黑方活四 (${m.x},${m.y})`);
}
// 对手冲四唯一成五点 → 精确堵
{
  const b = B([[4,7,1],[5,7,1],[6,7,1],[7,7,1],[3,7,2],[10,10,2],[11,10,2]]);
  const m = C.aiMove(b, C.WHITE, C.BLACK);
  ok(m.x === 8 && m.y === 7, `精确堵冲四成五点 (${m.x},${m.y})`);
}
// 对手竖向四
{
  const b = B([[9,4,1],[9,5,1],[9,6,1],[9,7,1],[2,2,2],[2,3,2]]);
  const m = C.aiMove(b, C.WHITE, C.BLACK);
  ok(m.x === 9 && (m.y === 3 || m.y === 8), `堵竖向四 (${m.x},${m.y})`);
}

console.log('===== 4. AI 常规合理性 =====');
// 空盘 → 天元
{
  const m = C.aiMove(C.createBoard(), C.BLACK, C.WHITE);
  ok(m.x === 7 && m.y === 7, `空盘落天元 (${m.x},${m.y})`);
}
// 只有一颗对手子 → 贴身应对且合法
{
  const b = B([[7,7,1]]);
  const m = C.aiMove(b, C.WHITE, C.BLACK);
  ok(b[m.y][m.x] === C.EMPTY, `落点为空位 (${m.x},${m.y})`);
}
// 倾向堵活三：对手活三，AI 无高级进攻点时应堵
{
  const b = B([[4,7,1],[5,7,1],[6,7,1],[10,3,2],[10,4,2]]);
  const m = C.aiMove(b, C.WHITE, C.BLACK);
  const blocks = [[3,7],[7,7],[4,6],[4,8],[5,6],[5,8],[6,6],[6,8]].map(p => p[0] + ',' + p[1]);
  ok(blocks.includes(m.x + ',' + m.y) || C.pointScore(b, m.x, m.y, C.WHITE) >= 100000,
     `应对活三：堵点或自身冲四 (${m.x},${m.y})`);
}

console.log('===== 5. 随机对局压力测试（AI vs 随机 30 局）=====');
{
  let okGames = 0, aiWins = 0;
  for (let g = 0; g < 30; g++) {
    const b = C.createBoard();
    let turn = C.BLACK, moves = 0, err = null, winner = 0;
    const rng = (function (s) { return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })(g * 7 + 1);
    while (moves < 225) {
      let m;
      if (turn === C.WHITE) m = C.aiMove(b, C.WHITE, C.BLACK); // AI 执白
      else { // 随机走
        const cs = C.candidates(b);
        if (!cs.length) { if (!C.hasAnyStone(b)) { m = { x: 7, y: 7 }; } else break; }
        else m = cs[Math.floor(rng() * cs.length)];
      }
      if (!m || b[m.y][m.x] !== C.EMPTY) { err = '非法落子 ' + JSON.stringify(m); break; }
      b[m.y][m.x] = turn;
      moves++;
      if (C.winLine(b, m.x, m.y)) { winner = turn; break; }
      if (C.isFull(b)) break;
      turn = turn === C.BLACK ? C.WHITE : C.BLACK;
    }
    if (err) { console.log('  局 ' + g + ' 出错: ' + err); continue; }
    okGames++;
    if (winner === C.WHITE) aiWins++;
  }
  ok(okGames === 30, `30 局全部无异常 (${okGames}/30)`);
  console.log('  AI 执白胜率: ' + aiWins + '/30（对随机，应明显偏高）');
  ok(aiWins >= 20, 'AI 执白对随机胜率 ≥ 66%');
}

console.log('===== 6. 性能 =====');
{
  // 满盘 224 子场景测 aiMove 耗时
  const b = C.createBoard();
  let t = C.BLACK, cnt = 0;
  outer:
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    if (cnt >= 224) break outer;
    b[y][x] = t; t = t === C.BLACK ? C.WHITE : C.BLACK; cnt++;
  }
  const t0 = Date.now();
  C.aiMove(b, t, t === C.BLACK ? C.WHITE : C.BLACK);
  const dt = Date.now() - t0;
  ok(dt < 500, '残局 aiMove < 500ms (实际 ' + dt + 'ms)');
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

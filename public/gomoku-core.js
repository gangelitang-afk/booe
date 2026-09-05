// ============================================================
// 五子棋核心逻辑（纯函数，无 DOM 依赖）
// 浏览器：window.GomokuCore；Node：require('./gomoku-core')
// 棋盘 board[y][x]，0=空 1=黑 2=白
// ============================================================
(function (global) {
  'use strict';

  var SIZE = 15, EMPTY = 0, BLACK = 1, WHITE = 2;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function createBoard() {
    var b = [];
    for (var y = 0; y < SIZE; y++) b.push(new Array(SIZE).fill(EMPTY));
    return b;
  }

  function inBoard(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }

  // 落子 (x,y) 后检查胜利，返回连线坐标数组（>=5 子）或 null
  function winLine(board, x, y) {
    var color = board[y][x];
    if (!color) return null;
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var line = [[x, y]];
      for (var s = -1; s <= 1; s += 2) {
        var nx = x + dx * s, ny = y + dy * s;
        while (inBoard(nx, ny) && board[ny][nx] === color) {
          line.push([nx, ny]);
          nx += dx * s; ny += dy * s;
        }
      }
      if (line.length >= 5) {
        line.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        return line;
      }
    }
    return null;
  }

  function isFull(board) {
    for (var y = 0; y < SIZE; y++)
      for (var x = 0; x < SIZE; x++)
        if (board[y][x] === EMPTY) return false;
    return true;
  }

  function hasAnyStone(board) {
    for (var y = 0; y < SIZE; y++)
      for (var x = 0; x < SIZE; x++)
        if (board[y][x] !== EMPTY) return true;
    return false;
  }

  // ---- 模式评分：[连子数, 开放端数] -> 分值 ----
  function shapeScore(count, open) {
    if (count >= 5) return 1000000;      // 成五
    if (open === 0) return 0;            // 两头堵死
    if (count === 4) return open === 2 ? 100000 : 12000; // 活四 / 冲四
    if (count === 3) return open === 2 ? 8000 : 600;     // 活三 / 眠三
    if (count === 2) return open === 2 ? 400 : 60;
    if (count === 1) return open === 2 ? 40 : 5;
    return 0;
  }

  // 假设 color 在 (x,y) 落子，四方向模式分之和
  function pointScore(board, x, y, color) {
    var total = 0;
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var count = 1, openA = 0, openB = 0;
      var nx = x + dx, ny = y + dy;
      while (inBoard(nx, ny) && board[ny][nx] === color) { count++; nx += dx; ny += dy; }
      if (inBoard(nx, ny) && board[ny][nx] === EMPTY) openA = 1;
      nx = x - dx; ny = y - dy;
      while (inBoard(nx, ny) && board[ny][nx] === color) { count++; nx -= dx; ny -= dy; }
      if (inBoard(nx, ny) && board[ny][nx] === EMPTY) openB = 1;
      total += shapeScore(count, openA + openB);
    }
    return total;
  }

  // 候选点：已有棋子 2 格切比雪夫距离内的空点
  function candidates(board) {
    var set = {}, out = [];
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        if (board[y][x] === EMPTY) continue;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var nx = x + dx, ny = y + dy;
            if (inBoard(nx, ny) && board[ny][nx] === EMPTY) set[ny * SIZE + nx] = 1;
          }
        }
      }
    }
    for (var k in set) {
      var n = +k;
      out.push({ x: n % SIZE, y: Math.floor(n / SIZE) });
    }
    return out;
  }

  // AI 选点：me=AI 棋色，opp=对手棋色。返回 {x,y}
  function aiMove(board, me, opp) {
    if (!hasAnyStone(board)) return { x: 7, y: 7 }; // 空盘落天元
    var cands = candidates(board);
    if (!cands.length) return { x: 7, y: 7 };

    // 1. 能立即成五 → 直接赢
    for (var i = 0; i < cands.length; i++) {
      if (pointScore(board, cands[i].x, cands[i].y, me) >= 1000000) return cands[i];
    }
    // 2. 对手下一手能成五 → 必须堵（候选里挑综合分最高的堵点）
    var mustBlock = null, blockScore = -1;
    for (var j = 0; j < cands.length; j++) {
      if (pointScore(board, cands[j].x, cands[j].y, opp) >= 1000000) {
        var s = pointScore(board, cands[j].x, cands[j].y, me);
        if (s > blockScore) { blockScore = s; mustBlock = cands[j]; }
      }
    }
    if (mustBlock) return mustBlock;

    // 3. 常规评分：进攻 + 防守(0.85 权重) + 中心微加分
    var best = null, bestScore = -1;
    for (var k = 0; k < cands.length; k++) {
      var c = cands[k];
      var atk = pointScore(board, c.x, c.y, me);
      var def = pointScore(board, c.x, c.y, opp);
      var center = 7 - Math.max(Math.abs(c.x - 7), Math.abs(c.y - 7));
      var score = atk + def * 0.85 + center;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  var GomokuCore = {
    SIZE: SIZE, EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE,
    createBoard: createBoard, winLine: winLine, isFull: isFull,
    hasAnyStone: hasAnyStone,
    aiMove: aiMove, pointScore: pointScore, candidates: candidates
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GomokuCore;
  else global.GomokuCore = GomokuCore;
})(typeof window !== 'undefined' ? window : this);

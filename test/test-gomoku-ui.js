// ============================================================
// 五子棋 UI 真实交互测试（CDP 驱动无头 Chrome 点击 canvas）
// 用法: node test/test-gomoku-ui.js
// 验证: 真实点击落子 → 五连判胜 → 胜利横幅；人机模式 AI 应答
// ============================================================
'use strict';
const { spawn } = require('child_process');
const WSMini = require('./wsmini');
const http = require('http');

const CHROME = 'C:/Users/AI/.cache/hyperframes/chrome/chrome-headless-shell/win64-152.0.7928.2/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PAGE = 'file:///C:/Users/AI/AppData/Local/hermes/workspace/booe-repo/public/gomoku.html';
const PORT = 9333;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  // 1. 启动无头 Chrome
  const chrome = spawn(CHROME, [
    '--headless', '--no-sandbox', '--no-proxy-server', '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:/tmp/booe/cdp-gomoku',
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    // 2. 等 debug 端口就绪
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try { targets = await httpJson('/json/list'); break; } catch (e) { await sleep(250); }
    }
    if (!targets) throw new Error('CDP 端口未就绪');
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('找不到 page target');

    // 3. CDP over WebSocket
    const ws = new WSMini(page.webSocketDebuggerUrl.replace('ws://localhost', 'ws://127.0.0.1'));
    let msgId = 0;
    const pending = {};
    ws.onmessage = raw => {
      const m = JSON.parse(raw);
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    };
    ws.connect();
    await sleep(300);
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId;
      pending[id] = resolve;
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails;
        console.log('  [页面异常]', d.exception && d.exception.description || d.text, 'expr:', expr.slice(0, 60));
        return undefined;
      }
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    await send('Page.enable');
    // 页面脚本运行前注入错误收集器 + 点击助手
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__errs = [];
      window.addEventListener('error', e => __errs.push(String(e.message)));
      window.__click = (gx, gy) => {
        const cv = document.getElementById('board');
        const r = cv.getBoundingClientRect();
        const k = r.width / cv.width; // canvas 坐标 → CSS 像素
        const x = r.left + (PAD + gx * CELL) * k + 1;
        const y = r.top + (PAD + gy * CELL) * k + 1;
        cv.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
      };
    ` });
    await send('Page.navigate', { url: PAGE });
    await sleep(1500);

    ok((await evalJs(`typeof GomokuCore === 'object' && !!GomokuCore.SIZE`)) === true, '页面加载：GomokuCore 已就绪');

    // ===== 测试 1：双人模式真实点击，黑方五连获胜 =====
    ok((await evalJs('mode')) === 'pvp', '默认双人同屏模式');
    // 黑: (3,7)(4,7)(5,7)(6,7)(7,7)；白填边角
    const seq = [[3,7],[0,0],[4,7],[0,1],[5,7],[0,2],[6,7],[0,3],[7,7]];
    for (const [gx, gy] of seq) { await evalJs(`__click(${gx},${gy})`); await sleep(60); }
    ok((await evalJs('hist.length')) === 9, `点击 9 次全部落子 (hist=${await evalJs('hist.length')})`);
    ok((await evalJs('board[7][5]')) === 1, '黑方棋子落在 (5,7)');
    ok((await evalJs('board[0][0]')) === 2, '白方棋子落在 (0,0)');
    ok((await evalJs('!!winInfo')) === true, '五连判定触发 winInfo');
    ok((await evalJs('JSON.stringify(winInfo)')) === JSON.stringify([[3,7],[4,7],[5,7],[6,7],[7,7]]),
       `胜利连线坐标正确 (${await evalJs('JSON.stringify(winInfo)')})`);
    ok((await evalJs(`document.getElementById('winBanner').classList.contains('hidden')`)) === false, '胜利横幅弹出');
    ok((await evalJs('score.b')) === 1, '黑方局分 +1');

    // 悔棋：撤掉胜局恢复可下
    await evalJs(`undo()`);
    ok((await evalJs(`document.getElementById('winBanner').classList.contains('hidden')`)) === true, '悔棋后横幅关闭');

    // ===== 测试 2：人机·我先手，落子后 AI 应答 =====
    await evalJs(`setMode('pveb')`);
    await sleep(100);
    ok((await evalJs('hist.length')) === 0, '人机模式重开局');
    await evalJs(`__click(7,7)`);
    await sleep(120); // 人类落子即时
    ok((await evalJs('hist.length')) === 1, '我方落子成功');
    await sleep(900); // AI 280ms 延迟 + 计算
    ok((await evalJs('hist.length')) === 2, 'AI 已应答一手');
    ok((await evalJs('hist[1].color')) === 2, 'AI 执白');
    ok((await evalJs('board[hist[1].y][hist[1].x]')) === 2, 'AI 棋子真实落在棋盘上');

    // ===== 测试 3：人机·AI 先手 =====
    await evalJs(`setMode('pvew')`);
    await sleep(900);
    ok((await evalJs('hist.length')) === 1, 'AI 先手已落子');
    ok((await evalJs('hist[0].x')) === 7 && (await evalJs('hist[0].y')) === 7, 'AI 先手落天元');
    ok((await evalJs('hist[0].color')) === 1, 'AI 先手执黑');

    // ===== 测试 4：占子拒绝（点已有子的交叉点）=====
    await evalJs(`__click(7,7)`); // 点 AI 已占的天元
    await sleep(100);
    ok((await evalJs('hist.length')) === 1, '点击已占点位不会多出一子');

    // 错误收集
    const errs = await evalJs('__errs');
    ok(Array.isArray(errs) && errs.length === 0, `页面零 JS 报错 (${errs ? errs.join(';') : ''})`);

    // ===== 截图留证 =====
    await evalJs(`setMode('pveb'); __click(7,7); 'x'`);
    await sleep(900);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      require('fs').writeFileSync('C:/tmp/booe/n-gomoku-play.png', Buffer.from(shot.result.data, 'base64'));
      console.log('  📸 截图 n-gomoku-play.png 已保存');
    }

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    ws.close();
    process.exit(fail ? 1 : 0);
  } finally {
    chrome.kill();
  }
}

main().catch(e => { console.error('测试失败:', e.message); try { process.exit(1); } catch (_) {} });

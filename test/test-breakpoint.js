// 验证 index.html 桌面/手机版切换逻辑：
// 1) 桌面指针(默认) + 任意宽度 → 电脑版（不仁 + 导航）
// 2) 触屏模拟 + 390px → 手机版（求是 + 隐藏导航）
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const WSMini = require('./wsmini');
const http = require('http');

const CHROME = 'C:/Users/AI/.cache/hyperframes/chrome/chrome-headless-shell/win64-152.0.7928.2/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PAGE = 'file:///C:/Users/AI/AppData/Local/hermes/workspace/booe-repo/public/index.html';
const PORT = 9444;

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
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
  const chrome = spawn(CHROME, [
    '--headless', '--no-sandbox', '--no-proxy-server', '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:/tmp/booe/cdp-mq',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try { targets = await httpJson('/json/list'); break; } catch (e) { await sleep(250); }
    }
    const page = targets.find(t => t.type === 'page');
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
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const state = () => evalJs(`(function(){
      return {
        coarse: matchMedia('(pointer:coarse)').matches,
        narrow: matchMedia('(max-width:640px)').matches,
        brand: getComputedStyle(document.querySelector('.hero .cn-m')).display,
        nav: getComputedStyle(document.querySelector('.top nav')).display
      };
    })()`);
    const snap = async name => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      if (s.result && s.result.data) {
        fs.writeFileSync('C:/tmp/booe/' + name, Buffer.from(s.result.data, 'base64'));
        console.log('  📸 ' + name);
      }
    };

    await send('Page.enable');

    // ===== 场景 A：桌面指针，1440 宽 =====
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Page.navigate', { url: PAGE });
    await sleep(1500);
    let st = await state();
    ok(st.coarse === false && st.narrow === false && st.brand === 'none' && st.nav === 'flex',
       `桌面 1440px：不仁 + 导航 (${JSON.stringify(st)})`);
    await snap('mq-desktop-wide.png');

    // ===== 场景 B：桌面指针，600 窄窗口（用户遇到的场景）=====
    await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    st = await state();
    ok(st.coarse === false && st.narrow === true && st.brand === 'none' && st.nav === 'flex',
       `桌面窄窗 600px：仍是电脑版（不仁 + 导航） (${JSON.stringify(st)})`);
    await snap('mq-desktop-narrow.png');

    // ===== 场景 C：触屏 + 390px（真手机）=====
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: PAGE });
    await sleep(1500);
    st = await state();
    ok(st.coarse === true && st.narrow === true && st.brand === 'inline' && st.nav === 'none',
       `手机 390px：求是 + 隐藏导航 (${JSON.stringify(st)})`);
    await snap('mq-mobile.png');

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    ws.close();
    process.exit(fail ? 1 : 0);
  } finally {
    chrome.kill();
  }
}
main().catch(e => { console.error('测试失败:', e.message); try { process.exit(1); } catch (_) {} });

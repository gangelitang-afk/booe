// 验证设备分流：手机(触屏+390)访问 index.html → 自动跳 m.html 显示求是
// 桌面访问 index.html → 停留 D 版
'use strict';
const { spawn } = require('child_process');
const WSMini = require('./wsmini');
const http = require('http');

const CHROME = 'C:/Users/AI/.cache/hyperframes/chrome/chrome-headless-shell/win64-152.0.7928.2/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = 'file:///C:/Users/AI/AppData/Local/hermes/workspace/booe-repo/public/';
const PORT = 9555;

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
    '--user-data-dir=C:/tmp/booe/cdp-route',
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
    const goto = async url => {
      await send('Page.navigate', { url });
      // 等待页面关键内容出现（外链字体可能挂起 parsing，不能死等 readyState）
      for (let i = 0; i < 40; i++) {
        const ready = await evalJs(`document.readyState !== 'loading' && !!document.querySelector('.hero, .logo, .masthead')`);
        if (ready) { await sleep(300); return; }
        await sleep(250);
      }
    };

    await send('Page.enable');

    // ===== 场景 A：桌面指针 1440 → 停留 D 版 =====
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.clearDeviceMetricsOverride');
    await goto(BASE + 'index.html');
    let loc = await evalJs('location.pathname.split("/").pop()');
    let brand = await evalJs(`(document.querySelector('.logo b')||{}).textContent || ''`);
    ok(loc === 'index.html' && brand === '不仁', `桌面 1440：停留 index.html，刊头「${brand}」`);

    // ===== 场景 B：触屏 + 390 → 跳 m.html 显示求是 =====
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await goto(BASE + 'index.html');
    loc = await evalJs('location.pathname.split("/").pop()');
    brand = await evalJs(`(document.querySelector('.hero h1 .cn-m')||{}).textContent || ''`);
    const dbg = await evalJs(`(function(){
      var h1 = document.querySelector('.hero h1');
      return {
        title: document.title,
        readyState: document.readyState,
        h1html: h1 ? h1.innerHTML.slice(0,120) : 'NO H1',
        heroExists: !!document.querySelector('.hero')
      };
    })()`);
    console.log('  [调试]', JSON.stringify(dbg));
    ok(loc === 'm.html', `手机 390：自动跳转到 m.html (实际 ${loc})`);
    ok(brand === '求是', `手机版刊名「${brand}」`);

    // ===== 场景 C：触屏 + 390 直开 play.html（D版无分流，确认不误伤子页）=====
    await goto(BASE + 'play.html');
    loc = await evalJs('location.pathname.split("/").pop()');
    ok(loc === 'play.html', '子页 play.html 不做分流（触屏直接看也正常）');

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
    ws.close();
    process.exit(fail ? 1 : 0);
  } finally {
    chrome.kill();
  }
}
main().catch(e => { console.error('测试失败:', e.message); try { process.exit(1); } catch (_) {} });

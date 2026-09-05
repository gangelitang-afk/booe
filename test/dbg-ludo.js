// 调试：观察两个客户端加入时各自收到的消息
const WSMini = require('./wsmini');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const cr = await fetch('https://booe.xyz/api/ludo/create', { method: 'POST' }).then(r => r.json());
  console.log('room', cr.roomId);
  const mk = name => {
    const ws = new WSMini(`wss://booe.xyz/ws/ludo/${cr.roomId}`);
    ws.onopen = () => { console.log(name, 'OPEN'); ws.send(JSON.stringify({ type: 'join', name })); };
    ws.onmessage = d => console.log(name, 'MSG:', d.slice(0, 200));
    ws.onclose = e => console.log(name, 'CLOSE', e && e.message);
    ws.connect();
    return ws;
  };
  mk('A');
  await sleep(1500);
  mk('B');
  await sleep(2500);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

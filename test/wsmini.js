// ============================================================
// wsmini.js —— 零依赖极简 WebSocket 客户端（仅文本帧，测试用）
// 支持客户端掩码、分片长度、ping/pong、close
// 用法:
//   const WSMini = require('./wsmini');
//   const ws = new WSMini('wss://host/path');
//   ws.onopen / ws.onmessage(str) / ws.onclose
//   ws.send('...'); ws.close();
// ============================================================
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

class WSMini {
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
  }

  connect() {
    const u = new URL(this.url);
    const secure = u.protocol === 'wss:';
    const port = +u.port || (secure ? 443 : 80);
    const key = crypto.randomBytes(16).toString('base64');
    const path = u.pathname + (u.search || '');
    const req =
      `GET ${path} HTTP/1.1\r\n` +
      `Host: ${u.host}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`;

    const onSock = () => socket.write(req);
    const socket = secure
      ? tls.connect({ host: u.hostname, port, servername: u.hostname }, onSock)
      : net.connect({ host: u.hostname, port }, onSock);

    socket.on('error', e => { if (!this.closed && this.onclose) { this.closed = true; this.onclose(e); } });
    socket.on('close', () => { if (!this.closed && this.onclose) { this.closed = true; this.onclose(); } });
    socket.setNoDelay(true);
    this.socket = socket;

    let handshakeDone = false;
    socket.on('data', d => {
      this.buffer = Buffer.concat([this.buffer, d]);
      if (!handshakeDone) {
        const idx = this.buffer.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = this.buffer.slice(0, idx).toString();
        const statusLine = head.split('\r\n')[0];
        if (!/ 101 /.test(statusLine + ' ')) {
          if (!this.closed) { this.closed = true; if (this.onclose) this.onclose(new Error('握手失败: ' + statusLine)); }
          return;
        }
        this.buffer = this.buffer.slice(idx + 4);
        handshakeDone = true;
        if (this.onopen) this.onopen();
      }
      this._drain();
    });
  }

  _drain() {
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) return;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const maskLen = masked ? 4 : 0;
      if (b.length < off + maskLen + len) return;

      if (opcode === 0x8) { // close
        try { this.socket.end(); } catch (e) {}
        if (!this.closed) { this.closed = true; if (this.onclose) this.onclose(); }
        return;
      }
      if (opcode === 0x9) { // ping → pong
        this._sendFrame(0xA, b.slice(off + maskLen, off + maskLen + len));
        this.buffer = b.slice(off + maskLen + len);
        continue;
      }
      let payload = Buffer.from(b.slice(off + maskLen, off + maskLen + len));
      if (masked) {
        const mask = b.slice(off, off + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this.buffer = b.slice(off + maskLen + len);
      if ((opcode === 0x1 || opcode === 0x2) && this.onmessage) this.onmessage(payload.toString('utf8'));
    }
  }

  _sendFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(str) { this._sendFrame(0x1, Buffer.from(str, 'utf8')); }
  close() {
    try { this._sendFrame(0x8, Buffer.alloc(0)); } catch (e) {}
    try { this.socket.end(); } catch (e) {}
  }
}

module.exports = WSMini;

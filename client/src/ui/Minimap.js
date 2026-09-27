// Top-down track map with rider dots (canvas 2D).
import { FLAG } from '@shared/track.js';

export class Minimap {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.X[i]);
      maxX = Math.max(maxX, track.X[i]);
      minZ = Math.min(minZ, track.Z[i]);
      maxZ = Math.max(maxZ, track.Z[i]);
    }
    const pad = 16;
    const W = canvas.width;
    this.scale = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.ox = pad + ((W - pad * 2) - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oz = pad + ((W - pad * 2) - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
    // pre-render the static track layer
    this.base = document.createElement('canvas');
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    const c = this.base.getContext('2d');
    const path = (from = 0, to = track.count, filter = null) => {
      c.beginPath();
      let started = false;
      for (let i = from; i <= to; i += 3) {
        const k = i % track.count;
        if (filter && !(track.FLAGS[k] & filter)) {
          started = false;
          continue;
        }
        const [x, y] = this.map(track.X[k], track.Z[k]);
        if (!started) c.moveTo(x, y);
        else c.lineTo(x, y);
        started = true;
      }
    };
    c.lineCap = c.lineJoin = 'round';
    path();
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 9;
    c.stroke();
    c.strokeStyle = '#e9edf2';
    c.lineWidth = 4;
    c.stroke();
    path(0, track.count, FLAG.TUNNEL);
    c.strokeStyle = '#555';
    c.stroke();
    path(0, track.count, FLAG.BRIDGE);
    c.strokeStyle = '#4cc9f0';
    c.stroke();
    for (const s of track.checkpoints) {
      const p = track.toWorld(s, 0);
      const [x, y] = this.map(p.x, p.z);
      c.fillStyle = '#18c8ff';
      c.beginPath();
      c.arc(x, y, 3.2, 0, Math.PI * 2);
      c.fill();
    }
    const p0 = track.toWorld(0, 0);
    const [sx, sy] = this.map(p0.x, p0.z);
    c.fillStyle = '#fff';
    c.fillRect(sx - 5, sy - 5, 10, 10);
    c.fillStyle = '#111';
    c.fillRect(sx - 5, sy - 5, 5, 5);
    c.fillRect(sx, sy, 5, 5);
    this._w = {};
  }

  map(x, z) {
    return [this.ox + x * this.scale, this.oz + z * this.scale];
  }

  draw(riders) {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);
    let local = null;
    for (const r of riders) {
      if (r.isLocal) {
        local = r;
        continue;
      }
      const p = this.track.toWorld(r.s, r.d, this._w);
      const [x, y] = this.map(p.x, p.z);
      c.fillStyle = r.color;
      c.strokeStyle = '#111';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(x, y, 4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (local) {
      const p = this.track.toWorld(local.s, local.d, this._w);
      const [x, y] = this.map(p.x, p.z);
      const h = p.head;
      c.save();
      c.translate(x, y);
      c.rotate(-h + Math.PI);
      c.fillStyle = '#ff5a1f';
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -8);
      c.lineTo(6, 6);
      c.lineTo(0, 3);
      c.lineTo(-6, 6);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
  }
}

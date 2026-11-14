// Pack PNGs into a Windows .ico (PNG-compressed entries, Vista and later). Usage: bun png-to-ico.ts out.ico a.png b.png …
const [out, ...pngs] = process.argv.slice(2);
const imgs = await Promise.all(pngs.map(async (p) => new Uint8Array(await Bun.file(p).arrayBuffer())));
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let offset = head.length;
imgs.forEach((img, i) => {
  const dv = new DataView(img.buffer); // PNG IHDR: width at 16, height at 20 (big-endian)
  const w = dv.getUint32(16), h = dv.getUint32(20);
  const e = 6 + 16 * i;
  head.writeUInt8(w >= 256 ? 0 : w, e); head.writeUInt8(h >= 256 ? 0 : h, e + 1);
  head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(img.length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
await Bun.write(out, Buffer.concat([head, ...imgs.map((i) => Buffer.from(i))]));

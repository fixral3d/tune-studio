import { readFileSync } from 'node:fs';
import { loadFirmware, parseIHex } from '../src/index.ts';
for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, 'latin1');
  const img = loadFirmware(text);
  const parsed = parseIHex(text);
  const addrs = img.pages.map(p => p.address);
  console.log(`\n== ${path}`);
  console.log(`  kind=${img.kind} checksumOk=${img.checksumOk} pages=${img.pages.length} bytes=${img.totalBytes}`);
  console.log(`  address range: 0x${Math.min(...addrs).toString(16)} .. 0x${(Math.max(...addrs)+img.pageSize).toString(16)}`);
  console.log(`  V3 marker word present: ${img.hasV3Marker}`);
  console.log(`  pages with crypto tag: ${img.pages.filter(p => p.tag !== undefined).length}`);
  const rt = {}; for (const r of parsed.records) rt[r.type]=(rt[r.type]||0)+1;
  console.log(`  record types: ${JSON.stringify(rt)}`);
}

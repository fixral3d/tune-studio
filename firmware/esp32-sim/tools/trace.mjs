// Print the simulator's debug trace (second CDC port, interface MI_02). Usage: node tools/trace.mjs COMx [seconds]
import { SerialPort } from 'serialport';
const [path, secs] = process.argv.slice(2);
const p = new SerialPort({ path, baudRate: 115200 }, (e) => {
  if (e) throw e;
  p.set({ dtr: true, rts: true });
});
p.on('data', (d) => process.stdout.write(d.toString('latin1')));
if (secs) setTimeout(() => p.close(() => process.exit(0)), Number(secs) * 1000);

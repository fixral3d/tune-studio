// Reboot the simulator into the ESP32-S3 ROM bootloader for flashing: open its CDC port at 1200 baud.
// Usage: node tools/touch1200.mjs COM9   (run from apps/emu-cli's node_modules context, see README)
import { SerialPort } from 'serialport';
const path = process.argv[2];
const p = new SerialPort({ path, baudRate: 1200 }, (e) => {
  if (e) throw e;
  setTimeout(() => p.close(), 300);
});

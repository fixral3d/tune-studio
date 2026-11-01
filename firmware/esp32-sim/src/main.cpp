// VEMS V3 ECU simulator — Waveshare ESP32-S3-Touch-LCD-2.1.
// USB carries the TriggerFrame protocol; the touch screen drives the engine model.
//
// USB notes (verified against VemsTune 1.5.46, 2026-11-01):
//  - The chip's USB-Serial/JTAG unit resets / drops into ROM download mode on VemsTune's DTR/RTS toggling, so we
//    run TinyUSB CDC (ARDUINO_USB_MODE=0) with DTR/RTS reboot detection off; a 1200-baud "touch" (or the
//    "Flash modu" button) reboots into the ROM bootloader for flashing (tools/flash.ps1).
//  - Writes go straight to the TinyUSB FIFO: Arduino's USBCDC drops data while DTR is low.
//  - At most 63 bytes per USB transfer: a page answer sent as full 64-byte packets stayed in usbser.sys until
//    VemsTune timed out (it then re-probed after every page read). DSR is not needed over USB.
//  - Own PID/serial: with the JTAG unit's 303A:1001 + MAC serial Windows reuses the cached JTAG device and fails.
#include <Arduino.h>
#include <LittleFS.h>
#include "USB.h"
#include "esp32-hal-tinyusb.h"
#include "tusb.h"
#include "soc/usb_serial_jtag_reg.h"
#include "soc/soc.h"
#include "ecu.h"
#include "engine.h"
#include "ui.h"

Ecu ecu;
Engine engine;
USBCDC cdc(0);
USBCDC dbg(1);  // second port: trace of what the host sends (node tools/trace.mjs COMx)

static void dbgLine(const char *s) {
  if (!dbg) return;
  dbg.write((const uint8_t *)s, strlen(s));
  dbg.write((const uint8_t *)"\r\n", 2);
}

static void usbWrite(const uint8_t *d, size_t n) {
  if (!tud_ready()) return;
  uint32_t stall = millis();
  while (n) {
    // at most 63 bytes per transfer, one per USB frame: every transfer ends in a short packet (see above)
    uint32_t k = tud_cdc_n_write(0, d, n < 63 ? n : 63);
    tud_cdc_n_write_flush(0);
    if (k && n > k) delay(1);
    if (!k) {
      // FIFO full: give the host a moment, drop the rest if nobody reads
      if (millis() - stall > 200) {
        char t[48];
        snprintf(t, sizeof t, "%lu usbWrite DROP %u", (unsigned long)millis(), (unsigned)n);
        dbgLine(t);
        return;
      }
      delay(1);
      continue;
    }
    stall = millis();
    d += k;
    n -= k;
  }
}


static void usbEvent(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base != ARDUINO_USB_CDC_EVENTS) return;
  auto *e = (arduino_usb_cdc_event_data_t *)data;
  char t[64];
  if (id == ARDUINO_USB_CDC_LINE_STATE_EVENT) snprintf(t, sizeof t, "%lu line dtr=%d rts=%d", (unsigned long)millis(), e->line_state.dtr, e->line_state.rts), dbgLine(t);
  if (id == ARDUINO_USB_CDC_LINE_CODING_EVENT) snprintf(t, sizeof t, "%lu baud %lu", (unsigned long)millis(), (unsigned long)e->line_coding.bit_rate), dbgLine(t);
  if (id == ARDUINO_USB_CDC_LINE_CODING_EVENT && e->line_coding.bit_rate == 1200) usb_persist_restart(RESTART_BOOTLOADER);
}

void setup() {
  // After a reset through the USB-Serial/JTAG unit (esptool, flashing) the host still sees that device; drop
  // the D+ pull-up for a moment so it notices the disconnect and enumerates our TinyUSB CDC instead.
  SET_PERI_REG_MASK(USB_SERIAL_JTAG_CONF0_REG, USB_SERIAL_JTAG_PAD_PULL_OVERRIDE);
  CLEAR_PERI_REG_MASK(USB_SERIAL_JTAG_CONF0_REG, USB_SERIAL_JTAG_DP_PULLUP);
  delay(500);
  CLEAR_PERI_REG_MASK(USB_SERIAL_JTAG_CONF0_REG, USB_SERIAL_JTAG_PAD_PULL_OVERRIDE);
  cdc.enableReboot(false);
  cdc.setRxBufferSize(4096);
  cdc.onEvent(usbEvent);
  cdc.begin(115200);
  dbg.begin(115200);
  USB.VID(0x303a);
  USB.PID(0x81b3);
  USB.manufacturerName("VEMS Tuner");
  USB.productName("VEMS V3 Simulator");
  USB.serialNumber("VEMSSIM-001453");
  USB.begin();
  LittleFS.begin(true);
  ecu.begin(usbWrite);
  ecu.trace = dbgLine;
  uiBegin(ecu, engine);
}

void loop() {
  static uint8_t buf[512];
  int n;
  while ((n = cdc.available()) > 0) {
    n = cdc.read(buf, min<int>(n, sizeof buf));
    if (n > 0) ecu.onBytes(buf, n);
  }
  static uint32_t lastEngine = millis();
  uint32_t now = millis();
  if (now - lastEngine >= 50) {
    engine.update(ecu, (now - lastEngine) / 1000.0f);
    lastEngine = now;
  }
  ecu.tick();
  uiLoop(ecu, engine);
}

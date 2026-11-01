// Touch UI (LVGL 8.3) on the 480x480 round panel, running in its own task on core 0 so drawing never delays
// the ECU answers on core 1. Three swipe pages:
//   1 Motor     — the outer ring is the throttle (drag it), RPM/MAP/lambda/CLT in the middle, key button
//   2 Sensörler — coolant, intake air, battery sliders and the auto drive cycle switch
//   3 ECU       — host link, writes/burns, WBO2 calibration / trigger log / bootloader state, HEX/UHEX boot type,
//                 factory config, ROM flash mode
#include "ui.h"
#include <lvgl.h>
#include "board/Display_ST7701.h"
#include "board/LVGL_Driver.h"
#include "board/TCA9554PWR.h"
#include "board/I2C_Driver.h"
#include "esp32-hal-tinyusb.h"

static Ecu *E;
static Engine *G;

static const lv_color_t C_BG = lv_color_hex(0x0b1018), C_ACC = lv_color_hex(0x3ee6c1), C_WARN = lv_color_hex(0xffb547),
                        C_BAD = lv_color_hex(0xf85149), C_MUTED = lv_color_hex(0x8593a6), C_TXT = lv_color_hex(0xe6edf3);

static lv_obj_t *thrArc, *rpmArc, *rpmLbl, *thrLbl, *subLbl, *stateLbl, *keyBtn, *keyLbl;
static lv_obj_t *cltSl, *iatSl, *batSl, *cltLbl, *iatLbl, *batLbl, *autoSw;
static lv_obj_t *linkLbl, *statLbl, *modeLbl, *bootSw, *bootLbl;

static lv_obj_t *label(lv_obj_t *p, const lv_font_t *f, lv_color_t c, const char *t) {
  lv_obj_t *l = lv_label_create(p);
  lv_obj_set_style_text_font(l, f, 0);
  lv_obj_set_style_text_color(l, c, 0);
  lv_label_set_text(l, t);
  return l;
}

static lv_obj_t *button(lv_obj_t *p, const char *t, lv_color_t c, lv_event_cb_t cb, lv_obj_t **lbl = nullptr) {
  lv_obj_t *b = lv_btn_create(p);
  lv_obj_set_style_bg_color(b, c, 0);
  lv_obj_set_style_radius(b, 22, 0);
  lv_obj_set_size(b, 150, 46);
  lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *l = label(b, &lv_font_montserrat_16, lv_color_hex(0x0b1018), t);
  lv_obj_center(l);
  if (lbl) *lbl = l;
  return b;
}

// ---------------------------------------------------------------- page 1: motor

static void onThrottle(lv_event_t *) { G->in.throttle = lv_arc_get_value(thrArc); }

static void onKey(lv_event_t *) {
  G->in.key = !G->in.key;
  G->in.autoDrive = false;
  if (autoSw) lv_obj_clear_state(autoSw, LV_STATE_CHECKED);
}

static void buildMotor(lv_obj_t *t) {
  // throttle ring (user input) with the RPM ring inside it (output)
  thrArc = lv_arc_create(t);
  lv_obj_set_size(thrArc, 440, 440);
  lv_obj_center(thrArc);
  lv_arc_set_bg_angles(thrArc, 135, 45);
  lv_arc_set_range(thrArc, 0, 100);
  lv_obj_set_style_arc_width(thrArc, 26, LV_PART_MAIN);
  lv_obj_set_style_arc_width(thrArc, 26, LV_PART_INDICATOR);
  lv_obj_set_style_arc_color(thrArc, lv_color_hex(0x1a2230), LV_PART_MAIN);
  lv_obj_set_style_arc_color(thrArc, C_WARN, LV_PART_INDICATOR);
  lv_obj_set_style_bg_color(thrArc, C_TXT, LV_PART_KNOB);
  lv_obj_set_style_pad_all(thrArc, 6, LV_PART_KNOB);
  lv_obj_add_event_cb(thrArc, onThrottle, LV_EVENT_VALUE_CHANGED, nullptr);

  rpmArc = lv_arc_create(t);
  lv_obj_set_size(rpmArc, 360, 360);
  lv_obj_center(rpmArc);
  lv_arc_set_bg_angles(rpmArc, 135, 45);
  lv_arc_set_range(rpmArc, 0, 8000);
  lv_obj_remove_style(rpmArc, nullptr, LV_PART_KNOB);
  lv_obj_clear_flag(rpmArc, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_style_arc_width(rpmArc, 14, LV_PART_MAIN);
  lv_obj_set_style_arc_width(rpmArc, 14, LV_PART_INDICATOR);
  lv_obj_set_style_arc_color(rpmArc, lv_color_hex(0x1a2230), LV_PART_MAIN);
  lv_obj_set_style_arc_color(rpmArc, C_ACC, LV_PART_INDICATOR);

  rpmLbl = label(t, &lv_font_montserrat_48, C_TXT, "0");
  lv_obj_align(rpmLbl, LV_ALIGN_CENTER, 0, -40);
  lv_obj_t *u = label(t, &lv_font_montserrat_14, C_MUTED, "RPM");
  lv_obj_align(u, LV_ALIGN_CENTER, 0, -6);
  subLbl = label(t, &lv_font_montserrat_16, C_TXT, "");
  lv_obj_set_style_text_align(subLbl, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(subLbl, LV_ALIGN_CENTER, 0, 34);
  stateLbl = label(t, &lv_font_montserrat_14, C_ACC, "");
  lv_obj_align(stateLbl, LV_ALIGN_CENTER, 0, -100);
  thrLbl = label(t, &lv_font_montserrat_20, C_WARN, "GAZ 0%");
  lv_obj_align(thrLbl, LV_ALIGN_CENTER, 0, 78);

  keyBtn = button(t, "KONTAK", C_ACC, onKey, &keyLbl);
  lv_obj_set_size(keyBtn, 130, 44);
  lv_obj_align(keyBtn, LV_ALIGN_CENTER, 0, 140);
}

// ---------------------------------------------------------------- page 2: sensors

static lv_obj_t *sliderRow(lv_obj_t *t, int y, int lo, int hi, int v, lv_obj_t **lbl, lv_event_cb_t cb) {
  *lbl = label(t, &lv_font_montserrat_20, C_TXT, "");
  lv_obj_align(*lbl, LV_ALIGN_CENTER, 0, y - 26);
  lv_obj_t *s = lv_slider_create(t);
  lv_obj_set_width(s, 300);
  lv_obj_align(s, LV_ALIGN_CENTER, 0, y);
  lv_slider_set_range(s, lo, hi);
  lv_slider_set_value(s, v, LV_ANIM_OFF);
  lv_obj_set_style_bg_color(s, C_ACC, LV_PART_INDICATOR);
  lv_obj_set_style_bg_color(s, C_TXT, LV_PART_KNOB);
  lv_obj_add_event_cb(s, cb, LV_EVENT_VALUE_CHANGED, nullptr);
  return s;
}

static void onClt(lv_event_t *) { G->in.coolant = lv_slider_get_value(cltSl); }
static void onIat(lv_event_t *) { G->in.intake = lv_slider_get_value(iatSl); }
static void onBat(lv_event_t *) { G->in.battery = lv_slider_get_value(batSl) / 10.0f; }
static void onAuto(lv_event_t *) {
  G->in.autoDrive = lv_obj_has_state(autoSw, LV_STATE_CHECKED);
  if (G->in.autoDrive) G->in.key = true;
}

static void buildSensors(lv_obj_t *t) {
  lv_obj_t *h = label(t, &lv_font_montserrat_20, C_ACC, "Sensorler");
  lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 50);
  cltSl = sliderRow(t, -90, -20, 120, (int)G->in.coolant, &cltLbl, onClt);
  iatSl = sliderRow(t, -10, -20, 80, (int)G->in.intake, &iatLbl, onIat);
  batSl = sliderRow(t, 70, 80, 160, (int)(G->in.battery * 10), &batLbl, onBat);
  lv_obj_t *al = label(t, &lv_font_montserrat_16, C_TXT, "Otomatik surus");
  lv_obj_align(al, LV_ALIGN_CENTER, -40, 140);
  autoSw = lv_switch_create(t);
  lv_obj_align(autoSw, LV_ALIGN_CENTER, 85, 140);
  lv_obj_set_style_bg_color(autoSw, C_ACC, LV_PART_INDICATOR | LV_STATE_CHECKED);
  lv_obj_add_event_cb(autoSw, onAuto, LV_EVENT_VALUE_CHANGED, nullptr);
}

// ---------------------------------------------------------------- page 3: ECU

static void onBootType(lv_event_t *) {
  E->bootType = lv_obj_has_state(bootSw, LV_STATE_CHECKED) ? 'u' : 'n';
  E->savePages();
}
static void onFactory(lv_event_t *) {
  E->resetPagesToSeed();
  E->savePages();
}
static void onFlash(lv_event_t *) { usb_persist_restart(RESTART_BOOTLOADER); }

static void buildEcu(lv_obj_t *t) {
  lv_obj_t *h = label(t, &lv_font_montserrat_20, C_ACC, "VEMS V3 ECU");
  lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 50);
  linkLbl = label(t, &lv_font_montserrat_16, C_TXT, "");
  lv_obj_align(linkLbl, LV_ALIGN_CENTER, 0, -120);
  statLbl = label(t, &lv_font_montserrat_14, C_MUTED, "");
  lv_obj_set_style_text_align(statLbl, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(statLbl, LV_ALIGN_CENTER, 0, -72);
  modeLbl = label(t, &lv_font_montserrat_16, C_WARN, "");
  lv_obj_set_style_text_align(modeLbl, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(modeLbl, LV_ALIGN_CENTER, 0, -24);

  bootLbl = label(t, &lv_font_montserrat_16, C_TXT, "");
  lv_obj_align(bootLbl, LV_ALIGN_CENTER, -40, 26);
  bootSw = lv_switch_create(t);
  lv_obj_align(bootSw, LV_ALIGN_CENTER, 95, 26);
  lv_obj_set_style_bg_color(bootSw, C_ACC, LV_PART_INDICATOR | LV_STATE_CHECKED);
  if (E->bootType == 'u') lv_obj_add_state(bootSw, LV_STATE_CHECKED);
  lv_obj_add_event_cb(bootSw, onBootType, LV_EVENT_VALUE_CHANGED, nullptr);

  lv_obj_t *f = button(t, "Fabrika config", C_MUTED, onFactory);
  lv_obj_align(f, LV_ALIGN_CENTER, -80, 92);
  lv_obj_t *fl = button(t, "Flash modu", C_BAD, onFlash);
  lv_obj_align(fl, LV_ALIGN_CENTER, 80, 92);
  lv_obj_t *n = label(t, &lv_font_montserrat_14, C_MUTED, "USB: VEMS V3 Simulator");
  lv_obj_align(n, LV_ALIGN_CENTER, 0, 150);
}

// ---------------------------------------------------------------- refresh

static void refresh(lv_timer_t *) {
  const EngineState &s = G->st;
  lv_arc_set_value(rpmArc, (int)s.rpm);
  lv_label_set_text_fmt(rpmLbl, "%d", (int)s.rpm);
  if (!lv_obj_has_state(thrArc, LV_STATE_PRESSED)) lv_arc_set_value(thrArc, (int)s.tps);
  lv_label_set_text_fmt(thrLbl, "GAZ %d%%", (int)s.tps);
  lv_label_set_text_fmt(subLbl, "MAP %d kPa   L %.2f\nCLT %d C   %.1f V", (int)s.map, s.lambda, (int)G->in.coolant,
                        G->in.battery);
  const char *st = E->inBoot ? "BOOTLOADER" : s.cranking ? "MARS" : s.running ? (G->in.autoDrive ? "OTO SURUS" : "CALISIYOR") : "KONTAK KAPALI";
  lv_label_set_text(stateLbl, st);
  lv_obj_set_style_text_color(stateLbl, s.running ? C_ACC : C_WARN, 0);
  lv_label_set_text(keyLbl, G->in.key ? "STOP" : "KONTAK");
  lv_obj_set_style_bg_color(keyBtn, G->in.key ? C_BAD : C_ACC, 0);

  lv_label_set_text_fmt(cltLbl, "Sogutma suyu  %d C", (int)G->in.coolant);
  lv_label_set_text_fmt(iatLbl, "Emme havasi  %d C", (int)G->in.intake);
  lv_label_set_text_fmt(batLbl, "Aku  %.1f V", G->in.battery);
  if (G->in.autoDrive != lv_obj_has_state(autoSw, LV_STATE_CHECKED))
    G->in.autoDrive ? lv_obj_add_state(autoSw, LV_STATE_CHECKED) : lv_obj_clear_state(autoSw, LV_STATE_CHECKED);

  bool linked = E->lastRxMs && millis() - E->lastRxMs < 2000;
  lv_label_set_text(linkLbl, linked ? "PC bagli" : "PC bekleniyor");
  lv_obj_set_style_text_color(linkLbl, linked ? C_ACC : C_MUTED, 0);
  lv_label_set_text_fmt(statLbl, "frame %lu/%lu  yazma %lu  burn %lu\nfw sayfa %d%s", (unsigned long)E->framesRx,
                        (unsigned long)E->framesTx, (unsigned long)E->writes, (unsigned long)E->burns, E->fwPageCount(),
                        E->dirty ? "  - BURN EDILMEDI" : "");
  uint8_t ena = E->testTools[3];
  if (E->inBoot) lv_label_set_text_fmt(modeLbl, "Firmware yukleniyor: %lu sayfa", (unsigned long)E->fwPagesWritten);
  else if (E->triggerOn) lv_label_set_text_fmt(modeLbl, "Trigger log  %d rpm", (int)s.rpm);
  else if (ena == 2 || ena == 3) lv_label_set_text_fmt(modeLbl, "WBO2 %d kalibrasyon  O2 %.1f%%", ena - 1, s.o2);
  else lv_label_set_text(modeLbl, "");
  lv_label_set_text_fmt(bootLbl, "Boot tipi: %s", E->bootType == 'u' ? "UHEX" : "HEX");
}

static void uiTask(void *) {
  I2C_Init();
  TCA9554PWR_Init(0x00);
  Set_EXIO(EXIO_PIN8, Low);  // buzzer off
  LCD_Init();
  Lvgl_Init();

  lv_obj_t *scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, C_BG, 0);
  lv_obj_t *tv = lv_tileview_create(scr);
  lv_obj_set_style_bg_color(tv, C_BG, 0);
  lv_obj_set_scrollbar_mode(tv, LV_SCROLLBAR_MODE_OFF);
  buildMotor(lv_tileview_add_tile(tv, 0, 0, LV_DIR_RIGHT));
  buildSensors(lv_tileview_add_tile(tv, 1, 0, (lv_dir_t)(LV_DIR_LEFT | LV_DIR_RIGHT)));
  buildEcu(lv_tileview_add_tile(tv, 2, 0, LV_DIR_LEFT));
  lv_timer_create(refresh, 100, nullptr);
  refresh(nullptr);

  for (;;) {
    Lvgl_Loop();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

void uiBegin(Ecu &ecu, Engine &engine) {
  E = &ecu;
  G = &engine;
  xTaskCreatePinnedToCore(uiTask, "ui", 8192, nullptr, 1, nullptr, 0);
}

void uiLoop(Ecu &, Engine &) {}

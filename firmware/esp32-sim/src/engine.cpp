#include "engine.h"
#include <math.h>
#include "seed_pages.h"

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

static float arrAt(const uint8_t *page, const ArrMeta &m, int i) {
  const uint8_t *p = page + m.offset + i * m.size;
  uint32_t raw = m.size == 1 ? p[0] : (p[0] << 8) | p[1];  // V3 is big-endian
  return (raw + m.translate) * m.scale;
}

/** Bilinear VE lookup over the table's bins (clamped at the edges), as veAt() in device.ts. */
static float veAt(const uint8_t *page, float rpm, float map) {
  auto frac = [&](const ArrMeta &bins, float v) {
    int n = bins.dimX;
    if (v <= arrAt(page, bins, 0)) return 0.0f;
    for (int i = 0; i < n - 1; i++) {
      float a = arrAt(page, bins, i), b = arrAt(page, bins, i + 1);
      if (v <= b) return i + (v - a) / ((b - a) ? (b - a) : 1);
    }
    return (float)(n - 1);
  };
  const int nx = VE_RPM_BINS.dimX, ny = VE_MAP_BINS.dimX;
  float fx = frac(VE_RPM_BINS, rpm), fy = frac(VE_MAP_BINS, map);
  int x0 = min(nx - 2, (int)floorf(fx)), y0 = min(ny - 2, (int)floorf(fy));
  float tx = clampf(fx - x0, 0, 1), ty = clampf(fy - y0, 0, 1);
  auto v = [&](int x, int y) {
    int idx = VE_ORDER == 1 ? y * VE_TABLE.dimX + x : x * VE_TABLE.dimY + y;
    return arrAt(page, VE_TABLE, idx);
  };
  return v(x0, y0) * (1 - tx) * (1 - ty) + v(x0 + 1, y0) * tx * (1 - ty) + v(x0, y0 + 1) * (1 - tx) * ty +
         v(x0 + 1, y0 + 1) * tx * ty;
}

/** The engine's real VE: the shipped table shaped by a smooth error, so the VE analysers have something to find. */
static float trueVe(float rpm, float map) {
  static uint8_t base[PAGE_SIZE];
  static bool init = false;
  if (!init) {
    for (int i = 0; i < SEED_PAGE_COUNT; i++)
      if (SEED_PAGES[i].ecuId == VE_ECU_ID) memcpy(base, SEED_PAGES[i].data, min<int>(SEED_PAGES[i].len, PAGE_SIZE));
    init = true;
  }
  return veAt(base, rpm, map) * (1 + 0.07f * sinf(rpm / 1100) * cosf(map / 23));
}

void Engine::update(Ecu &ecu, float dt) {
  t_ += dt;
  uint8_t *rt = ecu.rt;
  auto put16 = [&](int at, float v) {
    uint32_t r = (uint32_t)clampf(roundf(v), 0, 65535);
    rt[at] = r >> 8;
    rt[at + 1] = r & 0xff;
  };
  float rpm, map, tps;
  bool running, cranking;
  if (in.autoDrive) {
    // demo drive cycle: rpm 900..6500, MAP 28..100 kPa, throttle follows load
    cranking = false;
    running = true;
    rpm = 900 + 5600 * (0.5f + 0.5f * sinf(t_ * 0.42f));
    map = 28 + 72 * (0.5f + 0.5f * sinf(t_ * 0.29f + 1.3f));
    tps = clampf((map - 28) / 72 * 90 + 5, 0, 100);
  } else {
    tps = in.throttle;
    if (in.key && !wasKey_) crankT_ = 1.5f;  // key turned: crank for 1.5 s
    wasKey_ = in.key;
    if (!in.key) {
      cranking = running = false;
      st.rpm += (0 - st.rpm) * clampf(dt * 3, 0, 1);
      rpm = st.rpm < 30 ? 0 : st.rpm;
      map = 101;
    } else if (crankT_ > 0) {
      crankT_ -= dt;
      cranking = true;
      running = false;
      rpm = 250;
      map = 95;
    } else {
      cranking = false;
      running = true;
      float target = 900 + tps / 100 * 5600;
      rpm = st.rpm + (target - st.rpm) * clampf(dt * 1.5f, 0, 1);
      float load = powf(tps / 100, 0.6f);
      map = 28 + 72 * load;
    }
  }
  float lambdaTarget = map > 85 ? 0.88f : 1.0f;
  float tableVe = veAt(ecu.pages[VE_ECU_ID], rpm, map);
  float lambda = running ? lambdaTarget * trueVe(rpm, map) / max(1.0f, tableVe) + (random(-100, 100) / 100.0f) * 0.002f : 1.0f;

  st.rpm = rpm, st.map = map, st.tps = tps, st.running = running, st.cranking = cranking;
  st.lambda = lambda, st.lambdaTarget = lambdaTarget, st.veTable = tableVe;
  st.pw = running || cranking ? 1.2f + 9 * (map / 100) * (tableVe / 100) / lambdaTarget : 0;

  rt[2] = (running ? 1 : 0) | (cranking ? 2 : 0);  // engine: bit0 running, bit1 cranking
  put16(4, map * 4);                                  // map = mapADC / 4
  rt[6] = (uint8_t)clampf(roundf(in.intake + 100), 0, 255);   // mat = matADC - 100
  rt[7] = (uint8_t)clampf(roundf(in.coolant + 100), 0, 255);  // coolant = cltADC - 100
  rt[8] = (uint8_t)roundf(tps * 2.55f);                       // throttle = tpsADC * 100/255
  rt[9] = (uint8_t)clampf(roundf(in.battery / 30 * 255), 0, 255);  // batteryVoltage = batADC / 255 * 30
  rt[10] = (uint8_t)clampf(roundf(lambda * 470 - 306), 0, 211);    // lambda = (egoADC + 306) / 470
  rt[11] = 100;                                                     // egoCorrection %
  put16(14, rpm);
  put16(16, st.pw / 0.004f);                                          // pulseWidth_raw (ms / 0.004)
  rt[20] = (uint8_t)clampf(roundf(tableVe), 0, 255);                 // veCurr
  rt[40] = (uint8_t)clampf(roundf(256 / lambdaTarget - 200), 0, 255);  // lambdatarget = 256 / (latgtADC + 200)

  // WBO2 free-air calibration (ENA_FLAGS 02/03): O2 % goes out in pulseWidth_raw (stallO2 = pulseWidth_raw / 10.24);
  // the sensor heats for ~3 s, then reads 20.9 % when wbo2_calibration (ecu 0 @139 / ecu 7 @26) is 120
  uint8_t ena = ecu.testTools[3];
  heat_ = (ena == 2 || ena == 3) ? heat_ + dt : 0;
  if (heat_ > 0) {
    int cal = ena == 2 ? ecu.pages[0][139] : ecu.pages[7][26];
    st.o2 = min(1.0f, heat_ / 3) * (20.9f + (cal - 120) * 0.06f) + (random(-100, 100) / 100.0f) * 0.02f;
    put16(16, st.o2 * 10.24f / 0.004f);
  } else st.o2 = 0;

  ecu.triggerRpm = rpm > 60 ? rpm : 60;
}

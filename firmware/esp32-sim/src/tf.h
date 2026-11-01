// TriggerFrame framing (re/specs/PROTOCOL.md §4): body + CRC-16/MODBUS (LE), 0x7D/0x7E stuffing, 0x7E flag.
// Mirrors packages/core/src/tf/frame.ts.
#pragma once
#include <Arduino.h>

static const uint8_t TF_FLAG = 0x7e;
static const uint8_t TF_ESC = 0x7d;

inline uint16_t crc16Sipr(const uint8_t *d, size_t n, uint16_t crc = 0xffff) {
  for (size_t i = 0; i < n; i++) {
    crc ^= d[i];
    for (int b = 0; b < 8; b++) crc = (crc & 1) ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}

/** Collects escaped bytes into an encoded frame buffer, then writes it in one go. */
class TfWriter {
 public:
  void begin() { n_ = 0; }
  void put(uint8_t b) {
    if (b == TF_FLAG || b == TF_ESC) {
      push(TF_ESC);
      push(b ^ 0x20);
    } else push(b);
  }
  /** Encode `body` (CRC appended) into `out`; returns its length. */
  static size_t encode(const uint8_t *body, size_t n, uint8_t *out, size_t cap) {
    TfWriter w;
    w.out_ = out;
    w.cap_ = cap;
    w.begin();
    for (size_t i = 0; i < n; i++) w.put(body[i]);
    uint16_t crc = crc16Sipr(body, n);
    w.put(crc & 0xff);
    w.put(crc >> 8);
    w.push(TF_FLAG);
    return w.n_;
  }

 private:
  void push(uint8_t b) {
    if (n_ < cap_) out_[n_++] = b;
  }
  uint8_t *out_ = nullptr;
  size_t cap_ = 0, n_ = 0;
};

/** Streaming parser (TfParser): de-stuffs, splits on 0x7E, checks CRC. */
class TfParser {
 public:
  /** Returns true when a frame is complete; body()/len()/crcOk() describe it (CRC removed). */
  bool feed(uint8_t b) {
    if (esc_) {
      add(b ^ 0x20);
      esc_ = false;
      return false;
    }
    if (b == TF_ESC) {
      esc_ = true;
      return false;
    }
    if (b == TF_FLAG) {
      size_t n = n_;
      n_ = 0;
      if (n < 3 || over_) {
        over_ = false;
        return false;
      }
      len_ = n - 2;
      memcpy(frame_, buf_, len_);
      uint16_t rx = buf_[n - 2] | (buf_[n - 1] << 8);
      ok_ = crc16Sipr(frame_, len_) == rx;
      return true;
    }
    add(b);
    return false;
  }
  void reset() { n_ = 0, esc_ = false, over_ = false; }
  const uint8_t *body() const { return frame_; }
  size_t len() const { return len_; }
  bool crcOk() const { return ok_; }
  uint8_t type() const { return len_ ? frame_[len_ - 1] : 0; }

 private:
  void add(uint8_t b) {
    if (n_ < sizeof(buf_)) buf_[n_++] = b;
    else over_ = true;
  }
  uint8_t buf_[600], frame_[600];
  size_t n_ = 0, len_ = 0;
  bool esc_ = false, ok_ = false, over_ = false;
};

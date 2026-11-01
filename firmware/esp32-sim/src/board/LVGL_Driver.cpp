// LVGL glue from the Waveshare ESP32-S3-Touch-LCD-2.1 demo: the RGB panel's two PSRAM frame buffers are the
// LVGL draw buffers (full refresh), touch comes from the CST820. The tick is LV_TICK_CUSTOM (millis).
#include "LVGL_Driver.h"

lv_disp_drv_t disp_drv;

static lv_disp_draw_buf_t draw_buf;
static void *buf1 = NULL;
static void *buf2 = NULL;

void Lvgl_print(const char *buf) {}

void Lvgl_Display_LCD(lv_disp_drv_t *disp_drv, const lv_area_t *area, lv_color_t *color_p) {
  LCD_addWindow(area->x1, area->y1, area->x2, area->y2, (uint8_t *)&color_p->full);
  lv_disp_flush_ready(disp_drv);
}

void Lvgl_Touchpad_Read(lv_indev_drv_t *indev_drv, lv_indev_data_t *data) {
  Touch_Read_Data();
  if (touch_data.points != 0x00) {
    data->point.x = touch_data.x;
    data->point.y = touch_data.y;
    data->state = LV_INDEV_STATE_PR;
  } else {
    data->state = LV_INDEV_STATE_REL;
  }
  touch_data.x = 0;
  touch_data.y = 0;
  touch_data.points = 0;
  touch_data.gesture = NONE;
}


void Lvgl_Init(void) {
  lv_init();
  esp_lcd_rgb_panel_get_frame_buffer(panel_handle, 2, &buf1, &buf2);
  lv_disp_draw_buf_init(&draw_buf, buf1, buf2, ESP_PANEL_LCD_WIDTH * ESP_PANEL_LCD_HEIGHT);

  lv_disp_drv_init(&disp_drv);
  disp_drv.hor_res = LCD_HEIGHT;
  disp_drv.ver_res = LCD_WIDTH;
  disp_drv.flush_cb = Lvgl_Display_LCD;
  disp_drv.full_refresh = 1;
  disp_drv.draw_buf = &draw_buf;
  lv_disp_drv_register(&disp_drv);

  static lv_indev_drv_t indev_drv;
  lv_indev_drv_init(&indev_drv);
  indev_drv.type = LV_INDEV_TYPE_POINTER;
  indev_drv.read_cb = Lvgl_Touchpad_Read;
  lv_indev_drv_register(&indev_drv);
}

void Lvgl_Loop(void) { lv_timer_handler(); }

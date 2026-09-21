# -*- coding: utf-8 -*-
"""押注自动统计 · 移动版（Android / iOS）—— 三页精简 UI"""
from __future__ import annotations

import os
from datetime import datetime

from kivy.app import App
from kivy.clock import Clock
from kivy.core.clipboard import Clipboard
from kivy.core.text import LabelBase
from kivy.core.window import Window
from kivy.metrics import dp, sp
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.gridlayout import GridLayout
from kivy.uix.label import Label
from kivy.uix.popup import Popup
from kivy.uix.scrollview import ScrollView
from kivy.uix.spinner import Spinner
from kivy.uix.tabbedpanel import TabbedPanel, TabbedPanelItem
from kivy.uix.textinput import TextInput
from kivy.utils import platform

# ---------- 注册中文字体（跨平台，优先用系统自带） ----------
_FONT_CANDIDATES = [
    # 项目内自定义字体（若存在优先用）
    os.path.join(os.path.dirname(__file__), "assets", "NotoSansSC-Regular.otf"),
    # Windows
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    # Android（系统自带中文黑体）
    "/system/fonts/NotoSansCJK-Regular.ttc",
    "/system/fonts/NotoSansCJKsc-Regular.otf",
    "/system/fonts/DroidSansFallback.ttf",
    "/system/fonts/DroidSansChinese.ttf",
    # iOS / macOS
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]
for _f in _FONT_CANDIDATES:
    if os.path.exists(_f):
        try:
            LabelBase.register("Roboto", _f)
            print(f"[字体] 已加载: {_f}")
            break
        except Exception as _e:
            print(f"[字体] 加载失败 {_f}: {_e}")

import core
from core import (
    BetGroup, OrderRecord, ParsedBet, DrawResult,
    parse_bet, parse_draw_result, settle_orders,
    summarize_orders, build_risk_rows,
    export_xlsx,
    load_odds_config, save_odds_config,
    load_rebate_config, save_rebate_config,
    detect_region, fmt_num, get_app_dir,
    ODDS_ITEMS, REBATE_ITEMS, YEAR_OPTIONS,
    DEFAULT_ODDS, DEFAULT_REBATE,
    APP_NAME, APP_VERSION,
)

# ---------- 配色 ----------
BG     = (0.07, 0.08, 0.10, 1)
CARD   = (0.14, 0.16, 0.20, 1)
BTN    = (0.18, 0.21, 0.27, 1)
ACCENT = (0.24, 0.55, 0.94, 1)
TEXT   = (0.93, 0.94, 0.96, 1)
MUTED  = (0.55, 0.58, 0.64, 1)
YELLOW = (1.00, 0.83, 0.35, 1)
GREEN  = (0.35, 0.82, 0.48, 1)
RED    = (0.95, 0.40, 0.42, 1)

Window.clearcolor = BG


def FBtn(text, cb=None, bg=BTN, fg=TEXT, size=13, h=dp(38), w=None):
    b = Button(text=text, background_normal="", background_down="",
               background_color=bg, color=fg, font_size=sp(size),
               size_hint_y=None, height=h)
    if w is not None:
        b.size_hint_x = None
        b.width = w
    if cb:
        b.bind(on_press=cb)
    return b


class Table(BoxLayout):
    """表格：表头+表体在一个横向滚动区，列宽固定，行数不限制。"""

    def __init__(self, headers, widths, **kw):
        super().__init__(orientation="vertical", **kw)
        self.widths = widths
        self.cols = len(headers)

        outer = ScrollView(bar_width=dp(2))
        wrap = GridLayout(cols=1, size_hint=(None, None), spacing=dp(1))
        wrap.bind(minimum_width=wrap.setter("width"))
        wrap.bind(minimum_height=wrap.setter("height"))

        head = GridLayout(cols=self.cols, size_hint_y=None, height=dp(34),
                          spacing=dp(1))
        for h, w in zip(headers, widths):
            head.add_widget(Label(text=str(h), bold=True, color=(1, 1, 1, 1),
                                  size_hint=(None, 1), width=w,
                                  font_size=sp(12)))
        wrap.add_widget(head)

        self.body = GridLayout(cols=1, size_hint_y=None, spacing=dp(1))
        self.body.bind(minimum_height=self.body.setter("height"))
        wrap.add_widget(self.body)

        outer.add_widget(wrap)
        self.add_widget(outer)

    def clear(self):
        self.body.clear_widgets()

    def add(self, values, color=TEXT):
        row = GridLayout(cols=self.cols, size_hint_y=None, height=dp(30),
                         spacing=dp(1))
        for v, w in zip(values, self.widths):
            if isinstance(v, float):
                text = fmt_num(v)
            else:
                text = str(v)
            # emoji → 文字
            for a, b in [("📊", ""), ("🔴", "[高]"), ("🟡", "[中]"),
                         ("🟢", "[低]"), ("⚪", "[?]")]:
                text = text.replace(a, b)
            row.add_widget(Label(text=text, color=color, font_size=sp(11),
                                 size_hint=(None, 1), width=w,
                                 halign="center", valign="middle"))
        self.body.add_widget(row)


class SettingsPopup(Popup):
    def __init__(self, title, items, config, defaults, on_save, **kw):
        content = BoxLayout(orientation="vertical", spacing=dp(6), padding=dp(10))
        scroll = ScrollView()
        grid = GridLayout(cols=2, size_hint_y=None, spacing=dp(6))
        grid.bind(minimum_height=grid.setter("height"))
        self.inputs = {}
        for key, label in items:
            grid.add_widget(Label(text=label, color=TEXT, font_size=sp(12),
                                  size_hint_x=None, width=dp(170),
                                  halign="right", valign="middle"))
            val = config.get(key)
            ti = TextInput(text="" if val is None else fmt_num(val),
                           multiline=False, input_filter="float",
                           size_hint_x=None, width=dp(100), font_size=sp(13))
            self.inputs[key] = ti
            grid.add_widget(ti)
        scroll.add_widget(grid)
        content.add_widget(scroll)

        btns = BoxLayout(size_hint_y=None, height=dp(46), spacing=dp(6))
        popup = self
        popup.title = title
        popup.content = content
        popup.size_hint = (0.96, 0.86)

        def save(*_):
            new = {}
            for k, _ in items:
                s = self.inputs[k].text.strip()
                new[k] = None if s == "" else float(s)
            on_save(new)
            popup.dismiss()

        def reset(*_):
            for k, _ in items:
                v = defaults.get(k)
                self.inputs[k].text = "" if v is None else fmt_num(v)

        btns.add_widget(FBtn("默认", reset))
        btns.add_widget(FBtn("取消", popup.dismiss))
        btns.add_widget(FBtn("保存", save, bg=ACCENT))
        content.add_widget(btns)
        super().__init__(**kw)


# ============================================================
# 三页主界面
# ============================================================
class Root(BoxLayout):
    def __init__(self, app, **kw):
        super().__init__(orientation="vertical", spacing=dp(3), padding=dp(3), **kw)
        self.app = app
        self.preview_result = ParsedBet("")

        # ---- 顶部条：年份 + 剪贴板 + 设置 ----
        bar = BoxLayout(size_hint_y=None, height=dp(38), spacing=dp(4))
        bar.add_widget(Label(text="生肖:", size_hint_x=None, width=dp(44),
                             color=MUTED, font_size=sp(12)))
        self.year_spin = Spinner(text=list(YEAR_OPTIONS.keys())[0],
                                 values=list(YEAR_OPTIONS.keys()),
                                 size_hint_x=None, width=dp(160),
                                 background_normal="", background_color=CARD,
                                 color=TEXT, font_size=sp(12))
        self.year_spin.bind(text=self._on_year)
        bar.add_widget(self.year_spin)
        bar.add_widget(FBtn("赔率", self.open_odds, size=12, h=dp(34), w=dp(58)))
        bar.add_widget(FBtn("回水", self.open_rebate, size=12, h=dp(34), w=dp(58)))
        bar.add_widget(FBtn("导出", self.export_excel, size=12, h=dp(34), w=dp(58)))
        self.add_widget(bar)

        # ---- 中奖开奖号码输入（常驻顶部） ----
        draw_row = BoxLayout(size_hint_y=None, height=dp(38), spacing=dp(4))
        draw_row.add_widget(Label(text="澳:", size_hint_x=None, width=dp(26),
                                  color=MUTED, font_size=sp(12)))
        self.macau_in = TextInput(hint_text="7个号码", multiline=False,
                                  size_hint_x=None, width=dp(140), font_size=sp(12))
        self.macau_in.bind(text=self._schedule_refresh)
        draw_row.add_widget(self.macau_in)
        draw_row.add_widget(Label(text="港:", size_hint_x=None, width=dp(26),
                                  color=MUTED, font_size=sp(12)))
        self.hk_in = TextInput(hint_text="7个号码", multiline=False,
                               size_hint_x=None, width=dp(140), font_size=sp(12))
        self.hk_in.bind(text=self._schedule_refresh)
        draw_row.add_widget(self.hk_in)
        self.add_widget(draw_row)

        # ---- 三页 Tab ----
        self.tabs = TabbedPanel(do_default_tab=False)
        self.add_widget(self.tabs)

        self._build_input_tab()
        self._build_summary_tab()
        self._build_win_tab()

        Clock.schedule_once(lambda *_: self.refresh_all(), 0.2)

    # ================= 第 1 页：输入 =================
    def _build_input_tab(self):
        tab = TabbedPanelItem(text="输入")
        box = BoxLayout(orientation="vertical", spacing=dp(4), padding=dp(4))

        box.add_widget(Label(text="粘贴内容（自动预览）",
                             size_hint_y=None, height=dp(24),
                             color=MUTED, font_size=sp(12)))
        self.raw_in = TextInput(hint_text="例：龙鸡二连肖200 / 猴30米 / 鸡狗鼠各肖10",
                                multiline=True, font_size=sp(13))
        self.raw_in.bind(text=self._schedule_preview)
        box.add_widget(self.raw_in)

        self.preview_out = TextInput(multiline=True, readonly=True, font_size=sp(12))
        box.add_widget(self.preview_out)

        row1 = BoxLayout(size_hint_y=None, height=dp(42), spacing=dp(4))
        row1.add_widget(FBtn("粘贴", self.paste, bg=ACCENT))
        row1.add_widget(FBtn("添加", self.add_current, bg=GREEN, fg=(0, 0, 0, 1)))
        row1.add_widget(FBtn("复制", self.copy_preview))
        row1.add_widget(FBtn("清空输入", self.clear_input, bg=(0.45, 0.15, 0.15, 1)))
        box.add_widget(row1)

        row2 = BoxLayout(size_hint_y=None, height=dp(42), spacing=dp(4))
        row2.add_widget(FBtn("删除最新一条", self.delete_last))
        row2.add_widget(FBtn("清空全部记录", self.clear_all, bg=(0.45, 0.15, 0.15, 1)))
        box.add_widget(row2)

        self.total_lbl = Label(text="预览: 0 | 记录合计: 0",
                               size_hint_y=None, height=dp(24),
                               color=YELLOW, font_size=sp(12))
        box.add_widget(self.total_lbl)

        tab.add_widget(box)
        self.tabs.add_widget(tab)

    # ================= 第 2 页：汇总 =================
    def _build_summary_tab(self):
        tab = TabbedPanelItem(text="汇总")
        box = BoxLayout(orientation="vertical", spacing=dp(3), padding=dp(3))

        # 子 Tab：号码 / 生肖 / 明细
        sub = TabbedPanel(do_default_tab=False)

        # -- 号码汇总 --
        t1 = TabbedPanelItem(text="号码")
        self.t_numbers = Table(["号码", "生肖", "波色", "尾", "次数", "金额"],
                               [dp(52), dp(52), dp(62), dp(34), dp(52), dp(86)])
        t1.add_widget(self.t_numbers)
        sub.add_widget(t1)

        # -- 生肖汇总 --
        t2 = TabbedPanelItem(text="生肖")
        self.t_zodiac = Table(["生肖", "对应号码", "金额"],
                              [dp(58), dp(320), dp(100)])
        t2.add_widget(self.t_zodiac)
        sub.add_widget(t2)

        # -- 玩法汇总 --
        t3 = TabbedPanelItem(text="玩法")
        self.t_play = Table(["玩法", "笔/组", "金额"],
                            [dp(140), dp(80), dp(110)])
        t3.add_widget(self.t_play)
        sub.add_widget(t3)

        # -- 押注明细 --
        t4 = TabbedPanelItem(text="明细")
        self.t_orders = Table(["序", "地区", "时间", "金额", "提示"],
                              [dp(36), dp(50), dp(120), dp(74), dp(46)])
        t4.add_widget(self.t_orders)
        sub.add_widget(t4)

        box.add_widget(sub)
        tab.add_widget(box)
        self.tabs.add_widget(tab)

    # ================= 第 3 页：中奖 =================
    def _build_win_tab(self):
        tab = TabbedPanelItem(text="中奖")
        box = BoxLayout(orientation="vertical", spacing=dp(3), padding=dp(3))

        sub = TabbedPanel(do_default_tab=False)

        # -- 中奖汇总 --
        t1 = TabbedPanelItem(text="中奖汇总")
        self.t_win = Table(
            ["玩法", "下单", "中本", "赔付", "回水", "盈亏", "命中"],
            [dp(84), dp(66), dp(66), dp(66), dp(58), dp(70), dp(48)])
        t1.add_widget(self.t_win)
        sub.add_widget(t1)

        # -- 实时风险 --
        t2 = TabbedPanelItem(text="实时风险")
        self.t_risk = Table(
            ["地区", "码", "肖", "波", "尾", "下注", "中本", "赔付", "回水", "盈亏", "命中", "等级"],
            [dp(42), dp(44), dp(38), dp(52), dp(34), dp(56), dp(56), dp(56), dp(50), dp(62), dp(90), dp(66)])
        t2.add_widget(self.t_risk)
        sub.add_widget(t2)

        # -- 错误 --
        t3 = TabbedPanelItem(text="错误")
        self.error_out = TextInput(multiline=True, readonly=True, font_size=sp(12))
        t3.add_widget(self.error_out)
        sub.add_widget(t3)

        box.add_widget(sub)
        tab.add_widget(box)
        self.tabs.add_widget(tab)

    # ================= 事件 =================
    def _on_year(self, _s, text):
        self.app.year = YEAR_OPTIONS.get(text, "马")
        self.do_preview()
        self.refresh_all()

    def _schedule_preview(self, *_):
        if hasattr(self, "_prev_ev") and self._prev_ev:
            Clock.unschedule(self._prev_ev)
        self._prev_ev = Clock.schedule_once(lambda *_: self.do_preview(), 0.35)

    def _schedule_refresh(self, *_):
        if hasattr(self, "_ref_ev") and self._ref_ev:
            Clock.unschedule(self._ref_ev)
        self._ref_ev = Clock.schedule_once(lambda *_: self.refresh_all(), 0.5)

    def do_preview(self):
        text = self.raw_in.text.strip()
        self.preview_result = parse_bet(text, self.app.year)
        self.preview_out.text = self.preview_result.content or "（等待输入）"
        self.total_lbl.text = (f"预览: {fmt_num(self.preview_result.total)}"
                               f" | 记录合计: {fmt_num(sum(r.amount for r in self.app.records))}")
        return self.preview_result

    def paste(self, *_):
        try:
            s = Clipboard.paste()
        except Exception:
            s = ""
        if not s:
            self._toast("剪贴板为空"); return
        self.raw_in.text = s

    def add_current(self, *_):
        r = self.do_preview()
        if not r.groups:
            self._toast("没有识别到有效内容"); return
        rec = OrderRecord(
            seq=len(self.app.records) + 1,
            raw_text=r.raw_text,
            bet_content=r.content,
            amount=r.total,
            created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            groups=[BetGroup(list(g.numbers), g.amount, g.label, g.source,
                             g.play_type, g.billing_mode, g.selection_text, g.multiplier)
                    for g in r.groups],
            warnings=list(r.warnings),
            region=detect_region(r.raw_text),
        )
        self.app.records.append(rec)
        self.raw_in.text = ""
        self.preview_out.text = ""
        self._toast(f"已添加 #{rec.seq}: {fmt_num(rec.amount)}")
        self.refresh_all()

    def copy_preview(self, *_):
        r = self.do_preview()
        if not r.content:
            self._toast("没有可复制内容"); return
        Clipboard.copy(r.content)
        self._toast("已复制")

    def clear_input(self, *_):
        self.raw_in.text = ""
        self.preview_out.text = ""

    def delete_last(self, *_):
        if not self.app.records:
            return
        self.app.records.pop()
        for i, r in enumerate(self.app.records, 1):
            r.seq = i
        self.refresh_all()

    def clear_all(self, *_):
        if not self.app.records:
            return
        content = BoxLayout(orientation="vertical", spacing=dp(8), padding=dp(12))
        content.add_widget(Label(text="确定清空全部记录？", color=TEXT, font_size=sp(15)))
        btns = BoxLayout(size_hint_y=None, height=dp(46), spacing=dp(6))
        p = Popup(title="确认", content=content, size_hint=(0.8, 0.28))
        btns.add_widget(FBtn("取消", p.dismiss))
        def go(*_):
            self.app.records.clear()
            self.raw_in.text = ""
            self.preview_out.text = ""
            p.dismiss()
            self.refresh_all()
        btns.add_widget(FBtn("确定清空", go, bg=(0.55, 0.18, 0.18, 1)))
        content.add_widget(btns)
        p.open()

    # ================= 设置 =================
    def open_odds(self, *_):
        SettingsPopup("赔率设置", ODDS_ITEMS, self.app.odds, DEFAULT_ODDS,
                      self._save_odds).open()

    def _save_odds(self, cfg):
        self.app.odds = cfg
        save_odds_config(cfg)
        self.refresh_all()
        self._toast("赔率已保存")

    def open_rebate(self, *_):
        SettingsPopup("回水设置", REBATE_ITEMS, self.app.rebate, DEFAULT_REBATE,
                      self._save_rebate).open()

    def _save_rebate(self, cfg):
        self.app.rebate = cfg
        save_rebate_config(cfg)
        self.refresh_all()
        self._toast("回水已保存")

    # ================= 导出 =================
    def export_excel(self, *_):
        if not self.app.records:
            self._toast("没有记录"); return
        try:
            out = get_app_dir()
            name = f"押注汇总_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
            path = str(out / name)
            mac = parse_draw_result(self.macau_in.text, self.app.year)
            hk = parse_draw_result(self.hk_in.text, self.app.year)
            export_xlsx(path, self.app.records, self.app.year,
                        {"澳门": mac, "香港": hk},
                        self.app.odds, self.app.rebate)
            self._toast(f"已导出:\n{path}", 3.5)
        except Exception as e:
            self._toast(f"导出失败: {e}", 3.5)

    # ================= 刷新 =================
    def refresh_all(self):
        # 明细
        self.t_orders.clear()
        for r in self.app.records:
            self.t_orders.add([r.seq,
                               getattr(r, "region", "澳门"),
                               r.created_at,
                               fmt_num(r.amount),
                               len(r.warnings)])

        # 号码 / 生肖 / 玩法
        number_rows, zodiac_rows, _c, play_rows = summarize_orders(
            self.app.records, self.app.year)
        self.t_numbers.clear()
        for row in number_rows:
            self.t_numbers.add([row[0], row[1], row[2], row[3], row[4], fmt_num(row[5])])

        self.t_zodiac.clear()
        for row in zodiac_rows:
            self.t_zodiac.add([row[0], row[1], fmt_num(row[2])])

        self.t_play.clear()
        for row in play_rows:
            self.t_play.add([row[0], row[1], fmt_num(row[2])])

        # 中奖
        self.t_win.clear()
        mac = parse_draw_result(self.macau_in.text, self.app.year)
        hk = parse_draw_result(self.hk_in.text, self.app.year)
        if mac.is_valid or hk.is_valid:
            _d, summary = settle_orders(
                self.app.records, {"澳门": mac, "香港": hk},
                self.app.odds, self.app.rebate)
            for row in summary[1:]:
                if row[0]:
                    vals = [fmt_num(v) if isinstance(v, float) else str(v) for v in row]
                    self.t_win.add(vals)

        # 风险
        self.t_risk.clear()
        try:
            risk = build_risk_rows(self.app.records, self.app.year,
                                   self.app.odds, self.app.rebate)
            for row in risk[1:]:
                vals = [fmt_num(v) if isinstance(v, float) else str(v) for v in row]
                self.t_risk.add(vals)
        except Exception as e:
            self.t_risk.add(["风险计算失败", str(e)])

        # 错误
        lines = []
        for r in self.app.records:
            if r.warnings:
                lines.append(f"【#{r.seq}】{r.raw_text}")
                lines.extend(f"  - {w}" for w in r.warnings)
                lines.append("")
        self.error_out.text = "\n".join(lines) if lines else "没有错误。"

        # 顶栏合计
        self.total_lbl.text = (f"预览: {fmt_num(self.preview_result.total)}"
                               f" | 记录合计: {fmt_num(sum(r.amount for r in self.app.records))}")

    # ================= 小工具 =================
    def _toast(self, msg, duration=1.6):
        content = BoxLayout(padding=dp(10))
        content.add_widget(Label(text=msg, color=TEXT, font_size=sp(13),
                                 halign="center"))
        p = Popup(title="", content=content, size_hint=(0.85, 0.24),
                  auto_dismiss=True)
        p.open()
        Clock.schedule_once(lambda *_: p.dismiss(), duration)


class BetApp(App):
    title = f"{APP_NAME} v{APP_VERSION}"
    year = "马"

    def build(self):
        self.records: list[OrderRecord] = []
        self.preview_result = ParsedBet("")
        self.odds = load_odds_config()
        self.rebate = load_rebate_config()
        Window.softinput_mode = "below_target"   # 键盘不遮挡输入框
        return Root(self)


if __name__ == "__main__":
    BetApp().run()

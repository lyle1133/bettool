# -*- coding: utf-8 -*-
"""
押注解析与统计内核（从 app_no_console.pyw 拆出，移动端复用）
- v5.8.1 修复：连肖逐组/复试结算、实时风险排序、六肖中正则
- 依赖：仅标准库（Kivy 只用于获取平台判断，可选项）
"""
from __future__ import annotations

import json
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import escape as html_escape
from math import comb
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple, Optional, Set

# ---------- 跨平台平台判断（Android / iOS / 桌面） ----------
try:
    from kivy.utils import platform as _kivy_platform  # type: ignore
except Exception:
    _kivy_platform = sys.platform

APP_NAME = "押注自动统计"
APP_VERSION = "5.8.1"

ZODIAC_ORDER = list("鼠牛虎兔龙蛇马羊猴鸡狗猪")
COLOR_NUMBERS: Dict[str, List[int]] = {
    "红波": [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46],
    "蓝波": [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48],
    "绿波": [5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49],
}
NUMBER_TO_COLOR = {n: color for color, nums in COLOR_NUMBERS.items() for n in nums}
FIXED_ZODIAC_GROUPS: Dict[str, List[str]] = {
    "天肖": list("龙兔牛马猴猪"),
    "地肖": list("鼠虎蛇羊鸡狗"),
    "阴肖": list("鼠龙蛇马狗猪"),
    "阳肖": list("牛虎兔羊猴鸡"),
    "男肖": list("鼠牛虎龙马猴狗"),
    "女肖": list("兔蛇羊鸡猪"),
    "吉肖": list("兔龙蛇马羊鸡"),
    "凶肖": list("鼠牛虎猴狗猪"),
    "红肖": list("马兔鼠鸡"),
    "红生肖": list("马兔鼠鸡"),
    "绿肖": list("羊龙牛狗"),
    "绿生肖": list("羊龙牛狗"),
    "蓝肖": list("蛇虎猪猴"),
    "蓝生肖": list("蛇虎猪猴"),
    "单笔肖": list("鼠龙马蛇鸡猪"),
    "单笔生肖": list("鼠龙马蛇鸡猪"),
    "双笔肖": list("虎猴狗兔羊牛"),
    "双笔生肖": list("虎猴狗兔羊牛"),
    "春天肖": list("兔虎龙"),
    "春天生肖": list("兔虎龙"),
    "春肖": list("兔虎龙"),
    "夏天肖": list("马蛇羊"),
    "夏天生肖": list("马蛇羊"),
    "夏肖": list("马蛇羊"),
    "秋天肖": list("鸡猴狗"),
    "秋天生肖": list("鸡猴狗"),
    "秋肖": list("鸡猴狗"),
    "冬天肖": list("鼠猪牛"),
    "冬天生肖": list("鼠猪牛"),
    "冬肖": list("鼠猪牛"),
}
FIXED_NUMBER_GROUPS: Dict[str, List[int]] = {
    "金": [4, 5, 12, 13, 26, 27, 34, 35, 42, 43],
    "金号": [4, 5, 12, 13, 26, 27, 34, 35, 42, 43],
    "木": [8, 9, 16, 17, 24, 25, 38, 39, 46, 47],
    "木号": [8, 9, 16, 17, 24, 25, 38, 39, 46, 47],
    "水": [1, 14, 15, 22, 23, 30, 31, 44, 45],
    "水号": [1, 14, 15, 22, 23, 30, 31, 44, 45],
    "火": [2, 3, 10, 11, 18, 19, 32, 33, 40, 41, 48, 49],
    "火号": [2, 3, 10, 11, 18, 19, 32, 33, 40, 41, 48, 49],
    "土": [6, 7, 20, 21, 28, 29, 36, 37],
    "土号": [6, 7, 20, 21, 28, 29, 36, 37],
}
YEAR_OPTIONS = {
    "马年（2026 默认）": "马",
    "蛇年（2025）": "蛇",
    "龙年": "龙", "兔年": "兔", "虎年": "虎", "牛年": "牛",
    "鼠年": "鼠", "猪年": "猪", "狗年": "狗", "鸡年": "鸡",
    "猴年": "猴", "羊年": "羊",
}

DEFAULT_ODDS: Dict[str, Optional[float]] = {
    "tema": 47.0, "texiao": 11.0, "texiao_ma": 10.0,
    "pingte_xiao": 2.0, "pingte_xiao_ma": 1.75,
    "pingte_tail": None, "color": None,
    "lianxiao_2": 4.0, "lianxiao_2_ma": 3.5,
    "lianxiao_3": 10.0, "lianxiao_3_ma": 8.5,
    "lianxiao_4": 30.0, "lianxiao_4_ma": 25.0,
    "lianxiao_5": 100.0, "lianxiao_5_ma": 85.0,
    "pingma_2": None, "pingma_3": None,
}
ODDS_ITEMS: List[Tuple[str, str]] = [
    ("tema", "特码"), ("texiao", "特肖（非马）"), ("texiao_ma", "特肖马"),
    ("pingte_xiao", "平特一肖（不带马）"), ("pingte_xiao_ma", "平特一肖（带马/马）"),
    ("pingte_tail", "平特尾"), ("color", "波色/色单双"),
    ("lianxiao_2", "二连肖（不带马）"), ("lianxiao_2_ma", "二连肖（带马）"),
    ("lianxiao_3", "三连肖（不带马）"), ("lianxiao_3_ma", "三连肖（带马）"),
    ("lianxiao_4", "四连肖（不带马）"), ("lianxiao_4_ma", "四连肖（带马）"),
    ("lianxiao_5", "五连肖（不带马）"), ("lianxiao_5_ma", "五连肖（带马）"),
    ("pingma_2", "二中二"), ("pingma_3", "三中三"),
]


def _can_write_dir(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        test_file = path / ".write_test.tmp"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def get_app_dir() -> Path:
    """跨平台可写目录：Android / iOS / macOS / Windows / Linux 通用。"""
    # ---- Android ----
    if _kivy_platform == "android":
        try:
            from android.storage import app_storage_path  # type: ignore
            base = Path(app_storage_path())
            base.mkdir(parents=True, exist_ok=True)
            return base
        except Exception:
            pass

    # ---- iOS ----
    if _kivy_platform == "ios":
        try:
            base = Path.home() / "Documents"
            base.mkdir(parents=True, exist_ok=True)
            return base
        except Exception:
            pass

    # ---- 桌面 ----
    try:
        if sys.platform == "darwin":
            fallback = Path.home() / "Library" / "Application Support" / "BetTool"
        elif os.name == "nt":
            base_dir = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA") or str(Path.home())
            fallback = Path(base_dir) / "BetTool"
        else:
            fallback = Path.home() / ".bet_tool"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback
    except Exception:
        pass

    # ---- 最后兜底 ----
    try:
        candidate = Path.cwd()
        if _can_write_dir(candidate):
            return candidate
    except Exception:
        pass
    import tempfile
    fallback = Path(tempfile.gettempdir()) / "BetTool"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


DEFAULT_REBATE: Dict[str, Optional[float]] = {
    "global": 0.0, "tema": None, "texiao": None,
    "pingte_xiao": None, "pingte_tail": None, "color": None,
    "lianxiao_2": None, "lianxiao_3": None, "lianxiao_4": None, "lianxiao_5": None,
    "pingma_2": None, "pingma_3": None,
}
REBATE_ITEMS: List[Tuple[str, str]] = [
    ("global", "统一回水率"), ("tema", "特码总单"), ("texiao", "特肖/各肖"),
    ("pingte_xiao", "平特一肖"), ("pingte_tail", "尾数平特"), ("color", "波色/色单双"),
    ("lianxiao_2", "二连肖"), ("lianxiao_3", "三连肖"),
    ("lianxiao_4", "四连肖"), ("lianxiao_5", "五连肖"),
    ("pingma_2", "二中二"), ("pingma_3", "三中三"),
]

ODDS_CONFIG_PATH = get_app_dir() / "赔率设置.json"
REBATE_CONFIG_PATH = get_app_dir() / "回水设置.json"


def normalize_odds_config(config: Optional[Dict[str, Optional[float]]] = None) -> Dict[str, Optional[float]]:
    result: Dict[str, Optional[float]] = dict(DEFAULT_ODDS)
    if config:
        for key, value in config.items():
            if key in result:
                if value is None or value == "":
                    result[key] = None
                else:
                    try:
                        result[key] = float(value)
                    except (TypeError, ValueError):
                        pass
    return result


def load_odds_config() -> Dict[str, Optional[float]]:
    if not ODDS_CONFIG_PATH.exists():
        return dict(DEFAULT_ODDS)
    try:
        with ODDS_CONFIG_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return normalize_odds_config(data)
    except Exception:
        return dict(DEFAULT_ODDS)


def save_odds_config(config: Dict[str, Optional[float]]) -> None:
    data = normalize_odds_config(config)
    with ODDS_CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def normalize_rebate_config(config: Optional[Dict[str, Optional[float]]] = None) -> Dict[str, Optional[float]]:
    result: Dict[str, Optional[float]] = dict(DEFAULT_REBATE)
    if config:
        for key, value in config.items():
            if key in result:
                if value is None or value == "":
                    result[key] = None
                else:
                    try:
                        result[key] = float(value)
                    except (TypeError, ValueError):
                        pass
    if result.get("global") is None:
        result["global"] = 0.0
    return result


def load_rebate_config() -> Dict[str, Optional[float]]:
    if not REBATE_CONFIG_PATH.exists():
        return dict(DEFAULT_REBATE)
    try:
        with REBATE_CONFIG_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return normalize_rebate_config(data)
    except Exception:
        return dict(DEFAULT_REBATE)


def save_rebate_config(config: Dict[str, Optional[float]]) -> None:
    data = normalize_rebate_config(config)
    with REBATE_CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def rebate_value_text(value: Optional[float]) -> str:
    return "按统一" if value is None else fmt_num(value) + "%"


def rebate_config_summary(config: Optional[Dict[str, Optional[float]]] = None) -> str:
    rebate = normalize_rebate_config(config)
    return "；".join(f"{label}{rebate_value_text(rebate.get(key))}" for key, label in REBATE_ITEMS)


def rebate_key_for_play(play: str) -> str:
    if play == "特码总单": return "tema"
    if play in {"特肖", "各肖"}: return "texiao"
    if play == "平特一肖": return "pingte_xiao"
    if play == "尾数平特": return "pingte_tail"
    if play == "波色": return "color"
    m = re.match(r"([2345])连肖", play)
    if m: return f"lianxiao_{m.group(1)}"
    if play == "二中二": return "pingma_2"
    if play == "三中三": return "pingma_3"
    return "global"


def rebate_rate_for_play(play: str, config: Optional[Dict[str, Optional[float]]] = None) -> float:
    rebate = normalize_rebate_config(config)
    key = rebate_key_for_play(play)
    value = rebate.get(key)
    if value is None:
        value = rebate.get("global") or 0.0
    return float(value or 0.0)


def odds_value_text(value: Optional[float]) -> str:
    return "待填" if value is None else fmt_num(value) + "倍"


def odds_config_summary(config: Optional[Dict[str, Optional[float]]] = None) -> str:
    odds = normalize_odds_config(config)
    return "；".join(f"{label}{odds_value_text(odds.get(key))}" for key, label in ODDS_ITEMS)


CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
             "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
CN_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}
CN_NUMBER_RE = r"[零〇一二两三四五六七八九十百千万]+"
FIXED_NAME_RE = "|".join(
    sorted(map(re.escape, list(FIXED_ZODIAC_GROUPS.keys()) + list(FIXED_NUMBER_GROUPS.keys())),
           key=len, reverse=True))
ENTITY_BLOCK_RE = rf"(?:(?:红波|蓝波|绿波|红|蓝|绿)|(?:{FIXED_NAME_RE})|[鼠牛虎兔龙蛇马羊猴鸡狗猪]|[0-4]头|[0-9]尾|单|双|大|小)+"


def fmt_num(value: float) -> str:
    value = float(value)
    if value.is_integer():
        return str(int(value))
    return ("%.4f" % value).rstrip("0").rstrip(".")


def fmt_code(n: int) -> str:
    return f"{int(n):02d}"


def cn_to_number(text: str) -> int:
    if not text:
        raise ValueError("空中文数字")
    if all(ch in CN_DIGITS for ch in text):
        return int("".join(str(CN_DIGITS[ch]) for ch in text))
    total = 0; section = 0; number = 0
    for ch in text:
        if ch in CN_DIGITS:
            number = CN_DIGITS[ch]
        elif ch in CN_UNITS:
            unit = CN_UNITS[ch]
            if unit == 10000:
                section = (section + number) * unit
                total += section
                section = 0; number = 0
            else:
                if number == 0: number = 1
                section += number * unit
                number = 0
        else:
            raise ValueError(f"无法识别中文数字：{text}")
    return total + section + number


def build_zodiac_map(year_animal: str) -> Dict[str, List[int]]:
    if year_animal not in ZODIAC_ORDER:
        year_animal = "马"
    idx = ZODIAC_ORDER.index(year_animal)
    result = {animal: [] for animal in ZODIAC_ORDER}
    for n in range(1, 50):
        animal = ZODIAC_ORDER[(idx - (n - 1)) % 12]
        result[animal].append(n)
    return result


def build_number_to_zodiac(year_animal: str) -> Dict[int, str]:
    zmap = build_zodiac_map(year_animal)
    return {n: zodiac for zodiac, nums in zmap.items() for n in nums}


def detect_region(text: str) -> str:
    s = str(text or "")
    hk_prefix = r"(?:^|[\s|,，、。;；:：])香(?=\s*(?:\d|[鼠牛虎兔龙蛇马羊猴鸡狗猪]|特|平|包|红|蓝|绿|单|双|大|小|尾|头|三中三|二中二))"
    if re.search(r"香港|港彩|港", s) or re.search(hk_prefix, s):
        return "香港"
    if re.search(r"澳门|澳門|新澳门|澳彩|澳", s):
        return "澳门"
    return "澳门"


# =========================== 数据结构 ===========================
@dataclass
class BetGroup:
    numbers: List[int]
    amount: float
    label: str = "号码"
    source: str = ""
    play_type: str = "特码总单"
    billing_mode: str = "per_number"
    selection_text: str = ""
    multiplier: int = 1

    @property
    def total(self) -> float:
        if self.billing_mode == "per_number":
            return len(self.numbers) * self.amount
        return self.multiplier * self.amount

    @property
    def content_line(self) -> str:
        if self.billing_mode == "per_number":
            nums = ",".join(fmt_code(n) for n in self.numbers)
            return f"特码总单： {nums}各{fmt_num(self.amount)}"
        if self.billing_mode == "zodiac_split":
            text = self.selection_text or self.label
            return f"各肖： {text}各{fmt_num(self.amount)}"
        text = self.selection_text or self.label
        if self.multiplier > 1:
            return f"{self.play_type}： {text}各{fmt_num(self.amount)} × {self.multiplier}组 = {fmt_num(self.total)}"
        return f"{self.play_type}： {text} {fmt_num(self.amount)}"


@dataclass
class ParsedBet:
    raw_text: str
    groups: List[BetGroup] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    normalized_text: str = ""

    @property
    def total(self) -> float:
        return sum(g.total for g in self.groups)

    @property
    def content(self) -> str:
        return "\n".join(g.content_line for g in self.groups)


@dataclass
class DrawResult:
    raw_text: str = ""
    numbers: List[int] = field(default_factory=list)
    special: Optional[int] = None
    zodiac_set: Set[str] = field(default_factory=set)
    tail_set: Set[int] = field(default_factory=set)
    pingma_numbers: List[int] = field(default_factory=list)
    pingma_set: Set[int] = field(default_factory=set)
    special_zodiac: str = ""
    special_tail: Optional[int] = None
    special_color: str = ""
    warnings: List[str] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return self.special is not None and bool(self.numbers)

    @property
    def summary(self) -> str:
        if not self.is_valid:
            return "未输入有效开奖号码"
        nums = ",".join(fmt_code(n) for n in self.numbers)
        pingma = ",".join(fmt_code(n) for n in self.pingma_numbers)
        zods = ",".join(sorted(self.zodiac_set, key=lambda x: ZODIAC_ORDER.index(x)))
        tails = ",".join(str(t) + "尾" for t in sorted(self.tail_set))
        return f"开奖号码：{nums}；平码：{pingma}；特码：{fmt_code(self.special)}（{self.special_zodiac}/{self.special_tail}尾/{self.special_color}）；平特肖：{zods}；平特尾：{tails}"


@dataclass
class OrderRecord:
    seq: int
    raw_text: str
    bet_content: str
    amount: float
    created_at: str
    groups: List[BetGroup]
    warnings: List[str]
    region: str = "澳门"


# =========================== 预处理 ===========================
def _replace_cn_compact_match(match: re.Match) -> str:
    number_code = match.group(1)
    amount_cn = match.group(2)
    try:
        amount = cn_to_number(amount_cn)
    except ValueError:
        return match.group(0)
    return f"{number_code}各{amount}|"


def _replace_cn_after_each(match: re.Match) -> str:
    try:
        amount = cn_to_number(match.group(1))
    except ValueError:
        return match.group(0)
    return f"各{amount}"


def preprocess_text(raw: str) -> str:
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    text = text.replace("：", ":").replace("～", "~").replace("—", "~").replace("–", "~").replace("－", "-")
    text = text.replace("快", "块").replace("買", "买").replace("¥", "元")
    text = text.replace("颗", "各").replace("个号", "各号").replace("每个号", "各号")

    def _ge_amount_from_ge(match: re.Match) -> str:
        raw_amount = match.group(1)
        try:
            amount = cn_to_number(raw_amount) if re.fullmatch(CN_NUMBER_RE, raw_amount) else float(raw_amount)
            return "各" + fmt_num(amount)
        except Exception:
            return match.group(0)

    text = re.sub(
        rf"(?<=\d)\s*个\s*(\d+(?:\.\d+)?|{CN_NUMBER_RE})\s*(?=(?:元|块|米|斤|钱|片|文|闷|门|点|个|#|井|@|[|]|$))",
        _ge_amount_from_ge, text)
    text = text.replace("各码", "各号").replace("每码", "各号").replace("号码各", "各号")
    text = text.replace("两连肖", "二连肖").replace("兩连肖", "二连肖")
    text = re.sub(r"(?:各组|每组)(?=\s*\d)", "各", text)
    text = text.replace("｛", "{").replace("｝", "}")
    text = text.replace("′", ",").replace("’", ",").replace("‘", ",")
    text = text.replace("∵", ",")
    text = text.replace("！", "|").replace("!", "|")
    text = text.replace("=", "~")
    text = re.sub(r"(?<=[鼠牛虎兔龙蛇马羊猴鸡狗猪])\s*跟\s*(?=[鼠牛虎兔龙蛇马羊猴鸡狗猪])", "", text)
    text = re.sub(r"(?<![鼠牛虎兔龙蛇马羊猴鸡狗猪])防(?=[鼠牛虎兔龙蛇马羊猴鸡狗猪])", "", text)
    text = re.sub(r"(?<=[鼠牛虎兔龙蛇马羊猴鸡狗猪])你(?=(?:[鼠牛虎兔龙蛇马羊猴鸡狗猪])*\s*(?:各号|各数|各|每|一个数|肖))", "牛", text)
    text = re.sub(r"谷(?=\s*\d)", "各", text)
    text = re.sub(r"免(?=\s*(?:各|,|，|、|。|\d|$))", "兔", text)
    text = re.sub(r"(?<=\d)\s*一\s*(?=\d)", "~", text)
    text = re.sub(r"(^|[|\n])\s*\d{2,4}\s*期\s*:?", r"\1", text)
    text = re.sub(r"(?:香港|港彩|港|(?<![\u4e00-\u9fff])香(?=\s*(?:\d|[鼠牛虎兔龙蛇马羊猴鸡狗猪]|特|平|包|红|蓝|绿|单|双|大|小|尾|头))|新?澳门|澳門|澳彩|新奥|澳|奥)\s*:?\s*", "", text)
    text = re.sub(r"^\s*门\s*:?\s*", "", text)
    text = re.sub(r"(?:^|[|\n])\s*(?:老门|新门|门)\s*:?\s*", r"|", text)
    text = re.sub(r"\d{2,4}\s*期\s*:?", "", text)
    text = re.sub(r"(?:一共|共)\s*\d+(?:\.\d+)?", "", text)
    text = re.sub(r"([鼠牛虎兔龙蛇马羊猴鸡狗猪])肖(?=\s*(?:各|每|一个数|号|数))", r"\1", text)
    text = text.replace("免肖", "兔肖")
    text = re.sub(r"一(?=\s*各号)", "", text)
    text = re.sub(r"每(?=\s*各号)", "", text)
    text = re.sub(r"(七不中|六肖中)\s*(?:元|块|米|斤|钱|片|文|闷|门|点)\s*(\d+(?:\.\d+)?)", r"\1\2", text)
    text = re.sub(r"(元|块|米|斤|闷|门|点)\s{2,}(?=\S)", r"\1|", text)

    cn_head_map = {"零": "0", "一": "1", "二": "2", "三": "3", "四": "4"}

    def expand_cn_head_list(match: re.Match) -> str:
        raw = match.group(1)
        digits = []
        for ch in raw:
            if ch in cn_head_map:
                digits.append(cn_head_map[ch])
            elif ch in "01234":
                digits.append(ch)
        return ",".join(f"{d}头" for d in digits)

    text = re.sub(r"(?<!\d)([零一二三四0-4](?:\s*[.,，、。;；/\-~]?\s*[零一二三四])+?)\s*头", expand_cn_head_list, text)
    text = re.sub(r"(?<!\d)([零一二三四])\s*头", expand_cn_head_list, text)
    text = re.sub(r"(?<=\d)[.,，、。]+\s*头", "头", text)

    def expand_head_list(match: re.Match) -> str:
        digits = re.findall(r"[0-4]", match.group(1))
        return ",".join(f"{d}头" for d in digits)
    text = re.sub(r"(?<!\d)([0-4](?:\s*[.,，、。;；/\-~]\s*[0-4])+?)\s*头", expand_head_list, text)
    text = re.sub(r"(?<=\d)[.,，、。]+\s*尾", "尾", text)

    def expand_tail_list(match: re.Match) -> str:
        digits = re.findall(r"[0-9]", match.group(1))
        return ",".join(f"{d}尾" for d in digits)
    text = re.sub(r"(?<!\d)([0-9](?:\s*[.,，、。;；/\-~]\s*[0-9])+?)\s*尾", expand_tail_list, text)

    def expand_compact_tail_list(match: re.Match) -> str:
        return ",".join(f"{d}尾" for d in match.group(1))
    text = re.sub(r"(?<!\d)([0-9]{2,9})\s*尾(?=\s*(?:各|每))", expand_compact_tail_list, text)

    num_pat = r"(?:0?[1-9]|[1-4]\d|49)"
    list_pat = rf"{num_pat}(?:\s*[.,，、。/\-~]+\s*{num_pat})+"
    text = re.sub(
        rf"(?<!\d)({list_pat})\s*[./]+\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|钱|片|文|闷|门|点|个|#|井|@|[|]|$))",
        r"\1各\2", text)
    text = re.sub(
        rf"(?<!\d)({list_pat})\s*和\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|钱|片|文|闷|门|点|个|#|井|@|[|]|$))",
        r"\1各\2", text)
    text = re.sub(
        rf"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*[.,，、]\s*({CN_NUMBER_RE})\s*(?=(?:元|块|米|斤|钱|片|文|闷|门|点|个|#|井|@|[|,，、。.;；\s]|$))",
        lambda m: f"{m.group(1)}各{cn_to_number(m.group(2))}", text)
    text = re.sub(r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*下\s*(\d+(?:\.\d+)?)", r"\1各\2", text)
    text = re.sub(r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*号\s*[-~]+\s*(\d+(?:\.\d+)?)", r"\1各\2", text)

    compact = re.compile(rf"(?<!\d)(0?[1-9]|[1-4]\d)\s*({CN_NUMBER_RE})(?=(?:\d|\s|元|块|米|斤|钱|片|文|[,，。.;；#井@]|$))")
    text = compact.sub(_replace_cn_compact_match, text)

    per_number_phrases = [
        "每一个号码", "每个号码", "每一号码", "每个数", "每一个数", "每一号",
        "各号码", "各个号码", "各号", "各数", "每号码", "每号", "一个号码", "一个号", "一个数", "号各", "客",
    ]
    for phrase in per_number_phrases:
        text = text.replace(phrase, "各号")
    text = re.sub(rf"各号\s*({CN_NUMBER_RE})", lambda m: f"各号{cn_to_number(m.group(1))}", text)
    text = re.sub(rf"各\s*({CN_NUMBER_RE})", _replace_cn_after_each, text)
    text = re.sub(r"各号?\s*[,，、。.]\s*(?=\d)", "各号", text)

    def entity_bare_repl(match: re.Match) -> str:
        entity = match.group(1)
        amount = match.group(2)
        color_combo_re = r"^(?:(?:红波|蓝波|绿波|红|蓝|绿)(?:单|双|大|小)?)+$"
        if re.fullmatch(color_combo_re, entity):
            return f"{entity}{amount}"
        return f"{entity}各{amount}"
    text = re.sub(
        rf"({ENTITY_BLOCK_RE})\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|闷|门|点|个|#|井|@|[,，。.;；|\n]|$))",
        entity_bare_repl, text)

    text = re.sub(
        r"(\d+(?:\.\d+)?)\s*[.,，、。]+\s*(?=(?:平特一肖|平特肖|平特|尾数平特|平特尾|特肖|[二三四五2-5]连肖|[二三四五2-5]连))",
        r"\1|", text)

    def category_buy_repl(match: re.Match) -> str:
        raw = match.group(1); amount = match.group(2); cat = raw[0]
        return f"大小单双{cat}{amount}|"
    text = re.sub(
        rf"(?<![红蓝绿])((?:单数|双数|大数|小数|单|双|大|小))\s*买\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|钱|片|斤|文|闷|门|点|个|#|井|@|\*|[|]|\s|$))",
        category_buy_repl, text)

    text = re.sub(
        r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*买\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|钱|片|斤|文|闷|门|点|个|#|井|@|\*|[|]|$))",
        r"\1各\2", text)
    text = re.sub(
        r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*号\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|钱|片|文|个|#|井|@|\*|[|]|$))",
        r"\1各\2", text)
    text = re.sub(
        r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s+(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|钱|片|文|个|#|井|@|\*|[|]|$))",
        r"\1各\2", text)
    text = re.sub(
        r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*[,，、/]\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤))",
        r"\1各\2", text)
    text = re.sub(
        r"(?<![\d-])(0?[1-9]|[1-4]\d|49)\s*[-~]+\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|钱|片|文|#|井|@|[|]|$))",
        r"\1各\2", text)
    text = re.sub(
        r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*\*\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|斤|个新澳|#|井|@|$))",
        r"\1各\2", text)

    def dot_amount_repl(match: re.Match) -> str:
        amount = float(match.group(2))
        if amount > 49:
            return f"{match.group(1)}各{fmt_num(amount)}"
        return match.group(0)
    text = re.sub(
        r"(?<!\d)(0?[1-9]|[1-4]\d|49)\s*[.]\s*(\d+(?:\.\d+)?)\s*(?=(?:元|块|米|斤|闷|门|点|#|井|@|$))",
        dot_amount_repl, text)

    text = re.sub(r"(?:个)?(?:新澳|新奥)", "", text)
    text = re.sub(r"(?:块钱|元|块|米|斤|钱|片|文|闷|门|点)", "|", text)
    text = re.sub(r"(?<=\d)号(?=(?:[|,，、。.;；]|$))", "", text)
    text = re.sub(r"[\t\n#井@；;！!]+", "|", text)
    text = re.sub(r"\|+", "|", text)
    return text


def _residual_warning(expression: str, tokens: List[str]) -> str:
    residual = expression
    for token in tokens:
        residual = residual.replace(token, "", 1)
    residual = re.sub(r"[\s,，、。.;；|#井@*+/\\:\-~{}\[\]【】]+", "", residual)
    fixed_names_pat = FIXED_NAME_RE
    residual = re.sub(
        rf"(?:特码总单|特码|特|号|数|个|文|新澳|新奥|澳|奥|澳門|澳门|香港|港彩|港|香|新|包肖|肖|码|颗|闷|门|点|老门|新门|{fixed_names_pat}|共\d+(?:\.\d+)?)",
        "", residual)
    return residual


def parse_expression(expression: str, amount: float, year_animal: str) -> Tuple[List[BetGroup], List[str]]:
    zmap = build_zodiac_map(year_animal)
    expression = expression.strip(" \t\n,，。.;；|#井@*+/\\:-~")
    warnings: List[str] = []
    if not expression:
        return [], [f"金额 {fmt_num(amount)} 前没有可识别的号码或类别"]

    token_re = re.compile(rf"{FIXED_NAME_RE}|红波|蓝波|绿波|红|蓝|绿|[鼠牛虎兔龙蛇马羊猴鸡狗猪]|[0-4]头|[0-9]尾|单|双|大|小|\d+")
    tokens = token_re.findall(expression)
    groups: List[BetGroup] = []
    direct_numbers: List[int] = []

    def flush_direct():
        nonlocal direct_numbers
        if direct_numbers:
            groups.append(BetGroup(numbers=direct_numbers, amount=amount, label="号码", source=expression))
            direct_numbers = []

    category_numbers = {
        "单": [n for n in range(1, 50) if n % 2 == 1],
        "双": [n for n in range(1, 50) if n % 2 == 0],
        "大": [n for n in range(25, 50)],
        "小": [n for n in range(1, 25)],
    }
    color_alias = {"红": "红波", "蓝": "蓝波", "绿": "绿波", "红波": "红波", "蓝波": "蓝波", "绿波": "绿波"}
    if tokens and all((t in color_alias or t in category_numbers) for t in tokens):
        colors = [t for t in tokens if t in color_alias]
        cats = [t for t in tokens if t in category_numbers]
        if colors and cats:
            color_nums: Set[int] = set()
            for c in colors:
                color_nums.update(COLOR_NUMBERS[color_alias[c]])
            nums = set(color_nums)
            for cat in cats:
                nums &= set(category_numbers[cat])
            label = "".join(tokens)
            if nums:
                groups.append(BetGroup(numbers=sorted(nums), amount=amount, label=label, source=expression))
            else:
                warnings.append(f"组合没有对应号码：{expression}")
            residual = _residual_warning(expression, tokens)
            if residual:
                warnings.append(f"存在未识别内容：{residual}（原片段：{expression}）")
            return groups, warnings
        if colors and not cats:
            for c in colors:
                groups.append(BetGroup(numbers=list(COLOR_NUMBERS[color_alias[c]]), amount=amount,
                                       label=color_alias[c], source=expression))
            residual = _residual_warning(expression, tokens)
            if residual:
                warnings.append(f"存在未识别内容：{residual}（原片段：{expression}）")
            return groups, warnings
        if cats and not colors and len(cats) > 1:
            nums = set(category_numbers[cats[0]])
            for cat in cats[1:]:
                nums &= set(category_numbers[cat])
            label = "".join(tokens)
            if nums:
                groups.append(BetGroup(numbers=sorted(nums), amount=amount, label=label, source=expression))
            else:
                warnings.append(f"组合没有对应号码：{expression}")
            residual = _residual_warning(expression, tokens)
            if residual:
                warnings.append(f"存在未识别内容：{residual}（原片段：{expression}）")
            return groups, warnings

    for token in tokens:
        if token in FIXED_ZODIAC_GROUPS:
            flush_direct()
            nums: List[int] = []
            for animal in FIXED_ZODIAC_GROUPS[token]:
                nums.extend(zmap[animal])
            groups.append(BetGroup(numbers=sorted(nums), amount=amount, label=token, source=expression))
        elif token in FIXED_NUMBER_GROUPS:
            flush_direct()
            groups.append(BetGroup(numbers=list(FIXED_NUMBER_GROUPS[token]), amount=amount, label=token, source=expression))
        elif token in zmap:
            flush_direct()
            groups.append(BetGroup(numbers=list(zmap[token]), amount=amount, label=f"生肖：{token}", source=expression))
        elif token in COLOR_NUMBERS or token in {"红", "蓝", "绿"}:
            flush_direct()
            cname = {"红": "红波", "蓝": "蓝波", "绿": "绿波"}.get(token, token)
            groups.append(BetGroup(numbers=list(COLOR_NUMBERS[cname]), amount=amount, label=cname, source=expression))
        elif token in category_numbers:
            flush_direct()
            groups.append(BetGroup(numbers=list(category_numbers[token]), amount=amount, label=token, source=expression))
        elif re.fullmatch(r"[0-4]头", token):
            flush_direct()
            head = int(token[0])
            nums = list(range(1, 10)) if head == 0 else list(range(head * 10, min(head * 10 + 10, 50)))
            groups.append(BetGroup(numbers=nums, amount=amount, label=token, source=expression))
        elif re.fullmatch(r"[0-9]尾", token):
            flush_direct()
            tail = int(token[0])
            nums = [n for n in range(1, 50) if n % 10 == tail]
            groups.append(BetGroup(numbers=nums, amount=amount, label=token, source=expression))
        elif token.isdigit():
            n = int(token)
            if 1 <= n <= 49:
                direct_numbers.append(n)
            else:
                warnings.append(f"号码超出 01–49，已跳过：{token}")
    flush_direct()

    residual = _residual_warning(expression, tokens)
    if residual:
        warnings.append(f"存在未识别内容：{residual}（原片段：{expression}）")
    if not groups:
        warnings.append(f"没有识别到有效号码：{expression}")
    return groups, warnings


def _cn_or_digit_to_int(text: str) -> int:
    return int(text) if text.isdigit() else cn_to_number(text)


def _color_special_numbers(selection_text: str) -> List[int]:
    text = (selection_text or "").replace("红波", "红").replace("蓝波", "蓝").replace("绿波", "绿")
    colors = re.findall(r"[红蓝绿]", text)
    cats = re.findall(r"单|双|大|小", text)
    if not colors:
        return []
    nums: Set[int] = set()
    color_map = {"红": "红波", "蓝": "蓝波", "绿": "绿波"}
    for c in colors:
        nums.update(COLOR_NUMBERS[color_map[c]])
    cat_map = {
        "单": {n for n in range(1, 50) if n % 2 == 1},
        "双": {n for n in range(1, 50) if n % 2 == 0},
        "大": {n for n in range(25, 50)},
        "小": {n for n in range(1, 25)},
    }
    for cat in cats:
        nums &= cat_map[cat]
    return sorted(nums)


def parse_special_segment(segment: str, year_animal: str = "马") -> Tuple[List[BetGroup], List[str], bool]:
    clean = re.sub(r"[\s,，、。.;；:#井@]+", "", segment)
    if not clean:
        return [], [], False
    amount_re = rf"(\d+(?:\.\d+)?|{CN_NUMBER_RE})"
    suffix_re = r"(?:×\d+组=?\d+(?:\.\d+)?)?"

    def amount_value(text: str) -> float:
        return float(cn_to_number(text)) if re.fullmatch(CN_NUMBER_RE, text or "") else float(text)

    # 平特5-9尾各600
    m = re.fullmatch(rf"(?:平特一肖|平特肖|平特|尾数平特|平特尾)((?:[0-9]尾)+)(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        tails = re.findall(r"[0-9]尾", m.group(1))
        amount = amount_value(m.group(2))
        return [BetGroup([], amount, "尾数平特", segment, "尾数平特", "fixed",
                         ",".join(tails), len(tails))], [], True

    # 七不中/六不中/五不中/六肖中
    m = re.fullmatch(rf"([0-9,，、.\-~]+)(七不中|六不中|五不中|六肖中){amount_re}{suffix_re}", clean)
    if m:
        return [BetGroup([], amount_value(m.group(3)), m.group(2), segment, m.group(2), "fixed", m.group(1), 1)], [], True
    m = re.fullmatch(rf"([鼠牛虎兔龙蛇马羊猴鸡狗猪]{{2,12}})六肖中{amount_re}{suffix_re}", clean)
    if m:
        return [BetGroup([], amount_value(m.group(2)), "六肖中", segment, "六肖中", "fixed",
                         ",".join(list(m.group(1))), 1)], [], True

    # 波色
    m = re.fullmatch(rf"((?:(?:红波|蓝波|绿波|红|蓝|绿)(?:单|双|大|小)?)+){amount_re}{suffix_re}", clean)
    if m:
        selection = m.group(1)
        amount = amount_value(m.group(2))
        nums = _color_special_numbers(selection)
        if nums:
            display = selection + "波" if selection in {"红", "蓝", "绿"} else selection
            return [BetGroup(nums, amount, "波色", segment, "波色", "fixed", display, 1)], [], True

    # 大小单双
    m = re.fullmatch(rf"(?:大小单双)?(单数|双数|大数|小数|单|双|大|小){amount_re}{suffix_re}", clean)
    if m:
        cat = m.group(1)[0]
        amount = amount_value(m.group(2))
        cat_map = {
            "单": [n for n in range(1, 50) if n % 2 == 1],
            "双": [n for n in range(1, 50) if n % 2 == 0],
            "大": [n for n in range(25, 50)],
            "小": [n for n in range(1, 25)],
        }
        return [BetGroup(cat_map[cat], amount, "波色", segment, "波色", "fixed", cat, 1)], [], True

    def _parse_number_selection(text: str) -> List[int]:
        nums: List[int] = []
        for raw in re.findall(r"0[1-9]|[1-4]\d|49|[1-9]", text or ""):
            n = int(raw)
            if 1 <= n <= 49 and n not in nums:
                nums.append(n)
        return nums

    def _parse_pingma_loose_segment() -> Optional[Tuple[List[BetGroup], List[str], bool]]:
        raw = segment.strip()
        if re.search(r"各|每|组|元|米|块|片", raw):
            return None
        m0 = re.match(r"^\s*(?:平码)?(?:复试|复式)?(三中三|3中3|二中二|2中2)\s*(.+?)\s*$", raw)
        if not m0:
            return None
        play_raw = m0.group(1)
        play_name = "二中二" if play_raw in {"二中二", "2中2"} else "三中三"
        choose = 2 if play_name == "二中二" else 3
        tail = m0.group(2)
        nums_raw = re.findall(r"0[1-9]|[1-4]\d|49|[1-9]", tail)
        if len(nums_raw) < choose + 1:
            return None
        amount_text = nums_raw[-1]
        number_tokens = nums_raw[:-1]
        nums: List[int] = []
        for raw_num in number_tokens:
            n = int(raw_num)
            if 1 <= n <= 49 and n not in nums:
                nums.append(n)
        if len(nums) < choose:
            return None
        amount = float(amount_text)
        multiplier = comb(len(nums), choose) if len(nums) > choose else 1
        selection = ",".join(fmt_code(n) for n in nums)
        return [BetGroup([], amount, play_name, segment, play_name, "fixed", selection, multiplier)], [], True

    loose_pingma = _parse_pingma_loose_segment()
    if loose_pingma:
        return loose_pingma

    def make_pingma(play: str, selection_text: str, amount_text: str) -> Tuple[List[BetGroup], List[str], bool]:
        choose = 2 if play in {"二中二", "2中2"} else 3
        play_name = "二中二" if choose == 2 else "三中三"
        nums = _parse_number_selection(selection_text)
        amount = amount_value(amount_text)
        warnings: List[str] = []
        if len(nums) < choose:
            warnings.append(f"{play_name}号码数量不足：{segment}")
            return [], warnings, True
        multiplier = comb(len(nums), choose) if len(nums) > choose else 1
        selection = ",".join(fmt_code(n) for n in nums)
        return [BetGroup([], amount, play_name, segment, play_name, "fixed", selection, multiplier)], warnings, True

    explicit = re.fullmatch(rf"(?:平码)?(?:三中三|3中3)(.+?)(?:各组|每组|组){amount_re}{suffix_re}", clean)
    if explicit:
        groups = re.findall(r"(?:0?[1-9]|[1-4]\d|49)(?:[-,.，、/](?:0?[1-9]|[1-4]\d|49)){{2}}", explicit.group(1))
        amount = amount_value(explicit.group(2))
        if groups:
            selection = ";".join(groups)
            return [BetGroup([], amount, "三中三", segment, "三中三", "fixed", selection, len(groups))], [], True
    explicit = re.fullmatch(rf"(?:平码)?(?:二中二|2中2)(.+?)(?:各组|每组|组){amount_re}{suffix_re}", clean)
    if explicit:
        groups = re.findall(r"(?:0?[1-9]|[1-4]\d|49)(?:[-,.，、/](?:0?[1-9]|[1-4]\d|49)){{1}}", explicit.group(1))
        amount = amount_value(explicit.group(2))
        if groups:
            selection = ";".join(groups)
            return [BetGroup([], amount, "二中二", segment, "二中二", "fixed", selection, len(groups))], [], True

    m = re.fullmatch(rf"(?:平码)?(?:复试|复式)?(二中二|三中三|2中2|3中3)(.+?)(?:各|每组|组)?{amount_re}{suffix_re}", clean)
    if m:
        return make_pingma(m.group(1), m.group(2), m.group(3))
    m = re.fullmatch(rf"(.+?)(?:平码)?(?:复试|复式)?(二中二|三中三|2中2|3中3)(?:各|每组|组)?{amount_re}{suffix_re}", clean)
    if m:
        return make_pingma(m.group(2), m.group(1), m.group(3))

    def make_lianxiao(animals_text: str, choose_text: str, amount_text: str) -> Tuple[List[BetGroup], List[str], bool]:
        animals = list(animals_text)
        choose = _cn_or_digit_to_int(choose_text)
        amount = amount_value(amount_text)
        warnings: List[str] = []
        if choose < 2 or choose > len(animals):
            warnings.append(f"连肖数量不合理：{segment}")
            return [], warnings, True
        multiplier = comb(len(animals), choose)
        play = f"{choose}连肖" if multiplier == 1 else f"{choose}连肖复试"
        # 复试的 selection_text 保持逗号分隔
        return [BetGroup([], amount, play, segment, play, "fixed", ",".join(animals), multiplier)], warnings, True

    combo_text = re.sub(r"[\s:：]", "", segment).replace("免", "兔")
    combo_text = re.sub(r"[.。;；/]+", "，", combo_text).strip(",，、。.；;/| ")

    def _choose_value(text: str) -> int:
        return _cn_or_digit_to_int(text)

    m = re.fullmatch(
        rf"(?:复试|复式)([二三四五]|[2-5])连肖([鼠牛虎兔龙蛇马羊猴鸡狗猪]{{2,12}})(?:各组|每组|组|各)?{amount_re}{suffix_re}",
        combo_text)
    if m:
        return make_lianxiao(m.group(2), m.group(1), m.group(3))

    # 逐组：用分号作为分隔，让结算能区分"固定组"和"复试"
    m = re.fullmatch(
        rf"(?:平特)?([二三四五]|[2-5])连肖([鼠牛虎兔龙蛇马羊猴鸡狗猪]{{2,5}}(?:[,，、][鼠牛虎兔龙蛇马羊猴鸡狗猪]{{2,5}})*)(?:组)?(?:各组|每组|各)?{amount_re}{suffix_re}",
        combo_text)
    if m:
        choose = _choose_value(m.group(1))
        selections = [x for x in re.split(r"[,，、]", m.group(2)) if x]
        good = [x for x in selections if len(x) == choose]
        if len(good) == len(selections):
            amount = amount_value(m.group(3))
            play = f"{choose}连肖"
            # ⚠️ 修复：用分号分隔每一组，避免被当成"复试"重新组合
            return [BetGroup([], amount, play, segment, play, "fixed",
                             ";".join(selections), len(selections))], [], True

    for choose in (2, 3, 4, 5):
        combo_text = re.sub(rf"(?<=[鼠牛虎兔龙蛇马羊猴鸡狗猪]{{{choose}}})组(?=[鼠牛虎兔龙蛇马羊猴鸡狗猪])", "，", combo_text)
        combo_text = re.sub(rf"(?<=[鼠牛虎兔龙蛇马羊猴鸡狗猪]{{{choose}}})组(?=(?:各组|每组|各|\d|[零〇一二两三四五六七八九十百千万]))", "", combo_text)

    m = re.fullmatch(rf"([鼠牛虎兔龙蛇马羊猴鸡狗猪]{{2,12}})(?:复试)?([二三四五六七八九]|\d+)连肖(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        return make_lianxiao(m.group(1), m.group(2), m.group(3))

    m = re.fullmatch(rf"([二三四五六七八九]|\d+)连肖(?:复试)?([鼠牛虎兔龙蛇马羊猴鸡狗猪]{{2,12}})(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        return make_lianxiao(m.group(2), m.group(1), m.group(3))

    def make_zodiac_split(animals_text: str, amount_text: str) -> Tuple[List[BetGroup], List[str], bool]:
        zmap = build_zodiac_map(year_animal)
        amount = amount_value(amount_text)
        groups: List[BetGroup] = []
        for animal in list(animals_text):
            groups.append(BetGroup(
                numbers=list(zmap[animal]), amount=amount,
                label=f"各肖：{animal}", source=segment,
                play_type="各肖", billing_mode="zodiac_split",
                selection_text=animal, multiplier=1))
        return groups, [], True

    m = re.fullmatch(rf"([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:各肖|每肖)(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        return make_zodiac_split(m.group(1), m.group(2))
    m = re.fullmatch(rf"各肖([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        return make_zodiac_split(m.group(1), m.group(2))

    m = re.fullmatch(rf"(?:包肖|包)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "特肖", segment, "特肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)肖(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "特肖", segment, "特肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "特肖", segment, "特肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"(?:特肖|特)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:一)?(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "特肖", segment, "特肖", "fixed",
                         ",".join(animals), len(animals))], [], True
    m = re.fullmatch(rf"([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:特肖|特)(?:一)?(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "特肖", segment, "特肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"平([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:一)?(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "平特一肖", segment, "平特一肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:平特一肖|平特肖|平特)(?:一)?(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "平特一肖", segment, "平特一肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"(?:平特一肖|平特肖|平特)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:一)?(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "平特一肖", segment, "平特一肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"(?:平特一肖|平特肖)([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        animals = list(m.group(1)); amount = amount_value(m.group(2))
        return [BetGroup([], amount, "平特一肖", segment, "平特一肖", "fixed",
                         ",".join(animals), len(animals))], [], True

    m = re.fullmatch(rf"([二三四五]|[2-5])连(?:肖)?([鼠牛虎兔龙蛇马羊猴鸡狗猪]{{2,12}})(?:各组|每组|组|各)?{amount_re}{suffix_re}", clean)
    if m:
        choose = _cn_or_digit_to_int(m.group(1))
        animals = list(m.group(2))
        amount = amount_value(m.group(3))
        if len(animals) == choose:
            return [BetGroup([], amount, f"{choose}连肖", segment, f"{choose}连肖", "fixed", "".join(animals), 1)], [], True
        elif len(animals) > choose:
            multiplier = comb(len(animals), choose)
            return [BetGroup([], amount, f"{choose}连肖复试", segment, f"{choose}连肖复试", "fixed", ",".join(animals), multiplier)], [], True

    m = re.fullmatch(rf"([0-9])尾(?:平特一肖|平特尾|平特)(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        tail = m.group(1) + "尾"; amount = amount_value(m.group(2))
        return [BetGroup([], amount, "尾数平特", segment, "尾数平特", "fixed", tail, 1)], [], True

    m = re.fullmatch(rf"(?:尾数平特|平特尾|平特)([0-9])尾(?:各)?{amount_re}{suffix_re}", clean)
    if m:
        tail = m.group(1) + "尾"; amount = amount_value(m.group(2))
        return [BetGroup([], amount, "尾数平特", segment, "尾数平特", "fixed", tail, 1)], [], True

    return [], [], False


def _parse_general_segment(segment: str, year_animal: str) -> Tuple[List[BetGroup], List[str], str]:
    groups: List[BetGroup] = []
    warnings: List[str] = []
    matches = list(re.finditer(r"各(?:号)?\s*(\d+(?:\.\d+)?)", segment))
    if not matches:
        return groups, warnings, segment
    cursor = 0
    for match in matches:
        expression = segment[cursor:match.start()]
        amount = float(match.group(1))
        new_groups, new_warnings = parse_expression(expression, amount, year_animal)
        groups.extend(new_groups)
        warnings.extend(new_warnings)
        cursor = match.end()
    return groups, warnings, segment[cursor:]


def parse_bet(raw_text: str, year_animal: str = "马") -> ParsedBet:
    normalized = preprocess_text(raw_text)
    parsed = ParsedBet(raw_text=raw_text or "", normalized_text=normalized)
    if not (raw_text or "").strip():
        parsed.warnings.append("输入内容为空")
        return parsed

    pending: List[str] = []

    def pending_text() -> str:
        return " ".join(x for x in pending if x.strip()).strip()

    def flush_pending_warning(reason: str) -> None:
        text = pending_text()
        if text:
            parsed.warnings.append(f"{reason}：{text}")
        pending.clear()

    for raw_segment in normalized.split("|"):
        segment = raw_segment.strip()
        if not segment:
            continue
        seg_meaning = re.sub(r"[\s,，、。.;；:：|#井@*+/\\\-~]+", "", segment)
        if not seg_meaning or seg_meaning in {"新", "新澳", "新澳门"}:
            continue
        if re.fullmatch(r"(?:总共|合计|总|共)\s*[:：]?\s*\d+(?:\.\d+)?", segment):
            continue

        special_groups, special_warnings, matched = parse_special_segment(segment, year_animal)
        if matched:
            if pending_text():
                flush_pending_warning("前一片段没有找到金额")
            parsed.groups.extend(special_groups)
            parsed.warnings.extend(special_warnings)
            continue

        m = re.fullmatch(r"\s*(0?[1-9]|[1-4]\d|49)\s*[-~]\s*(\d+(?:\.\d+)?)\s*", segment)
        if m:
            if pending_text():
                flush_pending_warning("前一片段没有找到金额")
            parsed.groups.append(BetGroup([int(m.group(1))], float(m.group(2)), "单号", segment))
            continue

        m = re.fullmatch(r"\s*各(?:号)?\s*(\d+(?:\.\d+)?)\s*", segment)
        if m:
            expr = pending_text()
            if not expr:
                parsed.warnings.append(f"金额 {m.group(1)} 前没有可识别的号码或类别")
                continue
            new_groups, new_warnings = parse_expression(expr, float(m.group(1)), year_animal)
            parsed.groups.extend(new_groups)
            parsed.warnings.extend(new_warnings)
            pending.clear()
            continue

        segment = re.sub(r"^\s*(?:特码总单|特码)\s*:\s*", "", segment)

        if re.search(r"各(?:号)?\s*\d", segment):
            if pending_text():
                segment = pending_text() + " " + segment
                pending.clear()
            new_groups, new_warnings, tail = _parse_general_segment(segment, year_animal)
            parsed.groups.extend(new_groups)
            parsed.warnings.extend(new_warnings)
            tail_clean = re.sub(r"[\s,，、。.;；#井@*+/\\:\-~]+", "", tail)
            tail_clean = re.sub(r"(?:总共|合计|总|共|元|块|米|斤|斤|个|新澳|澳|新)\d*", "", tail_clean)
            if tail_clean:
                pending.append(tail)
            continue

        pending.append(segment)

    if pending_text():
        flush_pending_warning("末尾存在未处理内容")
    if not parsed.groups:
        parsed.warnings.append("没有生成任何有效押注内容")
    return parsed


def summarize_orders(records: Sequence[OrderRecord], year_animal: str) -> Tuple[List[List[object]], List[List[object]], List[List[object]], List[List[object]]]:
    n_to_z = build_number_to_zodiac(year_animal)
    number_amount = {n: 0.0 for n in range(1, 50)}
    number_count = {n: 0 for n in range(1, 50)}
    play_stats: Dict[str, List[float]] = {}
    for record in records:
        for group in record.groups:
            stat = play_stats.setdefault(group.play_type, [0.0, 0.0])
            stat[0] += group.multiplier if group.billing_mode == "fixed" else 1
            stat[1] += group.total
            if group.billing_mode == "fixed":
                continue
            if group.billing_mode == "zodiac_split":
                if not group.numbers: continue
                split_amount = group.amount / len(group.numbers)
                for n in group.numbers:
                    number_amount[n] += split_amount
                    number_count[n] += 1
                continue
            for n in group.numbers:
                number_amount[n] += group.amount
                number_count[n] += 1

    number_rows = [[fmt_code(n), n_to_z[n], NUMBER_TO_COLOR[n], n % 10, number_count[n], number_amount[n]]
                   for n in range(1, 50)]

    zmap = build_zodiac_map(year_animal)
    zodiac_rows = [[z, ",".join(fmt_code(n) for n in zmap[z]), sum(number_amount[n] for n in zmap[z])]
                   for z in ZODIAC_ORDER]

    color_rows = [[c, ",".join(fmt_code(n) for n in COLOR_NUMBERS[c]),
                   sum(number_amount[n] for n in COLOR_NUMBERS[c])] for c in ["红波", "蓝波", "绿波"]]

    play_rows: List[List[object]] = []
    preferred = ["特码总单", "波色", "各肖", "特肖", "平特一肖", "尾数平特", "二中二", "三中三"]
    for play in preferred + sorted(p for p in play_stats if p not in preferred):
        if play in play_stats:
            count, amount = play_stats[play]
            play_rows.append([play, int(count), amount])
    return number_rows, zodiac_rows, color_rows, play_rows


def parse_draw_result(raw_text: str, year_animal: str) -> DrawResult:
    text = (raw_text or "").translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    found = [int(x) for x in re.findall(r"(?<!\d)(0?[1-9]|[1-4]\d|49)(?!\d)", text)]
    result = DrawResult(raw_text=raw_text or "")
    if not found:
        result.warnings.append("没有识别到 01–49 的开奖号码")
        return result
    nums: List[int] = []
    for n in found:
        if n not in nums:
            nums.append(n)
    if len(nums) < len(found):
        result.warnings.append("开奖号码中存在重复号码，已按唯一号码读取")
    result.numbers = nums
    result.special = nums[-1]
    result.pingma_numbers = nums[:-1] if len(nums) >= 2 else []
    result.pingma_set = set(result.pingma_numbers)
    if len(nums) < 7:
        result.warnings.append("少于 7 个开奖号码：默认最后一个号码为特码")
    elif len(nums) > 7:
        result.warnings.append("超过 7 个开奖号码：默认最后一个号码为特码，其余号码也参与平特肖/平特尾")
    n_to_z = build_number_to_zodiac(year_animal)
    result.zodiac_set = {n_to_z[n] for n in nums}
    result.tail_set = {n % 10 for n in nums}
    result.special_zodiac = n_to_z[result.special]
    result.special_tail = result.special % 10
    result.special_color = NUMBER_TO_COLOR[result.special]
    return result


def _split_selection_animals(text: str) -> List[str]:
    return [ch for ch in (text or "") if ch in ZODIAC_ORDER]


def _split_selection_tails(text: str) -> List[int]:
    return [int(x) for x in re.findall(r"([0-9])尾", text or "")]


def _texiao_odds(animal: str, odds_config=None) -> Optional[float]:
    odds = normalize_odds_config(odds_config)
    return odds.get("texiao_ma") if animal == "马" else odds.get("texiao")


def _pingte_zodiac_odds(animal: str, odds_config=None) -> Optional[float]:
    odds = normalize_odds_config(odds_config)
    return odds.get("pingte_xiao_ma") if animal == "马" else odds.get("pingte_xiao")


def _pingte_tail_odds(odds_config=None) -> Optional[float]:
    return normalize_odds_config(odds_config).get("pingte_tail")


def _color_odds(odds_config=None) -> Optional[float]:
    return normalize_odds_config(odds_config).get("color")


def _lianxiao_odds(animals: Sequence[str], odds_config=None) -> Optional[float]:
    size = len(animals)
    if size not in {2, 3, 4, 5}: return None
    odds = normalize_odds_config(odds_config)
    key = f"lianxiao_{size}_ma" if "马" in animals else f"lianxiao_{size}"
    return odds.get(key)


def _odds_label(value: Optional[float]) -> str:
    return "待填赔率" if value is None else fmt_num(value) + "倍"


def _split_selection_numbers(text: str) -> List[int]:
    nums: List[int] = []
    for raw in re.findall(r"0[1-9]|[1-4]\d|49|[1-9]", text or ""):
        n = int(raw)
        if 1 <= n <= 49 and n not in nums:
            nums.append(n)
    return nums


def _pingma_odds(play: str, odds_config=None) -> Optional[float]:
    odds = normalize_odds_config(odds_config)
    if play == "二中二": return odds.get("pingma_2")
    if play == "三中三": return odds.get("pingma_3")
    return None


def settle_group(group: BetGroup, draw: DrawResult, odds_config=None) -> Tuple[bool, str, float, str, Optional[float], Optional[float]]:
    if not draw.is_valid:
        return False, "未输入开奖号码", 0.0, "", 0.0, -group.total
    odds_config = normalize_odds_config(odds_config)
    play = group.play_type

    if play == "特码总单":
        if draw.special in group.numbers:
            stake = group.amount / len(group.numbers) if group.billing_mode == "zodiac_split" and group.numbers else group.amount
            odds = odds_config.get("tema")
            if odds is None:
                return True, f"特码 {fmt_code(draw.special)} 命中；未设置赔率", stake, "待填赔率", None, None
            payout = stake * odds
            return True, f"特码 {fmt_code(draw.special)} 命中", stake, _odds_label(odds), payout, payout - group.total
        return False, "未命中特码", 0.0, "", 0.0, -group.total

    if play == "各肖":
        animals = _split_selection_animals(group.selection_text)
        if draw.special_zodiac in animals:
            odds = _texiao_odds(draw.special_zodiac, odds_config)
            if odds is None:
                return True, f"各肖按特肖结算：特码属{draw.special_zodiac}；未设置赔率", group.amount, "待填赔率", None, None
            payout = group.amount * odds
            return True, f"各肖按特肖结算：特码属{draw.special_zodiac}", group.amount, _odds_label(odds), payout, payout - group.total
        return False, "未命中特肖", 0.0, "", 0.0, -group.total

    if play == "特肖":
        animals = _split_selection_animals(group.selection_text)
        if draw.special_zodiac in animals:
            odds = _texiao_odds(draw.special_zodiac, odds_config)
            if odds is None:
                return True, f"特肖命中：特码属{draw.special_zodiac}；未设置赔率", group.amount, "待填赔率", None, None
            payout = group.amount * odds
            return True, f"特肖命中：特码属{draw.special_zodiac}", group.amount, _odds_label(odds), payout, payout - group.total
        return False, "未命中特肖", 0.0, "", 0.0, -group.total

    if play == "平特一肖":
        animals = _split_selection_animals(group.selection_text)
        hit = [a for a in animals if a in draw.zodiac_set]
        if hit:
            parts = []; payout = 0.0
            for animal in hit:
                odds = _pingte_zodiac_odds(animal, odds_config)
                parts.append(f"{animal}{_odds_label(odds)}")
                if odds is not None:
                    payout += group.amount * odds
            win_stake = group.amount * len(hit)
            if any("待填赔率" in p for p in parts):
                return True, "平特肖命中：" + ",".join(hit), win_stake, ",".join(parts), None, None
            return True, "平特肖命中：" + ",".join(hit), win_stake, ",".join(parts), payout, payout - group.total
        return False, "未中平特一肖", 0.0, "", 0.0, -group.total

    if play == "波色":
        nums = group.numbers or _color_special_numbers(group.selection_text)
        if draw.special in nums:
            odds = _color_odds(odds_config)
            if odds is None:
                return True, f"特码 {fmt_code(draw.special)} 属于{group.selection_text}；未设置赔率", group.amount, "待填赔率", None, None
            payout = group.amount * odds
            return True, f"特码 {fmt_code(draw.special)} 属于{group.selection_text}", group.amount, _odds_label(odds), payout, payout - group.total
        return False, f"特码不属于{group.selection_text}", 0.0, "", 0.0, -group.total

    if play == "尾数平特":
        tails = _split_selection_tails(group.selection_text)
        hit = [t for t in tails if t in draw.tail_set]
        if hit:
            win_stake = group.amount * len(hit)
            odds = _pingte_tail_odds(odds_config)
            if odds is None:
                return True, "平特尾命中：" + ",".join(str(t)+"尾" for t in hit) + "；未设置赔率", win_stake, "待填赔率", None, None
            payout = win_stake * odds
            return True, "平特尾命中：" + ",".join(str(t)+"尾" for t in hit), win_stake, _odds_label(odds), payout, payout - group.total
        return False, "未中平特尾", 0.0, "", 0.0, -group.total

    if play in {"二中二", "三中三"}:
        choose = 2 if play == "二中二" else 3
        from itertools import combinations
        if ";" in (group.selection_text or ""):
            combos = []
            for part in group.selection_text.split(";"):
                nums = _split_selection_numbers(part)
                if len(nums) == choose:
                    combos.append(tuple(nums))
        else:
            nums = _split_selection_numbers(group.selection_text)
            if not nums:
                return False, f"{play}未识别到号码", 0.0, "", 0.0, -group.total
            combos = list(combinations(nums, choose)) if len(nums) > choose else [tuple(nums)]
        hit_combos = [c for c in combos if len(c) == choose and all(n in draw.pingma_set for n in c)]
        if hit_combos:
            win_stake = group.amount * len(hit_combos)
            odds = _pingma_odds(play, odds_config)
            names = ["".join(fmt_code(n) for n in c) for c in hit_combos]
            if odds is None:
                return True, f"{play}命中：" + ",".join(names) + "；未设置赔率", win_stake, "待填赔率", None, None
            payout = win_stake * odds
            return True, f"{play}命中：" + ",".join(names), win_stake, _odds_label(odds), payout, payout - group.total
        return False, f"未中{play}（只按平码判断，特码不算）", 0.0, "", 0.0, -group.total

    # ================= 连肖（修复：区分"逐组"与"复试"） =================
    if "连肖" in play:
        from itertools import combinations
        m_size = re.search(r"([2-5])\s*连肖", play)
        expected_size = int(m_size.group(1)) if m_size else 0
        if expected_size < 2:
            return False, "连肖数量不合法", 0.0, "", 0.0, -group.total

        raw = group.selection_text or ""
        combo_list: List[Tuple[str, ...]] = []

        if ";" in raw:
            # 逐组：分号分隔的每一段是固定组合，直接判定，不做组合展开
            for g in raw.split(";"):
                animals = tuple(ch for ch in g if ch in ZODIAC_ORDER)
                if len(animals) == expected_size:
                    combo_list.append(animals)
        else:
            # 复试 或 单组
            parts = re.split(r"[,，、]", raw)
            base_animals = [ch for part in parts for ch in part if ch in ZODIAC_ORDER]
            if len(base_animals) < expected_size:
                base_animals = [ch for ch in raw if ch in ZODIAC_ORDER]

            is_repeated = ("复试" in play or "复式" in play) or (len(base_animals) > expected_size)
            if is_repeated and len(base_animals) >= expected_size:
                combo_list = list(combinations(base_animals, expected_size))
            elif not is_repeated:
                if len(base_animals) == expected_size:
                    combo_list = [tuple(base_animals)]
                elif parts and all(len(p) == expected_size for p in parts if p):
                    combo_list = [tuple(p) for p in parts if len(p) == expected_size]

        hit_combos: List[str] = []
        odds_parts: List[str] = []
        payout = 0.0

        for combo_tuple in combo_list:
            animals = list(combo_tuple)
            combo_name = "".join(animals)
            if all(a in draw.zodiac_set for a in animals):
                odds = _lianxiao_odds(animals, odds_config)
                hit_combos.append(combo_name)
                odds_parts.append(f"{combo_name}{_odds_label(odds)}")
                if odds is not None:
                    payout += group.amount * odds

        if hit_combos:
            win_stake = group.amount * len(hit_combos)
            if any("待填赔率" in p for p in odds_parts):
                return True, "连肖命中：" + ",".join(hit_combos), win_stake, ",".join(odds_parts), None, None
            return True, "连肖命中：" + ",".join(hit_combos), win_stake, ",".join(odds_parts), payout, payout - group.total
        return False, "未中连肖", 0.0, "", 0.0, -group.total

    return False, f"未知玩法：{play}", 0.0, "", 0.0, -group.total


def settlement_summary_play_type(group: BetGroup) -> str:
    return "特肖" if group.play_type == "各肖" else group.play_type


def settle_orders(records: Sequence[OrderRecord], draw, odds_config=None, rebate_config=None) -> Tuple[List[List[object]], List[List[object]]]:
    rebate_config = normalize_rebate_config(rebate_config)
    if isinstance(draw, dict):
        draw_map = {str(k): v for k, v in draw.items()}
    else:
        draw_map = {"澳门": draw}
    default_draw = draw_map.get("澳门") or next((v for v in draw_map.values() if isinstance(v, DrawResult)), DrawResult())
    detail = [["序号", "开奖地区", "玩法", "押注内容", "下单金额", "中奖", "中奖说明", "中奖本金", "赔率", "赔付金额", "回水率", "回水", "最终盈亏"]]
    summary: Dict[str, List[object]] = {}
    for record in records:
        record_region = getattr(record, "region", detect_region(record.raw_text))
        record_draw = draw_map.get(record_region) or default_draw
        if not isinstance(record_draw, DrawResult):
            record_draw = DrawResult()
        for group in record.groups:
            hit, desc, win_stake, odds_text, payout, _profit = settle_group(group, record_draw, odds_config)
            settlement_play = settlement_summary_play_type(group)
            rate = rebate_rate_for_play(settlement_play, rebate_config)
            rebate_amount = group.total * rate / 100.0
            stat = summary.setdefault(settlement_play, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, False])
            stat[0] = float(stat[0]) + group.total
            stat[1] = float(stat[1]) + win_stake
            stat[3] = float(stat[3]) + rebate_amount
            if payout is None:
                stat[6] = True
                final_profit: object = "待填赔率"
            else:
                fv = float(payout) + rebate_amount - group.total
                stat[2] = float(stat[2]) + float(payout)
                stat[4] = float(stat[4]) + fv
                final_profit = fv
            if hit:
                stat[5] = float(stat[5]) + 1
            detail.append([
                record.seq,
                getattr(record, "region", detect_region(record.raw_text)),
                settlement_play, group.content_line, group.total,
                "中" if hit else "未中", desc, win_stake,
                odds_text if isinstance(odds_text, str) else str(odds_text),
                payout if payout is not None else "待填赔率",
                fmt_num(rate) + "%", rebate_amount,
                final_profit if isinstance(final_profit, (int, float, str)) else str(final_profit),
            ])
    summary_rows = [["玩法", "下单金额", "中奖本金", "赔付金额", "回水", "最终盈亏", "命中组数/笔数"]]
    preferred = ["特码总单", "特肖", "平特一肖", "尾数平特", "二中二", "三中三", "2连肖", "3连肖", "4连肖", "5连肖"]
    for play in preferred + sorted(p for p in summary if p not in preferred):
        if play in summary:
            amount, win_stake, payout, rebate, final_profit, hits, unresolved = summary[play]
            summary_rows.append([play, amount, win_stake,
                                 "待填赔率" if unresolved else payout,
                                 rebate,
                                 "待填赔率" if unresolved else final_profit,
                                 int(hits)])
    total_amount = sum(float(v[0]) for v in summary.values())
    total_win_stake = sum(float(v[1]) for v in summary.values())
    known_payout = sum(float(v[2]) for v in summary.values())
    total_rebate = sum(float(v[3]) for v in summary.values())
    known_final = sum(float(v[4]) for v in summary.values())
    unresolved_any = any(bool(v[6]) for v in summary.values())
    if summary:
        summary_rows.append(["合计", total_amount, total_win_stake,
                             "待填赔率" if unresolved_any else known_payout,
                             total_rebate,
                             "待填赔率" if unresolved_any else known_final,
                             sum(int(v[5]) for v in summary.values())])
    return detail, summary_rows


def _risk_draw_for_special(n: int, year_animal: str) -> DrawResult:
    n_to_z = build_number_to_zodiac(year_animal)
    z = n_to_z.get(int(n), "")
    tail = int(n) % 10
    return DrawResult(
        raw_text=fmt_code(n), numbers=[int(n)], special=int(n),
        zodiac_set={z} if z else set(), tail_set={tail},
        pingma_numbers=[], pingma_set=set(),
        special_zodiac=z, special_tail=tail,
        special_color=NUMBER_TO_COLOR.get(int(n), ""), warnings=[])


def build_risk_rows(records: Sequence[OrderRecord], year_animal: str,
                    odds_config=None, rebate_config=None) -> List[List[object]]:
    odds_config = normalize_odds_config(odds_config)
    rebate_config = normalize_rebate_config(rebate_config)
    special_play_types = {"特码总单", "特肖", "各肖", "波色"}
    n_to_z = build_number_to_zodiac(year_animal)

    header = ["地区", "假设特码", "生肖", "波色", "尾数", "统计下注额", "中奖本金",
              "预计赔付", "回水", "预计盈亏", "命中玩法", "风险等级"]
    rows: List[List[object]] = [header]

    regions: List[str] = []
    for record in records:
        region = getattr(record, "region", detect_region(record.raw_text)) or "澳门"
        if region not in regions:
            regions.append(region)
    if not regions:
        return rows + [["", "", "", "", "", 0, 0, 0, 0, 0, "暂无记录", ""]]

    all_data: List[Tuple[float, List[object]]] = []
    for region in regions:
        groups: List[BetGroup] = []
        for record in records:
            record_region = getattr(record, "region", detect_region(record.raw_text)) or "澳门"
            if record_region != region:
                continue
            for group in record.groups:
                if settlement_summary_play_type(group) in special_play_types:
                    groups.append(group)
        base_amount = sum(g.total for g in groups)
        total_rebate = sum(g.total * rebate_rate_for_play(settlement_summary_play_type(g), rebate_config) / 100.0
                           for g in groups)
        if not groups:
            continue

        for n in range(1, 50):
            draw = _risk_draw_for_special(n, year_animal)
            win_stake = 0.0; payout_total = 0.0; unresolved = False
            hit_plays: List[str] = []
            for group in groups:
                hit, _desc, stake, _o, payout, _p = settle_group(group, draw, odds_config)
                if hit:
                    win_stake += float(stake or 0.0)
                    hit_plays.append(settlement_summary_play_type(group))
                if payout is None:
                    if hit:
                        unresolved = True
                else:
                    payout_total += float(payout or 0.0)

            if unresolved:
                final_profit: object = "待填赔率"
                risk_level = "[?] 待填赔率"
                sort_profit = float("inf")
            else:
                fv = payout_total + total_rebate - base_amount
                final_profit = fv
                sort_profit = fv
                if fv > 0: risk_level = "[高] 庄亏"
                elif fv > -base_amount * 0.25: risk_level = "[中]"
                else: risk_level = "[低]"

            order = ["特码总单", "特肖", "平特一肖", "尾数平特", "波色"]
            hit_text = "、".join(sorted(set(hit_plays),
                                     key=lambda x: order.index(x) if x in order else 99)) or "无"

            row = [region, fmt_code(n), n_to_z.get(n, ""), NUMBER_TO_COLOR.get(n, ""),
                   str(n % 10) + "尾", base_amount, win_stake,
                   "待填赔率" if unresolved else payout_total,
                   total_rebate, final_profit, hit_text, risk_level]
            all_data.append((sort_profit, row))

    # ⚠️ 修复：升序排列，亏损最大的排最前；"待填赔率"(inf) 自动落到最后
    all_data.sort(key=lambda item: item[0])

    profits = [item[0] for item in all_data if isinstance(item[0], (int, float)) and item[0] != float("inf")]
    if profits:
        max_p = max(profits); min_p = min(profits); avg_p = sum(profits) / len(profits)
        rows.append([
            "[统计]", f"最大:{fmt_num(max_p)}", f"最小:{fmt_num(min_p)}",
            "---", "---", "", "", "", "", f"平均:{fmt_num(avg_p)}", "---", "---",
        ])

    for _, row in all_data:
        rows.append(row)
    return rows


# =========================== XLSX 导出 ===========================
def excel_col(index: int) -> str:
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def xml_text(value: object) -> str:
    return html_escape(str(value), quote=False)


def xlsx_cell(ref: str, value: object, style: int = 0) -> str:
    style_attr = f' s="{style}"' if style else ""
    if value is None:
        return f'<c r="{ref}"{style_attr}/>'
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"{style_attr}><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"{style_attr}><v>{value}</v></c>'
    safe = xml_text(value)
    return f'<c r="{ref}" t="inlineStr"{style_attr}><is><t xml:space="preserve">{safe}</t></is></c>'


def worksheet_xml(rows: Sequence[Sequence[object]], widths: Sequence[float],
                  money_cols: Iterable[int] = (), wrap_cols: Iterable[int] = ()) -> str:
    money_cols = set(money_cols); wrap_cols = set(wrap_cols)
    max_cols = max((len(r) for r in rows), default=1)
    max_rows = max(len(rows), 1)
    cols_xml = "".join(
        f'<col min="{i}" max="{i}" width="{widths[i-1] if i-1 < len(widths) else 14}" customWidth="1"/>'
        for i in range(1, max_cols + 1))
    row_xml: List[str] = []
    for r_idx, row in enumerate(rows, 1):
        cells: List[str] = []
        for c_idx, value in enumerate(row, 1):
            if r_idx == 1: style = 1
            elif c_idx in money_cols: style = 3
            elif c_idx in wrap_cols: style = 2
            else: style = 0
            cells.append(xlsx_cell(f"{excel_col(c_idx)}{r_idx}", value, style))
        row_xml.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    dimension = f"A1:{excel_col(max_cols)}{max_rows}"
    auto_filter = f'<autoFilter ref="{dimension}"/>' if max_rows >= 1 else ""
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="{dimension}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>{cols_xml}</cols>
  <sheetData>{''.join(row_xml)}</sheetData>
  {auto_filter}
</worksheet>'''


def export_xlsx(path: str, records: Sequence[OrderRecord], year_animal: str,
                draw: Optional[DrawResult] = None, odds_config=None, rebate_config=None) -> None:
    odds_config = normalize_odds_config(odds_config)
    rebate_config = normalize_rebate_config(rebate_config)
    number_rows, zodiac_rows, color_rows, play_rows = summarize_orders(records, year_animal)
    total_amount = sum(r.amount for r in records)

    order_rows: List[List[object]] = [["序号", "时间", "开奖地区", "添加时的复制粘贴内容", "押注内容", "下单金额", "识别提示"]]
    for record in records:
        order_rows.append([
            record.seq, record.created_at,
            getattr(record, "region", detect_region(record.raw_text)),
            str(record.raw_text), str(record.bet_content), record.amount,
            "\n".join(str(w) for w in record.warnings)])
    order_rows.append(["", "", "", "", "合计", total_amount, ""])

    number_sheet = [["号码", "生肖", "波色", "尾数", "出现次数", "累计金额"]] + number_rows
    zodiac_sheet = [["生肖", "对应号码", "累计金额"]] + zodiac_rows
    color_sheet = [["波色", "对应号码", "累计金额"]] + color_rows
    play_sheet = [["玩法", "笔数 / 组合数", "累计金额"]] + play_rows
    risk_sheet = build_risk_rows(records, year_animal, odds_config, rebate_config)

    error_rows: List[List[object]] = [["序号", "时间", "识别提示", "原始内容"]]
    for record in records:
        for warning in record.warnings:
            error_rows.append([record.seq, record.created_at, str(warning), str(record.raw_text)])
    if len(error_rows) == 1:
        error_rows.append(["", "", "没有发现错误", ""])

    zmap = build_zodiac_map(year_animal)
    settle_detail_rows: List[List[object]] = []
    settle_summary_rows: List[List[object]] = []
    draw_info_rows: List[List[object]] = [["项目", "澳门", "香港"]]
    draw_map = draw if isinstance(draw, dict) else {"澳门": draw}
    macau_draw = draw_map.get("澳门") if isinstance(draw_map, dict) else None
    hk_draw = draw_map.get("香港") if isinstance(draw_map, dict) else None

    if (macau_draw and macau_draw.is_valid) or (hk_draw and hk_draw.is_valid):
        settle_detail_rows, settle_summary_rows = settle_orders(
            records, {"澳门": macau_draw or DrawResult(), "香港": hk_draw or DrawResult()},
            odds_config, rebate_config)

        def _draw_cell(d: Optional[DrawResult], item: str) -> str:
            if not d or not d.is_valid: return "未输入"
            if item == "开奖号码": return ",".join(fmt_code(n) for n in d.numbers)
            if item == "特码": return f"{fmt_code(d.special)} / {d.special_zodiac} / {d.special_tail}尾 / {d.special_color}"
            if item == "平特一肖": return ",".join(sorted(d.zodiac_set, key=lambda x: ZODIAC_ORDER.index(x)))
            if item == "平特尾": return ",".join(str(t)+"尾" for t in sorted(d.tail_set))
            if item == "提示": return "；".join(d.warnings)
            return ""
        for item in ["开奖号码", "特码", "平特一肖", "平特尾", "提示"]:
            draw_info_rows.append([item, _draw_cell(macau_draw, item), _draw_cell(hk_draw, item)])
        draw_info_rows.extend([
            ["说明", "澳门按澳门开奖结算；香港按香港开奖结算；未标注默认澳门。", "各肖按特肖结算并合并到特肖；最终盈亏 = 赔付 + 回水 - 下单金额。"],
            ["当前赔率", odds_config_summary(odds_config), ""],
            ["当前回水", rebate_config_summary(rebate_config), ""],
        ])
    else:
        draw_info_rows.append(["提示", "澳门/香港均未输入有效开奖号码", ""])
        settle_summary_rows = [["玩法", "下单金额", "中奖本金", "赔付金额", "回水", "最终盈亏", "命中组数/笔数"]]
        settle_detail_rows = [["序号", "开奖地区", "玩法", "押注内容", "下单金额", "中奖", "中奖说明", "中奖本金", "赔率", "赔付金额", "回水率", "回水", "最终盈亏"]]

    rule_rows: List[List[object]] = [["项目", "内容"]]
    rule_rows.append(["当前生肖年份", f"{year_animal}年（01 属{year_animal}）"])
    rule_rows.append(["连肖结算", "逐组用分号分隔，只判断固定组；复试/复式使用组合展开。"])
    rule_rows.append(["赔率规则", odds_config_summary(odds_config)])
    rule_rows.append(["回水规则", rebate_config_summary(rebate_config)])
    for z in ZODIAC_ORDER:
        rule_rows.append([f"生肖：{z}", ",".join(fmt_code(n) for n in zmap[z])])
    for c in ["红波", "蓝波", "绿波"]:
        rule_rows.append([c, ",".join(fmt_code(n) for n in COLOR_NUMBERS[c])])

    sheets = [
        ("押注明细", order_rows, [8, 20, 10, 42, 55, 14, 46], {6}, {4, 5, 7}),
        ("数字汇总", number_sheet, [10, 10, 10, 10, 12, 16], {6}, set()),
        ("生肖汇总", zodiac_sheet, [10, 32, 16], {3}, {2}),
        ("波色汇总", color_sheet, [10, 68, 16], {3}, {2}),
        ("玩法汇总", play_sheet, [18, 18, 16], {3}, set()),
        ("实时风险统计", risk_sheet, [10, 10, 10, 10, 10, 14, 14, 14, 14, 14, 24, 14], {6,7,8,9,10}, {11}),
        ("中奖读取", draw_info_rows, [18, 60, 60], set(), {2, 3}),
        ("中奖汇总", settle_summary_rows, [18, 16, 16, 16, 16, 16, 16], {2,3,4,5,6}, set()),
        ("中奖明细", settle_detail_rows, [8, 10, 16, 55, 14, 10, 34, 14, 16, 16, 12, 14, 16], {5,8,10,12,13}, {4,7,9}),
        ("赔率设置", [["玩法", "赔率"]] + [[l, odds_value_text(odds_config.get(k))] for k, l in ODDS_ITEMS], [28, 16], set(), set()),
        ("回水设置", [["玩法", "回水率"]] + [[l, rebate_value_text(rebate_config.get(k))] for k, l in REBATE_ITEMS], [28, 16], set(), set()),
        ("错误报告", error_rows, [10, 20, 52, 58], set(), {3, 4}),
        ("规则说明", rule_rows, [18, 96], set(), {2}),
    ]

    content_types = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    for idx in range(1, len(sheets) + 1):
        content_types.append(f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    content_types.append('</Types>')

    workbook_sheets = "".join(
        f'<sheet name="{xml_text(name)}" sheetId="{i}" r:id="rId{i}"/>'
        for i, (name, *_rest) in enumerate(sheets, 1))
    workbook_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>{workbook_sheets}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>'''

    rels = []
    for i in range(1, len(sheets) + 1):
        rels.append(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>')
    rels.append(f'<Relationship Id="rId{len(sheets)+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
    workbook_rels = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{''.join(rels)}</Relationships>'''

    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,#0.00"/></numFmts>
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD9E1F2"/></left><right style="thin"><color rgb="FFD9E1F2"/></right><top style="thin"><color rgb="FFD9E1F2"/></top><bottom style="thin"><color rgb="FFD9E1F2"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''

    root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>{APP_NAME}</dc:creator><cp:lastModifiedBy>{APP_NAME}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>'''
    app_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>{APP_NAME}</Application></Properties>'''

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "".join(content_types))
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("docProps/core.xml", core_xml)
        zf.writestr("docProps/app.xml", app_xml)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/styles.xml", styles_xml)
        for i, (_name, rows, widths, money_cols, wrap_cols) in enumerate(sheets, 1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", worksheet_xml(rows, widths, money_cols, wrap_cols))


def export_error_txt(path: str, records: Sequence[OrderRecord]) -> None:
    lines = [f"{APP_NAME} 错误报告", f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ""]
    has_errors = False
    for record in records:
        if record.warnings:
            has_errors = True
            lines.append(f"【第 {record.seq} 条】{record.created_at}")
            lines.append(f"原始内容：{record.raw_text}")
            for warning in record.warnings:
                lines.append(f"- {warning}")
            lines.append("")
    if not has_errors:
        lines.append("没有发现错误。")
    Path(path).write_text("\n".join(lines), encoding="utf-8-sig")

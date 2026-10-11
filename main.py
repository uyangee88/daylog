import calendar
import ctypes
import json
import re
import threading
from ctypes import wintypes
from datetime import date, datetime, timedelta
from pathlib import Path

import webview

DWMWA_BORDER_COLOR = 34
DWMWA_CAPTION_COLOR = 35
DWMWA_TEXT_COLOR = 36


def _colorref(rgb):
    r, g, b = rgb
    return r | (g << 8) | (b << 16)


def apply_titlebar_theme(window):
    try:
        hwnd = wintypes.HWND(window.native.Handle.ToInt64())
        dwmapi = ctypes.windll.dwmapi
        for attr, rgb in (
            (DWMWA_CAPTION_COLOR, (232, 236, 240)),  # --surface-1
            (DWMWA_TEXT_COLOR, (31, 31, 29)),  # --text-primary
            (DWMWA_BORDER_COLOR, (188, 197, 206)),  # --border-strong
        ):
            value = ctypes.c_int(_colorref(rgb))
            dwmapi.DwmSetWindowAttribute(hwnd, ctypes.c_int(attr), ctypes.byref(value), ctypes.sizeof(value))
    except Exception:
        pass  # older Windows without titlebar theming support; not critical

APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
DATA_DIR = Path.home() / "worklog"
DATA_DIR.mkdir(parents=True, exist_ok=True)
TAG_COLORS_FILE = DATA_DIR / "tag_colors.json"

HOUR_RE = re.compile(r"^### (\d{2}:00)\s*$")
ENTRY_RE = re.compile(r"^- (.*)$")
CONT_RE = re.compile(r"^  (.*)$")
STATUS_RE = re.compile(r"^- (focus|mood): (.+)$")
NEXT_RE = re.compile(
    r"^- \[( |x)\] (.*?) \(added: (\d{4}-\d{2}-\d{2})(?:, done: (\d{4}-\d{2}-\d{2}))?(?:, note: (.*))?\)\s*$"
)
TAG_RE = re.compile(r"#([\w가-힣]+)")
DAY_FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")
TIMER_LINE_RE = re.compile(
    r"^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) ~ (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) \| (.*)$"
)
TIME_FMT = "%Y-%m-%d %H:%M"

_lock = threading.Lock()


def day_path(date_str):
    return DATA_DIR / f"{date_str}.md"


def next_path():
    return DATA_DIR / "next.md"


def parse_day(text):
    entries = []
    focus = None
    mood = None
    section = None
    current_group = None
    buffer = None

    def flush():
        nonlocal buffer
        if buffer is not None and current_group is not None:
            current_group["items"].append("\n".join(buffer))
        buffer = None

    for raw in text.split("\n"):
        line = raw.rstrip("\r")
        if line.startswith("## "):
            flush()
            section = line[3:].strip().lower()
            current_group = None
            continue
        if section == "log":
            m = HOUR_RE.match(line)
            if m:
                flush()
                current_group = {"hour": m.group(1), "items": []}
                entries.append(current_group)
                continue
            m = ENTRY_RE.match(line)
            if m:
                flush()
                buffer = [m.group(1)]
                continue
            m = CONT_RE.match(line)
            if m and buffer is not None:
                buffer.append(m.group(1))
                continue
        elif section == "status":
            m = STATUS_RE.match(line)
            if m:
                val = m.group(2).strip()
                if m.group(1) == "focus":
                    focus = val
                else:
                    mood = val
    flush()
    return {"entries": entries, "focus": focus, "mood": mood}


def serialize_day(date_str, entries, focus, mood):
    lines = [f"# {date_str}", "", "## log", ""]
    for g in entries:
        items = [it for it in g.get("items", []) if it.strip() != ""]
        if not items:
            continue
        lines.append(f"### {g['hour']}")
        lines.append("")
        for it in items:
            sublines = it.split("\n")
            lines.append(f"- {sublines[0]}")
            for s in sublines[1:]:
                lines.append(f"  {s}")
        lines.append("")
    lines.append("## status")
    lines.append("")
    if focus:
        lines.append(f"- focus: {focus}")
    if mood:
        lines.append(f"- mood: {mood}")
    lines.append("")
    return "\n".join(lines)


def load_tag_colors():
    if not TAG_COLORS_FILE.exists():
        return {}
    try:
        return json.loads(TAG_COLORS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_tag_colors(mapping):
    TAG_COLORS_FILE.write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# --- timer: kept out of the day files on purpose (see timer.md / timer_running.json) ---


def timer_log_path():
    return DATA_DIR / "timer.md"


def timer_running_path():
    return DATA_DIR / "timer_running.json"


def now_minute():
    return datetime.now().replace(second=0, microsecond=0)


def read_timer_running():
    p = timer_running_path()
    if not p.exists():
        return None
    try:
        with _lock:
            data = json.loads(p.read_text(encoding="utf-8"))
        datetime.strptime(data["start"], TIME_FMT)
        if not str(data["name"]).strip():
            return None
        return {"name": str(data["name"]), "start": data["start"]}
    except Exception:
        return None


def read_timer_records():
    p = timer_log_path()
    if not p.exists():
        return []
    with _lock:
        text = p.read_text(encoding="utf-8")
    records = []
    for line in text.split("\n"):
        m = TIMER_LINE_RE.match(line.rstrip("\r"))
        if not m:
            continue
        start_date, start_time, end_date, end_time, name = m.groups()
        start = datetime.strptime(f"{start_date} {start_time}", TIME_FMT)
        end = datetime.strptime(f"{end_date} {end_time}", TIME_FMT)
        records.append(
            {
                "id": len(records),
                "key": f"{start_date} {start_time}|{name}",
                "date": start_date,
                "start": start_time,
                "end": end_time,
                "minutes": max(0, int((end - start).total_seconds() // 60)),
                "name": name,
            }
        )
    return records


def parse_hm(text):
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", str(text or ""))
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    return (hour, minute) if hour < 24 and minute < 60 else None


def edit_timer_file(index, key, rebuild):
    """Rewrite timer.md in place. `key` must match the record at `index` (guards
    against the file having changed since the UI loaded it); rebuild(sd, st, ed,
    et, name) returns the replacement line, or None to delete the record."""
    p = timer_log_path()
    if not p.exists():
        return
    with _lock:
        lines = p.read_text(encoding="utf-8").split("\n")
        record_lines = [i for i, l in enumerate(lines) if TIMER_LINE_RE.match(l.rstrip("\r"))]
        if not 0 <= index < len(record_lines):
            return
        sd, st, ed, et, name = TIMER_LINE_RE.match(lines[record_lines[index]].rstrip("\r")).groups()
        if f"{sd} {st}|{name}" != key:
            return
        new_line = rebuild(sd, st, ed, et, name)
        if new_line is None:
            del lines[record_lines[index]]
        else:
            lines[record_lines[index]] = new_line
        p.write_text("\n".join(lines), encoding="utf-8")


class Api:
    def __init__(self):
        # underscore prefix: pywebview walks every public attribute of this object
        # (recursively, into nested non-callable objects) to build the exposed JS
        # API surface. A plain `self.window` would make it recurse into the native
        # WinForms window object itself, which hits infinite recursion inside
        # .NET's Rectangle.Empty/AccessibilityObject chain and stalls startup/shutdown
        # for several seconds. A leading underscore is skipped by that scan.
        self._window = None

    def set_window(self, window):
        self._window = window

    def get_day(self, date_str):
        p = day_path(date_str)
        if not p.exists():
            return {"entries": [], "focus": None, "mood": None}
        with _lock:
            text = p.read_text(encoding="utf-8")
        return parse_day(text)

    def save_day(self, date_str, entries, focus, mood):
        has_content = any(
            any(it.strip() for it in g.get("items", [])) for g in entries
        )
        p = day_path(date_str)
        with _lock:
            if not has_content and not focus and not mood:
                if p.exists():
                    p.unlink()
                return {"ok": True}
            content = serialize_day(date_str, entries, focus, mood)
            p.write_text(content, encoding="utf-8")
        return {"ok": True}

    def get_month_tags(self, year, month):
        days_in_month = calendar.monthrange(year, month)[1]
        result = {}
        for d in range(1, days_in_month + 1):
            date_str = f"{year:04d}-{month:02d}-{d:02d}"
            p = day_path(date_str)
            if not p.exists():
                continue
            with _lock:
                text = p.read_text(encoding="utf-8")
            seen = []
            for m in TAG_RE.finditer(text):
                t = m.group(1)
                if t not in seen:
                    seen.append(t)
            if seen:
                result[str(d)] = seen[:4]
        return result

    def _scan_log_items(self, start_date=None, end_date=None):
        """Yield (date_str, hour, item_text) for every log item in range (None = open-ended), oldest first."""
        for p in sorted(DATA_DIR.glob("????-??-??.md")):
            date_str = p.stem
            if not DAY_FILE_RE.match(p.name):
                continue
            if (start_date and date_str < start_date) or (end_date and date_str > end_date):
                continue
            with _lock:
                text = p.read_text(encoding="utf-8")
            for g in parse_day(text)["entries"]:
                for it in g["items"]:
                    yield date_str, g["hour"], it

    def search_tag(self, tag, start_date=None, end_date=None):
        results = []
        for date_str, hour, it in self._scan_log_items(start_date, end_date):
            if tag in [m.group(1) for m in TAG_RE.finditer(it)]:
                results.append({"date": date_str, "hour": hour, "text": it})
        return results

    def search_text(self, query, start_date=None, end_date=None):
        q = (query or "").strip().lower()
        if not q:
            return {"entries": [], "next": []}
        entries = [
            {"date": date_str, "hour": hour, "text": it}
            for date_str, hour, it in self._scan_log_items(start_date, end_date)
            if q in it.lower()
        ]

        def in_range(day):
            return bool(day) and not (
                (start_date and day < start_date) or (end_date and day > end_date)
            )

        next_hits = []
        for item in self.get_next_list():
            if q not in item["text"].lower() and q not in (item.get("note") or "").lower():
                continue
            if start_date or end_date:
                if not (in_range(item["added"]) or in_range(item["doneDate"])):
                    continue
            next_hits.append(item)
        return {"entries": entries, "next": next_hits}

    def list_tags(self):
        counts = {}
        for _, _, it in self._scan_log_items():
            for m in TAG_RE.finditer(it):
                counts[m.group(1)] = counts.get(m.group(1), 0) + 1
        return [
            {"tag": t, "count": c}
            for t, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]

    def get_next_list(self):
        p = next_path()
        if not p.exists():
            return []
        with _lock:
            text = p.read_text(encoding="utf-8")
        items = []
        for line in text.split("\n"):
            m = NEXT_RE.match(line)
            if m:
                items.append(
                    {
                        "done": m.group(1) == "x",
                        "text": m.group(2),
                        "added": m.group(3),
                        "doneDate": m.group(4),
                        "note": m.group(5) or None,
                    }
                )
        return items

    def _write_next_list(self, items):
        lines = ["# next", ""]
        for it in items:
            box = "x" if it["done"] else " "
            meta = f"added: {it['added']}"
            if it["done"] and it.get("doneDate"):
                meta += f", done: {it['doneDate']}"
            if it.get("note"):
                meta += f", note: {it['note']}"
            lines.append(f"- [{box}] {it['text']} ({meta})")
        lines.append("")
        with _lock:
            next_path().write_text("\n".join(lines), encoding="utf-8")

    def add_next(self, text):
        text = text.strip()
        if not text:
            return self.get_next_list()
        items = self.get_next_list()
        items.append(
            {
                "done": False,
                "text": text,
                "added": date.today().isoformat(),
                "doneDate": None,
                "note": None,
            }
        )
        self._write_next_list(items)
        return items

    def set_next_note(self, index, note):
        note = " ".join(str(note or "").split())
        items = self.get_next_list()
        if 0 <= index < len(items):
            items[index]["note"] = note or None
            self._write_next_list(items)
        return items

    def set_next_date(self, index, which, value):
        """Change an item's start ('added') or completion ('done') date."""
        items = self.get_next_list()
        try:
            value = date.fromisoformat(str(value)).isoformat()
        except ValueError:
            return items
        if not (0 <= index < len(items)) or which not in ("added", "done"):
            return items
        it = items[index]
        if which == "added":
            if it["done"] and it.get("doneDate") and value > it["doneDate"]:
                return items
            it["added"] = value
        else:
            if not it["done"] or value < it["added"]:
                return items
            it["doneDate"] = value
        self._write_next_list(items)
        return items
    def toggle_next(self, index, done):
        items = self.get_next_list()
        if 0 <= index < len(items):
            items[index]["done"] = bool(done)
            items[index]["doneDate"] = date.today().isoformat() if done else None
            self._write_next_list(items)
        return items

    def edit_next(self, index, text):
        text = text.strip()
        items = self.get_next_list()
        if 0 <= index < len(items):
            if not text:
                items.pop(index)
            else:
                items[index]["text"] = text
            self._write_next_list(items)
        return items

    def delete_next(self, index):
        items = self.get_next_list()
        if 0 <= index < len(items):
            items.pop(index)
            self._write_next_list(items)
        return items

    def export_month(self, year, month):
        days_in_month = calendar.monthrange(year, month)[1]
        parts = [f"# {year}년 {month}월 내보내기", ""]
        for d in range(1, days_in_month + 1):
            date_str = f"{year:04d}-{month:02d}-{d:02d}"
            p = day_path(date_str)
            if not p.exists():
                continue
            with _lock:
                data = parse_day(p.read_text(encoding="utf-8"))
            if not data["entries"] and not data["focus"] and not data["mood"]:
                continue
            parts.append(f"## {month}월 {d}일")
            parts.append("")
            parts.append("### log")
            for g in data["entries"]:
                for it in g["items"]:
                    parts.append(f"- {g['hour']} | {it.replace(chr(10), ' / ')}")
            parts.append("")
            parts.append("### status")
            parts.append(f"- focus: {data['focus'] or '-'}")
            parts.append(f"- mood: {data['mood'] or '-'}")
            parts.append("")
        parts.append("## next")
        for it in self.get_next_list():
            box = "x" if it["done"] else " "
            if it["done"]:
                meta = f"{it['added']} → {it['doneDate'] or it['added']}"
            else:
                meta = it["added"]
            line = f"- [{box}] {it['text']} ({meta})"
            if it.get("note"):
                line += f" — {it['note']}"
            parts.append(line)
        content = "\n".join(parts) + "\n"

        default_name = f"{year:04d}-{month:02d}-worklog.md"
        result = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=str(DATA_DIR),
            save_filename=default_name,
            file_types=("Markdown (*.md)",),
        )
        if not result:
            return {"ok": False}
        path = result if isinstance(result, str) else result[0]
        Path(path).write_text(content, encoding="utf-8")
        return {"ok": True, "path": path}

    def _timer_state(self, date_str):
        records = [r for r in read_timer_records() if r["date"] == date_str]
        return {
            "running": read_timer_running(),
            "records": records,
            "totalMinutes": sum(r["minutes"] for r in records),
        }

    def get_timer(self, date_str):
        return self._timer_state(date_str)

    def timer_start(self, name, date_str):
        name = " ".join(str(name or "").split())
        if name and read_timer_running() is None:
            data = {"name": name, "start": now_minute().strftime(TIME_FMT)}
            with _lock:
                timer_running_path().write_text(
                    json.dumps(data, ensure_ascii=False), encoding="utf-8"
                )
        return self._timer_state(date_str)

    def timer_stop(self, date_str):
        running = read_timer_running()
        if running:
            start = datetime.strptime(running["start"], TIME_FMT)
            end = max(now_minute(), start)
            line = f"- {start:{TIME_FMT}} ~ {end:{TIME_FMT}} | {running['name']}\n"
            with _lock:
                p = timer_log_path()
                if not p.exists():
                    p.write_text("# timer\n\n", encoding="utf-8")
                with p.open("a", encoding="utf-8") as f:
                    f.write(line)
                timer_running_path().unlink()
        return self._timer_state(date_str)

    def timer_update(self, index, key, start, end, name, date_str):
        """Change a record's name and/or start/end time (HH:MM). Pass None for
        anything that should stay as is. An end earlier than the start means the
        next day."""

        def rebuild(sd, st, ed, et, old_name):
            new_name = " ".join(str(name or "").split()) or old_name
            s = parse_hm(start) if start else None
            e = parse_hm(end) if end else None
            if s is None and e is None:
                return f"- {sd} {st} ~ {ed} {et} | {new_name}"
            s = s or tuple(int(x) for x in st.split(":"))
            e = e or tuple(int(x) for x in et.split(":"))
            start_dt = datetime.strptime(sd, "%Y-%m-%d").replace(hour=s[0], minute=s[1])
            end_dt = start_dt.replace(hour=e[0], minute=e[1])
            if end_dt < start_dt:
                end_dt += timedelta(days=1)
                # An "end before start" that would span most of a day is almost
                # certainly a typo, not an overnight record: keep the old times.
                if end_dt - start_dt > timedelta(hours=12):
                    return f"- {sd} {st} ~ {ed} {et} | {new_name}"
            return f"- {start_dt:{TIME_FMT}} ~ {end_dt:{TIME_FMT}} | {new_name}"

        edit_timer_file(index, key, rebuild)
        return self._timer_state(date_str)

    def timer_delete(self, index, key, date_str):
        edit_timer_file(index, key, lambda *_: None)
        return self._timer_state(date_str)

    def get_data_dir(self):
        return str(DATA_DIR)

    def get_tag_colors(self):
        return load_tag_colors()

    def assign_tag_color(self, tag, index):
        with _lock:
            mapping = load_tag_colors()
            mapping[tag] = index
            save_tag_colors(mapping)
        return {"ok": True}


def build_page():
    """Return index.html with style.css and app.js inlined.

    The page is handed to the window as a string, so no local HTTP server is
    started (a window whose server was gone showed an "IP address can't be
    reached" error page) and the browser never caches an old copy.
    """
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    css = (WEB_DIR / "style.css").read_text(encoding="utf-8")
    js = (WEB_DIR / "app.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
    html = re.sub(r'<link rel="stylesheet" href="style\.css[^"]*">',
                  lambda m: "<style>\n" + css + "\n</style>", html)
    html = re.sub(r'<script src="app\.js[^"]*"></script>',
                  lambda m: "<script>\n" + js + "\n</script>", html)
    return html


def main():
    # Without a distinct AppUserModelID, Windows groups this process under
    # the shared pythonw.exe identity and shows its icon on the taskbar
    # instead of our window's icon.
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Daylog.WorkTimeTracker")
    except Exception:
        pass

    api = Api()
    window = webview.create_window(
        "Daylog",
        html=build_page(),
        js_api=api,
        width=1040,
        height=720,
        min_size=(780, 560),
        background_color="#E8ECF0",
    )
    api.set_window(window)
    window.events.shown += lambda: apply_titlebar_theme(window)
    # Private (throwaway) profile: the app uses no browser storage, so nothing
    # is lost, and no old profile data can linger between runs.
    webview.start(
        private_mode=True,
        icon=str(WEB_DIR / "app-icon.ico"),
    )


if __name__ == "__main__":
    main()

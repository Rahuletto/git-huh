#!/usr/bin/env python3
"""hostd — one machine's services, their logs, their CPU and your own panels,
served as JSON for git-huh's `host` section.

Everything it reports is described by one JSON file (see config.example.json):
which services to watch and how (a systemd unit or a process), how to tell
they are healthy, where their logs are, and any number of panels — a number,
a graph, a list, a table — each built from a command, a file or an HTTP
endpoint and shaped by a few plain rules (`path`, `where`, `reduce`, ...).
The app knows nothing about your services: it reads the manifest this
serves and draws whatever the config says is there.

Standard library only, Python 3.8+. Linux (it reads /proc and systemd).

    python3 hostd.py [--config PATH] [--check]

`--check` loads the config, runs every source once, prints what each panel
would return, and exits — the way to write a panel without the app open.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import secrets
import shlex
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

VERSION = 1
DEFAULT_CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "hostd" / "config.json"
STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "hostd"
KINDS = {"stat", "series", "status", "list", "table", "log", "bars"}
TICK = os.sysconf("SC_CLK_TCK")
CPUS = os.cpu_count() or 1


# --- config -----------------------------------------------------------------


class ConfigError(Exception):
    pass


def interpolate(value: Any) -> Any:
    """`${env:NAME}`, `${file:PATH}` and `${json:PATH#a.b}` in any string,
    so secrets stay where they already live instead of being copied in."""
    if isinstance(value, dict):
        return {key: interpolate(item) for key, item in value.items()}
    if isinstance(value, list):
        return [interpolate(item) for item in value]
    if not isinstance(value, str) or "${" not in value:
        return value

    def one(match: re.Match[str]) -> str:
        kind, _, arg = match.group(1).partition(":")
        if kind == "env":
            return os.environ.get(arg, "")
        try:
            if kind == "file":
                return Path(arg).expanduser().read_text().strip()
            if kind == "json":
                path, _, keys = arg.partition("#")
                found = dig(json.loads(Path(path).expanduser().read_text()), keys)
                return "" if found is None else str(found)
        except (OSError, json.JSONDecodeError) as error:
            # One unreadable secret fails the panel that uses it, not the host.
            print(f"hostd: could not read ${{{kind}:{arg}}} · {error}", file=sys.stderr)
            return ""
        raise ConfigError(f"unknown ${{{kind}:…}} in {value!r}")

    return re.sub(r"\$\{([^}]+)\}", one, value)


def load_config(path: Path) -> dict:
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        raise ConfigError(f"no config at {path} · copy config.example.json there") from None
    except json.JSONDecodeError as error:
        raise ConfigError(f"{path} is not JSON: {error}") from None
    config = interpolate(raw)
    config.setdefault("name", socket.gethostname())
    config.setdefault("every", 10)
    config.setdefault("keep", 360)
    config.setdefault("disks", ["/"])
    config.setdefault("services", [])
    config.setdefault("panels", [])
    seen: set[str] = set()
    for service in config["services"]:
        if "id" not in service:
            raise ConfigError("every service needs an id")
        if service["id"] in seen:
            raise ConfigError(f"two services are called {service['id']}")
        seen.add(service["id"])
        service.setdefault("name", service["id"])
        if not ("systemd" in service or "process" in service):
            raise ConfigError(f"{service['id']}: say how to find it, `systemd` or `process`")
        check_panels(service.get("panels", []), service["id"])
    check_panels(config["panels"], "host")
    return config


def check_panels(panels: list, where: str) -> None:
    ids: set[str] = set()
    for panel in panels:
        if "id" not in panel:
            raise ConfigError(f"{where}: every panel needs an id")
        if panel["id"] in ids:
            raise ConfigError(f"{where}: two panels are called {panel['id']}")
        ids.add(panel["id"])
        panel.setdefault("title", panel["id"])
        panel.setdefault("kind", "stat")
        if panel["kind"] not in KINDS:
            raise ConfigError(f"{where}/{panel['id']}: kind must be one of {sorted(KINDS)}")
        if not any(key in panel for key in ("command", "http", "file", "builtin")):
            raise ConfigError(f"{where}/{panel['id']}: needs a source · command, http, file or builtin")


# --- reading the machine -----------------------------------------------------


def read(path: str) -> str:
    try:
        return Path(path).read_text()
    except OSError:
        return ""


class Cpu:
    """Whole-machine CPU as a percentage, from the change in /proc/stat."""

    def __init__(self) -> None:
        self.last = self.sample()

    @staticmethod
    def sample() -> tuple[int, int]:
        fields = [int(part) for part in read("/proc/stat").split("\n", 1)[0].split()[1:]]
        idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
        return sum(fields), idle

    def percent(self) -> float:
        total, idle = self.sample()
        dt, di = total - self.last[0], idle - self.last[1]
        self.last = (total, idle)
        return round(100 * (dt - di) / dt, 1) if dt > 0 else 0.0


def memory() -> dict:
    info = {}
    for line in read("/proc/meminfo").splitlines():
        key, _, rest = line.partition(":")
        info[key] = int(rest.split()[0]) * 1024 if rest.split() else 0
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", 0)
    return {
        "total": total,
        "used": total - available,
        "percent": round(100 * (total - available) / total, 1) if total else 0,
        "swap": info.get("SwapTotal", 0) - info.get("SwapFree", 0),
    }


def temperature() -> float | None:
    """The CPU package's temperature, where the kernel names it."""
    best = None
    for hwmon in Path("/sys/class/hwmon").glob("hwmon*"):
        name = read(str(hwmon / "name")).strip()
        if name not in ("k10temp", "coretemp", "zenpower", "cpu_thermal", "acpitz"):
            continue
        raw = read(str(hwmon / "temp1_input")).strip()
        if raw.isdigit():
            value = int(raw) / 1000
            if name != "acpitz" or best is None:
                best = value
            if name != "acpitz":
                break
    return best


def disks(paths: list[str]) -> list[dict]:
    out = []
    for path in paths:
        try:
            stat = os.statvfs(os.path.expanduser(path))
        except OSError:
            continue
        total = stat.f_blocks * stat.f_frsize
        free = stat.f_bavail * stat.f_frsize
        out.append({
            "path": path,
            "total": total,
            "used": total - free,
            "percent": round(100 * (total - free) / total, 1) if total else 0,
        })
    return out


def uptime() -> float:
    try:
        return float(read("/proc/uptime").split()[0])
    except (IndexError, ValueError):
        return 0.0


def run(command: str | list, timeout: float = 10, env: dict | None = None) -> tuple[int, str]:
    args = command if isinstance(command, list) else ["/bin/sh", "-c", command]
    try:
        done = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, **(env or {})},
        )
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout:g}s"
    except OSError as error:
        return 127, str(error)
    return done.returncode, done.stdout if done.returncode == 0 else (done.stdout + done.stderr)


def fetch(spec: dict | str, timeout: float = 8) -> tuple[int, str, float]:
    """GET (or `method`) a URL; the status, the body and how long it took."""
    if isinstance(spec, str):
        spec = {"url": spec}
    body = spec.get("body")
    data = (json.dumps(body) if isinstance(body, (dict, list)) else body or "").encode() or None
    request = urllib.request.Request(
        spec["url"],
        data=data,
        headers={"User-Agent": "hostd", **spec.get("headers", {})},
        method=spec.get("method", "POST" if data else "GET"),
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=spec.get("timeout", timeout)) as response:
            text = response.read(2_000_000).decode("utf-8", "replace")
            return response.status, text, time.monotonic() - started
    except urllib.error.HTTPError as error:
        return error.code, error.read(200_000).decode("utf-8", "replace"), time.monotonic() - started
    except (urllib.error.URLError, OSError) as error:
        reason = getattr(error, "reason", error)
        return 0, plain(reason), time.monotonic() - started


def plain(error: object) -> str:
    """`[Errno 111] Connection refused` → `connection refused`."""
    return re.sub(r"^\[Errno -?\d+\]\s*", "", str(error)).strip().lower()


# --- services ----------------------------------------------------------------


def systemctl(spec: dict) -> list[str]:
    return ["systemctl", "--user"] if spec.get("user", True) else ["systemctl"]


def systemd_state(spec: dict) -> dict:
    unit = spec["unit"]
    code, out = run(
        systemctl(spec)
        + [
            "show",
            unit,
            "--no-pager",
            "-p",
            "Description,ActiveState,SubState,MainPID,ActiveEnterTimestampMonotonic,"
            "NRestarts,MemoryCurrent,CPUUsageNSec,Result",
        ],
        timeout=5,
    )
    if code != 0:
        return {"state": "unknown", "detail": out.strip()[:200]}
    props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)

    def number(key: str) -> int | None:
        value = props.get(key, "")
        return int(value) if value.isdigit() and int(value) < 2**63 else None

    entered = number("ActiveEnterTimestampMonotonic")
    since = time.time() - (time.monotonic() - entered / 1e6) if entered else None
    active = props.get("ActiveState", "unknown")
    return {
        "state": active,
        "sub": props.get("SubState", ""),
        "description": props.get("Description", ""),
        "pid": number("MainPID") or None,
        "since": since if active == "active" else None,
        "restarts": number("NRestarts"),
        "memory": number("MemoryCurrent"),
        "cpuSeconds": (number("CPUUsageNSec") or 0) / 1e9 if number("CPUUsageNSec") is not None else None,
        "result": props.get("Result", ""),
    }


def process_state(spec: dict) -> dict:
    """Every process whose command line has `match` in it (and, if given,
    runs in `cwd`), summed: how a dev server or a script is watched."""
    match = spec["match"]
    cwd = os.path.realpath(os.path.expanduser(spec["cwd"])) if spec.get("cwd") else None
    me = os.getpid()
    pids, cpu, rss, started = [], 0.0, 0, None
    boot = time.time() - uptime()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == me:
            continue
        cmdline = read(f"{entry}/cmdline").replace("\0", " ").strip()
        if not cmdline or match not in cmdline or "hostd" in cmdline:
            continue
        if cwd:
            try:
                if not os.path.realpath(os.readlink(f"{entry}/cwd")).startswith(cwd):
                    continue
            except OSError:
                continue
        stat = read(f"{entry}/stat")
        fields = stat[stat.rfind(")") + 2 :].split()
        if len(fields) < 22:
            continue
        pids.append(int(entry.name))
        cpu += (int(fields[11]) + int(fields[12])) / TICK
        rss += int(fields[21]) * os.sysconf("SC_PAGE_SIZE")
        began = boot + int(fields[19]) / TICK
        started = began if started is None else min(started, began)
    return {
        "state": "active" if pids else "inactive",
        "sub": f"{len(pids)} process{'es' if len(pids) != 1 else ''}" if pids else "not running",
        "pid": pids[0] if pids else None,
        "pids": pids,
        "since": started,
        "memory": rss,
        "cpuSeconds": cpu,
    }


def health(spec: dict | None) -> dict | None:
    """Is it answering: an HTTP status, a TCP port, or a command's exit code."""
    if not spec:
        return None
    at = time.time()
    if "http" in spec:
        target = spec["http"] if isinstance(spec["http"], dict) else {"url": spec["http"]}
        status, body, took = fetch(target, timeout=spec.get("timeout", 5))
        expect = spec.get("expect")
        ok = status == expect if expect else 200 <= status < 400
        if ok and spec.get("contains"):
            ok = spec["contains"] in body
        detail = f"http {status}" if status else body[:120]
        return {"ok": ok, "detail": detail, "ms": round(took * 1000), "at": at}
    if "tcp" in spec:
        host, _, port = spec["tcp"].rpartition(":")
        started = time.monotonic()
        try:
            with socket.create_connection((host or "127.0.0.1", int(port)), timeout=spec.get("timeout", 3)):
                ok, detail = True, f"port {port} open"
        except OSError as error:
            ok, detail = False, plain(error)
        return {"ok": ok, "detail": detail, "ms": round((time.monotonic() - started) * 1000), "at": at}
    if "command" in spec:
        started = time.monotonic()
        code, out = run(spec["command"], timeout=spec.get("timeout", 10))
        return {
            "ok": code == 0,
            "detail": (out.strip().splitlines() or [f"exit {code}"])[-1][:160],
            "ms": round((time.monotonic() - started) * 1000),
            "at": at,
        }
    return None


def logs(service: dict, lines: int) -> list[str]:
    spec = service.get("logs") or ({"journal": True} if "systemd" in service else None)
    if not spec:
        return []
    if spec.get("journal"):
        unit = spec.get("unit") or service["systemd"]["unit"]
        user = service.get("systemd", {}).get("user", True)
        command = ["journalctl"] + (["--user"] if user else []) + [
            "-u", unit, "-n", str(lines), "-o", "short-iso", "--no-pager", "--no-hostname",
        ]
        _, out = run(command, timeout=10)
    elif spec.get("file"):
        _, out = run(["tail", "-n", str(lines), os.path.expanduser(spec["file"])], timeout=10)
    elif spec.get("command"):
        _, out = run(spec["command"], timeout=10)
    else:
        return []
    return out.rstrip("\n").splitlines()[-lines:]


# --- shaping a source into a panel -------------------------------------------


def dig(value: Any, path: str) -> Any:
    """`a.b.0.c`; `*` steps into every item of a list or every value of an
    object (an object's values carry their key as `_key`)."""
    if not path:
        return value
    head, _, rest = path.partition(".")
    if head == "*":
        if isinstance(value, dict):
            items = [
                {**item, "_key": key} if isinstance(item, dict) else {"_key": key, "value": item}
                for key, item in value.items()
            ]
        elif isinstance(value, list):
            items = value
        else:
            return []
        return [dig(item, rest) for item in items] if rest else items
    if isinstance(value, list):
        if head.isdigit():
            index = int(head)
            return dig(value[index], rest) if index < len(value) else None
        return [dig(item, path) for item in value]
    if isinstance(value, dict):
        return dig(value.get(head), rest)
    return None


def matches(item: Any, where: dict) -> bool:
    for key, wanted in where.items():
        got = dig(item, key)
        if isinstance(wanted, str) and wanted.startswith("!"):
            if str(got) == wanted[1:]:
                return False
        elif isinstance(wanted, str) and wanted[:1] in "<>" and wanted[1:].replace(".", "", 1).isdigit():
            number = to_number(got)
            if number is None or (number >= float(wanted[1:]) if wanted[0] == "<" else number <= float(wanted[1:])):
                return False
        elif wanted is None:
            if got is not None:
                return False
        elif str(got) != str(wanted) and got != wanted:
            return False
    return True


def to_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        found = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
        return float(found.group()) if found else None
    return None


def reduce_(values: list, how: str) -> Any:
    if how == "count":
        return len(values)
    if how in ("first", "last"):
        return (values[0] if how == "first" else values[-1]) if values else None
    if how == "join":
        return ", ".join(str(value) for value in values)
    numbers = [n for n in (to_number(value) for value in values) if n is not None]
    if not numbers:
        return None
    if how == "sum":
        return sum(numbers)
    if how == "avg":
        return sum(numbers) / len(numbers)
    if how == "max":
        return max(numbers)
    if how == "min":
        return min(numbers)
    raise ConfigError(f"reduce must be count, sum, avg, min, max, first, last or join, not {how}")


def builtin(name: str, host: "Host") -> Any:
    snapshot = host.snapshot
    table = {
        "cpu": snapshot.get("cpu"),
        "memory": snapshot.get("memory", {}).get("percent"),
        "load": snapshot.get("load", [None])[0],
        "temperature": snapshot.get("temperature"),
        "uptime": snapshot.get("uptime"),
    }
    if name.startswith("disk:"):
        path = name[5:]
        return next((disk["percent"] for disk in snapshot.get("disks", []) if disk["path"] == path), None)
    if name not in table:
        raise ConfigError(f"builtin must be cpu, memory, load, temperature, uptime or disk:/path, not {name}")
    return table[name]


def shape(panel: dict, host: "Host") -> dict:
    """Run a panel's source and shape it by its rules. Never raises: a
    failure is the panel's `error`, which the app prints in its place."""
    at = time.time()
    try:
        if "builtin" in panel:
            raw: Any = builtin(panel["builtin"], host)
        elif "command" in panel:
            code, out = run(panel["command"], timeout=panel.get("timeout", 15))
            if code != 0:
                return {"error": (out.strip().splitlines() or [f"exit {code}"])[-1][:200], "at": at}
            raw = out
        elif "file" in panel:
            raw = Path(os.path.expanduser(panel["file"])).read_text(errors="replace")
        else:
            status, body, _ = fetch(panel["http"], timeout=panel.get("timeout", 8))
            if not 200 <= status < 300:
                return {"error": f"http {status}" if status else body[:200], "at": at}
            raw = body
        return {"value": pick(raw, panel), "at": at}
    except ConfigError as error:
        return {"error": str(error), "at": at}
    except Exception as error:  # a panel's bad day should not take the rest down
        return {"error": f"{type(error).__name__}: {error}"[:200], "at": at}


def pick(raw: Any, panel: dict) -> Any:
    kind = panel["kind"]
    data: Any = raw
    if isinstance(raw, str) and panel.get("parse", "auto") != "text":
        stripped = raw.strip()
        if stripped[:1] in "[{":
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                data = raw
        if panel.get("lines") or (kind in ("list", "log", "table") and isinstance(data, str)):
            data = [line for line in raw.splitlines() if line.strip()]
            if "tail" in panel:
                data = data[-int(panel["tail"]):]

    if "regex" in panel and isinstance(data, str):
        found = re.findall(panel["regex"], data, re.MULTILINE)
        data = found if kind in ("list", "table", "bars") else (found[0] if found else None)
        if isinstance(data, tuple):
            data = list(data)

    if "path" in panel:
        data = dig(data, panel["path"])
    if "where" in panel and isinstance(data, list):
        data = [item for item in data if matches(item, panel["where"])]
    if "sort" in panel and isinstance(data, list):
        data = sorted(
            data,
            key=lambda item: (lambda v: (v is None, to_number(v) if to_number(v) is not None else str(v)))(dig(item, panel["sort"])),
            reverse=bool(panel.get("desc")),
        )

    if kind == "bars":
        if "group" in panel and isinstance(data, list):
            counts: dict[str, int] = {}
            for item in data:
                label = str(dig(item, panel["group"]))
                counts[label] = counts.get(label, 0) + 1
            data = counts
        if isinstance(data, dict):
            data = [{"label": str(key), "value": to_number(value) or 0} for key, value in data.items()]
        elif isinstance(data, list):
            data = [
                {
                    "label": str(dig(item, panel.get("label", "_key")) if isinstance(item, dict) else item[0]),
                    "value": to_number(dig(item, panel.get("value", "value")) if isinstance(item, dict) else item[1]) or 0,
                }
                for item in data
            ]
        data = sorted(data, key=lambda bar: -bar["value"])[: int(panel.get("limit", 12))]
        return data

    if kind in ("stat", "series", "status") and "reduce" in panel:
        data = reduce_(data if isinstance(data, list) else [data], panel["reduce"])

    if kind in ("stat", "series"):
        number = to_number(data)
        if number is not None:
            number *= panel.get("scale", 1)
            return round(number, panel.get("round", 2))
        return None if data is None else str(data)[:80]

    if kind == "status":
        ok_when = panel.get("ok")
        if ok_when is None:
            return {"ok": bool(data), "text": str(data)[:120]}
        return {"ok": matches({"v": data}, {"v": ok_when}), "text": str(data)[:120]}

    if kind == "table":
        rows = data if isinstance(data, list) else []
        columns = panel.get("columns") or []
        limit = int(panel.get("limit", 50))
        out_rows = []
        for item in rows[:limit]:
            if columns:
                out_rows.append([cell(dig(item, column.get("path", "")), column.get("format")) for column in columns])
            elif isinstance(item, (list, tuple)):
                out_rows.append([cell(value, None) for value in item])
            elif isinstance(item, str):
                out_rows.append(item.split(panel.get("split")) if panel.get("split") else item.split())
            else:
                out_rows.append([cell(item, None)])
        return {
            "columns": [column.get("label", column.get("path", "")) for column in columns] or panel.get("headers", []),
            "rows": out_rows,
            "total": len(rows),
        }

    # list and log: lines of text
    items = data if isinstance(data, list) else ([] if data is None else str(data).splitlines())
    limit = int(panel.get("limit", 200 if kind == "log" else 30))
    template = panel.get("template")
    lines = []
    for item in items[-limit:] if kind == "log" else items[:limit]:
        if template and isinstance(item, dict):
            lines.append(re.sub(r"\{([^}]+)\}", lambda m: str(cell(dig(item, m.group(1).split("|")[0]), (m.group(1).split("|") + [None])[1])), template))
        else:
            lines.append(item if isinstance(item, str) else json.dumps(item))
    return lines


def cell(value: Any, fmt: str | None) -> str:
    if value is None:
        return "—"
    if fmt == "ago":
        number = to_number(value)
        if number is None:
            return str(value)
        seconds = time.time() - (number / 1000 if number > 1e12 else number)
        return ago(seconds)
    if fmt == "bytes":
        number = to_number(value)
        return human_bytes(number) if number is not None else str(value)
    if fmt == "percent":
        number = to_number(value)
        return f"{number:.0f}%" if number is not None else str(value)
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, (dict, list)):
        return json.dumps(value)[:120]
    return str(value)


def ago(seconds: float) -> str:
    if seconds < 60:
        return f"{max(0, int(seconds))}s"
    if seconds < 3600:
        return f"{int(seconds // 60)}m"
    if seconds < 86400:
        return f"{int(seconds // 3600)}h"
    return f"{int(seconds // 86400)}d"


def human_bytes(number: float) -> str:
    for unit in ("b", "kb", "mb", "gb", "tb"):
        if abs(number) < 1024 or unit == "tb":
            return f"{number:.0f} {unit}" if unit == "b" else f"{number:.1f} {unit}"
        number /= 1024
    return str(number)


# --- the sampler ---------------------------------------------------------------


class Ring:
    def __init__(self, keep: int, values: list | None = None) -> None:
        self.keep = keep
        self.values: list = (values or [])[-keep:]

    def add(self, value: Any) -> None:
        self.values.append(value)
        del self.values[: -self.keep]


class Host:
    """Holds the config and everything sampled from it. One background thread
    samples the machine and the services every `every` seconds and each panel
    on its own `every`; requests read what is held."""

    def __init__(self, config_path: Path) -> None:
        self.config_path = config_path
        self.config = load_config(config_path)
        self.mtime = config_path.stat().st_mtime
        self.lock = threading.Lock()
        self.cpu = Cpu()
        self.snapshot: dict = {}
        self.history: dict[str, Ring] = {}
        self.services: dict[str, dict] = {}
        self.service_cpu: dict[str, tuple[float, float]] = {}
        self.panels: dict[str, dict] = {}
        self.panel_due: dict[str, float] = {}
        self.health_due: dict[str, float] = {}
        self.healths: dict[str, dict | None] = {}
        self.config_error: str | None = None
        self.load_history()

    # history survives a restart, so a graph is not empty after a reboot
    def load_history(self) -> None:
        try:
            saved = json.loads((STATE_DIR / "history.json").read_text())
        except (OSError, json.JSONDecodeError):
            return
        keep = int(self.config["keep"])
        self.history = {key: Ring(keep, values) for key, values in saved.get("series", {}).items()}

    def save_history(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with self.lock:
            series = {key: ring.values for key, ring in self.history.items()}
        temporary = STATE_DIR / "history.json.tmp"
        temporary.write_text(json.dumps({"series": series, "saved": time.time()}))
        temporary.replace(STATE_DIR / "history.json")

    def ring(self, key: str) -> Ring:
        if key not in self.history:
            self.history[key] = Ring(int(self.config["keep"]))
        return self.history[key]

    def reload_if_changed(self) -> None:
        try:
            mtime = self.config_path.stat().st_mtime
        except OSError:
            return
        if mtime == self.mtime:
            return
        self.mtime = mtime
        try:
            config = load_config(self.config_path)
        except ConfigError as error:
            self.config_error = str(error)
            print(f"hostd: config not reloaded · {error}", file=sys.stderr)
            return
        with self.lock:
            self.config = config
            self.config_error = None
            self.panel_due.clear()
            self.health_due.clear()
        print("hostd: config reloaded", file=sys.stderr)

    def all_panels(self) -> list[tuple[str, dict]]:
        out = [(f"host/{panel['id']}", panel) for panel in self.config["panels"]]
        for service in self.config["services"]:
            out += [(f"{service['id']}/{panel['id']}", panel) for panel in service.get("panels", [])]
        return out

    def sample(self) -> None:
        now = time.time()
        cpu = self.cpu.percent()
        snapshot = {
            "at": now,
            "cpu": cpu,
            "cores": CPUS,
            "memory": memory(),
            "load": [round(value, 2) for value in os.getloadavg()],
            "uptime": uptime(),
            "temperature": temperature(),
            "disks": disks(self.config["disks"]),
        }
        services = {}
        for service in self.config["services"]:
            state = systemd_state(service["systemd"]) if "systemd" in service else process_state(service["process"])
            seconds = state.pop("cpuSeconds", None)
            last = self.service_cpu.get(service["id"])
            if seconds is not None:
                if last and now > last[1] and seconds >= last[0]:
                    state["cpu"] = round(100 * (seconds - last[0]) / (now - last[1]) / CPUS, 2)
                self.service_cpu[service["id"]] = (seconds, now)
            if service["id"] not in self.health_due or now >= self.health_due[service["id"]]:
                spec = service.get("health")
                self.healths[service["id"]] = health(spec)
                self.health_due[service["id"]] = now + (spec or {}).get("every", 30)
            state["health"] = self.healths.get(service["id"])
            services[service["id"]] = state

        with self.lock:
            self.snapshot = snapshot
            self.services = services
            self.ring("host.cpu").add(cpu)
            self.ring("host.memory").add(snapshot["memory"]["percent"])
            if snapshot["temperature"] is not None:
                self.ring("host.temperature").add(round(snapshot["temperature"], 1))
            for key, state in services.items():
                self.ring(f"{key}.cpu").add(state.get("cpu", 0) if state["state"] == "active" else None)
                self.ring(f"{key}.memory").add(state.get("memory") if state["state"] == "active" else None)
                up = state["state"] == "active" and (state.get("health") or {}).get("ok", True)
                self.ring(f"{key}.up").add(1 if up else 0)

        for key, panel in self.all_panels():
            if now < self.panel_due.get(key, 0):
                continue
            self.panel_due[key] = now + panel.get("every", 60)
            result = shape(panel, self)
            with self.lock:
                self.panels[key] = result
                if panel["kind"] == "series" or panel.get("history"):
                    value = result.get("value")
                    self.ring(f"panel.{key}").add(value if isinstance(value, (int, float)) else None)

    def loop(self, stop: threading.Event) -> None:
        saved = time.monotonic()
        while not stop.is_set():
            started = time.monotonic()
            try:
                self.reload_if_changed()
                self.sample()
            except Exception as error:  # keep sampling whatever one round threw
                print(f"hostd: sample failed · {type(error).__name__}: {error}", file=sys.stderr)
            if time.monotonic() - saved > 300:
                saved = time.monotonic()
                try:
                    self.save_history()
                except OSError as error:
                    print(f"hostd: could not save history · {error}", file=sys.stderr)
            stop.wait(max(1.0, float(self.config["every"]) - (time.monotonic() - started)))

    # --- what the app reads -----------------------------------------------------

    def panel_meta(self, scope: str, panel: dict) -> dict:
        return {
            "id": panel["id"],
            "title": panel["title"],
            "kind": panel["kind"],
            "unit": panel.get("unit", ""),
            "display": panel.get("display", "number"),
            "every": panel.get("every", 60),
            "history": panel["kind"] == "series" or bool(panel.get("history")),
            "max": panel.get("max"),
            "endpoint": f"/v1/panels/{scope}/{panel['id']}",
        }

    def manifest(self) -> dict:
        config = self.config
        return {
            "hostd": VERSION,
            "name": config["name"],
            "every": config["every"],
            "keep": config["keep"],
            "error": self.config_error,
            "endpoints": {
                "overview": "/v1/overview",
                "service": "/v1/services/{id}",
                "logs": "/v1/services/{id}/logs?lines={n}",
                "action": "/v1/services/{id}/actions/{action}",
                "panel": "/v1/panels/{scope}/{id}",
            },
            "panels": [self.panel_meta("host", panel) for panel in config["panels"]],
            "services": [
                {
                    "id": service["id"],
                    "name": service["name"],
                    "about": service.get("about", ""),
                    "via": "systemd" if "systemd" in service else "process",
                    "unit": service.get("systemd", {}).get("unit") or service.get("process", {}).get("match"),
                    "url": service.get("url"),
                    "logs": bool(service.get("logs") or "systemd" in service),
                    "actions": [action_meta(action) for action in service.get("actions", [])],
                    "panels": [self.panel_meta(service["id"], panel) for panel in service.get("panels", [])],
                }
                for service in config["services"]
            ],
        }

    def series(self, key: str, points: int) -> list:
        ring = self.history.get(key)
        return ring.values[-points:] if ring else []

    def panel_payload(self, scope: str, panel: dict, points: int) -> dict:
        key = f"{scope}/{panel['id']}"
        result = dict(self.panels.get(key) or {"pending": True})
        if panel["kind"] == "series" or panel.get("history"):
            result["series"] = self.series(f"panel.{key}", points)
        return {**self.panel_meta(scope, panel), **result}

    def overview(self, points: int) -> dict:
        with self.lock:
            return {
                "name": self.config["name"],
                "host": {
                    **self.snapshot,
                    "series": {
                        "cpu": self.series("host.cpu", points),
                        "memory": self.series("host.memory", points),
                        "temperature": self.series("host.temperature", points),
                    },
                },
                "services": [
                    {
                        "id": service["id"],
                        "name": service["name"],
                        **self.services.get(service["id"], {"state": "unknown"}),
                        "series": {
                            "cpu": self.series(f"{service['id']}.cpu", points),
                            "up": self.series(f"{service['id']}.up", points),
                        },
                    }
                    for service in self.config["services"]
                ],
                "panels": [self.panel_payload("host", panel, points) for panel in self.config["panels"]],
                "every": self.config["every"],
            }

    def service(self, service_id: str, points: int) -> dict | None:
        found = next((s for s in self.config["services"] if s["id"] == service_id), None)
        if not found:
            return None
        with self.lock:
            return {
                "id": found["id"],
                "name": found["name"],
                "about": found.get("about", ""),
                "url": found.get("url"),
                **self.services.get(service_id, {"state": "unknown"}),
                "actions": [action_meta(action) for action in found.get("actions", [])],
                "series": {
                    "cpu": self.series(f"{service_id}.cpu", points),
                    "memory": self.series(f"{service_id}.memory", points),
                    "up": self.series(f"{service_id}.up", points),
                },
                "panels": [self.panel_payload(service_id, panel, points) for panel in found.get("panels", [])],
                "every": self.config["every"],
            }

    def refresh_panel(self, scope: str, panel_id: str, points: int) -> dict | None:
        panels = self.config["panels"] if scope == "host" else next(
            (s.get("panels", []) for s in self.config["services"] if s["id"] == scope), []
        )
        panel = next((p for p in panels if p["id"] == panel_id), None)
        if not panel:
            return None
        result = shape(panel, self)
        with self.lock:
            self.panels[f"{scope}/{panel_id}"] = result
            return self.panel_payload(scope, panel, points)

    def act(self, service_id: str, action_id: str) -> tuple[int, dict]:
        found = next((s for s in self.config["services"] if s["id"] == service_id), None)
        if not found:
            return 404, {"error": "no such service"}
        action = next((a for a in found.get("actions", []) if action_meta(a)["id"] == action_id), None)
        if action is None:
            return 403, {"error": f"{action_id} is not allowed for {service_id} · add it to its actions"}
        if isinstance(action, str):
            if "systemd" not in found:
                return 400, {"error": f"{action} needs a systemd unit · give a command instead"}
            code, out = run(systemctl(found["systemd"]) + [action, found["systemd"]["unit"]], timeout=30)
        elif "command" in action:
            code, out = run(action["command"], timeout=action.get("timeout", 30))
        elif "http" in action:
            status, body, _ = fetch(action["http"], timeout=action.get("timeout", 15))
            code, out = (0 if 200 <= status < 300 else 1), (f"http {status} · " + body.strip())[:300]
        else:
            return 400, {"error": "an action needs a command or http"}
        self.health_due.pop(service_id, None)
        if code != 0:
            return 502, {"error": (out.strip().splitlines() or [f"exit {code}"])[-1][:300]}
        return 200, {"ok": True, "detail": out.strip()[:300]}


def action_meta(action: str | dict) -> dict:
    if isinstance(action, str):
        return {"id": action, "label": action, "confirm": action in ("stop", "restart")}
    return {
        "id": action["id"],
        "label": action.get("label", action["id"]),
        "confirm": bool(action.get("confirm", False)),
    }


# --- HTTP --------------------------------------------------------------------


def handler_for(host: Host, token: str | None) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = f"hostd/{VERSION}"

        def log_message(self, fmt: str, *args: Any) -> None:  # quiet: the app polls
            if os.environ.get("HOSTD_VERBOSE"):
                super().log_message(fmt, *args)

        def send(self, status: int, body: Any) -> None:
            data = json.dumps(body, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization")
            self.end_headers()
            self.wfile.write(data)

        def authorised(self) -> bool:
            if not token:
                return True
            given = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            return hmac.compare_digest(given.encode(), token.encode())

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send(204, {})

        def route(self, method: str) -> None:
            url = urlparse(self.path)
            query = parse_qs(url.query)
            points = min(int((query.get("points") or ["120"])[0] or 120), 2000)
            parts = [part for part in url.path.split("/") if part]
            if parts == ["health"] or parts == ["v1", "health"]:
                self.send(200, {"ok": True, "hostd": VERSION, "name": host.config["name"]})
                return
            if not self.authorised():
                self.send(401, {"error": "this needs the token from the host's config"})
                return
            if parts[:1] != ["v1"]:
                self.send(404, {"error": "not here · try /v1"})
                return
            rest = parts[1:]
            if method == "GET" and rest == []:
                self.send(200, host.manifest())
            elif method == "GET" and rest == ["overview"]:
                self.send(200, host.overview(points))
            elif method == "GET" and len(rest) == 2 and rest[0] == "services":
                found = host.service(rest[1], points)
                self.send(200, found) if found else self.send(404, {"error": "no such service"})
            elif method == "GET" and len(rest) == 3 and rest[0] == "services" and rest[2] == "logs":
                found = next((s for s in host.config["services"] if s["id"] == rest[1]), None)
                if not found:
                    self.send(404, {"error": "no such service"})
                    return
                lines = min(int((query.get("lines") or ["200"])[0] or 200), 2000)
                self.send(200, {"lines": logs(found, lines), "at": time.time()})
            elif method == "POST" and len(rest) == 4 and rest[0] == "services" and rest[2] == "actions":
                status, body = host.act(rest[1], rest[3])
                self.send(status, body)
            elif len(rest) == 3 and rest[0] == "panels":
                found = (
                    host.refresh_panel(rest[1], rest[2], points)
                    if method == "POST" or query.get("fresh")
                    else next(
                        (
                            host.panel_payload(rest[1], panel, points)
                            for scope, panels in [("host", host.config["panels"])]
                            + [(s["id"], s.get("panels", [])) for s in host.config["services"]]
                            if scope == rest[1]
                            for panel in panels
                            if panel["id"] == rest[2]
                        ),
                        None,
                    )
                )
                self.send(200, found) if found else self.send(404, {"error": "no such panel"})
            else:
                self.send(404, {"error": "not here"})

        def do_GET(self) -> None:  # noqa: N802
            self.route("GET")

        def do_POST(self) -> None:  # noqa: N802
            self.route("POST")

    return Handler


def tailscale_ip() -> str | None:
    code, out = run(["tailscale", "ip", "-4"], timeout=5)
    return out.strip().splitlines()[0] if code == 0 and out.strip() else None


def resolve_token(config: dict) -> str | None:
    """The config's `token`, or one made on first run and kept beside it."""
    if config.get("token") == "":
        return None
    if config.get("token"):
        return str(config["token"])
    path = STATE_DIR / "token"
    if path.exists():
        return path.read_text().strip()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    made = secrets.token_urlsafe(24)
    path.write_text(made + "\n")
    path.chmod(0o600)
    print(f"hostd: made a token · {path}", file=sys.stderr)
    return made


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--check", action="store_true", help="run every panel once, print, exit")
    args = parser.parse_args()

    try:
        host = Host(args.config.expanduser())
    except ConfigError as error:
        sys.exit(f"hostd: {error}")

    if args.check:
        host.sample()
        time.sleep(1)
        host.sample()
        print(json.dumps({"manifest": host.manifest(), "overview": host.overview(5)}, indent=2))
        for service in host.config["services"]:
            print(json.dumps(host.service(service["id"], 5), indent=2))
        return

    listen = host.config.get("listen") or f"{tailscale_ip() or '127.0.0.1'}:8796"
    addresses = listen if isinstance(listen, list) else [listen]
    token = resolve_token(host.config)

    stop = threading.Event()
    threading.Thread(target=host.loop, args=(stop,), daemon=True).start()
    servers = []
    for item in addresses:
        address, _, port = item.rpartition(":")
        servers.append(ThreadingHTTPServer((address, int(port)), handler_for(host, token)))
    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    names = " and ".join(f"http://{item}" for item in addresses)
    print(f"hostd: {host.config['name']} on {names} · {len(host.config['services'])} services", file=sys.stderr)
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        try:
            host.save_history()
        except OSError:
            pass


if __name__ == "__main__":
    main()

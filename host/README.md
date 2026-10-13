# hostd

A small server for git-huh's `host` section. Run it on a machine of yours and
the app shows, over your tailnet, whether that machine is up and how hard it is
working, whether each service you run on it is up and answering, their CPU and
memory over the last hour, their logs, and any panels you define: a number, a
graph, a list or a table, built from a command, a file or an HTTP endpoint.

You describe all of it in one JSON file. The app has no built-in knowledge of
any service. It reads what `hostd` serves and draws it, so a new graph is a few
lines of config and needs no new build of the app.

It is one Python file using only the standard library (Python 3.8 or later, on
Linux).

## Run it

```bash
mkdir -p ~/.config/hostd
cp config.example.json ~/.config/hostd/config.json   # then edit it
python3 hostd.py --check     # runs every panel once and prints the result
python3 hostd.py             # serves it
```

On first start it makes a token and saves it to `~/.local/state/hostd/token`.
In the app, open `host`, enter the machine's tailnet address
(`http://<machine>.<tailnet>.ts.net:8796`) and paste the token.

To keep it running, use `hostd.service`, a systemd user unit. The comment at the
top of the file has the install steps.

**Keep it on the tailnet.** By default it listens only on the machine's
Tailscale address. Do not put it behind Tailscale Funnel or a public port: it
runs the commands in its config and shows your logs. Release builds of the app
accept plain `http` only for `*.ts.net` names, because WireGuard already
encrypts that traffic. For HTTPS, put it behind `tailscale serve` (tailnet
only).

## The config

```jsonc
{
  "name": "desk",                    // what the app calls the machine
  "listen": "100.64.0.1:8796",       // or a list of addresses; default: the tailscale ip
  "token": "…",                      // optional; "" turns auth off; default: made on first run
  "every": 10,                       // seconds between samples of the machine and the services
  "keep": 360,                       // samples kept per graph (an hour at 10 s)
  "disks": ["/"],
  "panels": [ … ],                   // panels about the machine
  "services": [ … ]
}
```

Any string may use `${env:NAME}`, `${file:PATH}` or `${json:PATH#a.b}`. Secrets
can then stay where they already are and do not have to be copied into the
config.

The config is reloaded when it changes. If a new version fails to load, the old
one keeps running and the manifest reports the error.

### A service

```jsonc
{
  "id": "watcher",
  "name": "page watcher",
  "about": "one line under its name",
  "systemd": { "unit": "watcher.service", "user": true },   // or:
  "process": { "match": "node_modules/.bin/vite", "cwd": "~/code/site" },
  "url": "https://…",                        // opened from its page
  "health": { "http": "http://127.0.0.1:8478/", "expect": 200, "contains": "ok", "every": 30 },
           // or { "tcp": "127.0.0.1:5432" } or { "command": "pg_isready" }
  "logs": { "journal": true },               // the default for systemd; or { "file": "…" } or { "command": "…" }
  "actions": ["restart", "stop", "start",    // systemctl verbs (user units; system units need root)
              { "id": "check", "label": "check now", "confirm": false,
                "http": { "method": "POST", "url": "…", "headers": { … } } },
              { "id": "deploy", "command": "cd ~/code/site && make deploy" }],
  "panels": [ … ]
}
```

The app can only run actions listed here. It cannot send a command of its own.

### A panel

A panel has a **source** (one of the four below), a **kind** that sets how it is
drawn, and **rules** that shape the source's output.

| source | |
|---|---|
| `"command": "…"` | runs in `sh -c`; its stdout |
| `"file": "~/…"` | the file's text |
| `"http": "url"` or `{ "url", "method", "headers", "body" }` | the response body |
| `"builtin": "cpu"` | `cpu`, `memory`, `load`, `temperature`, `uptime`, `disk:/path` |

| kind | value | drawn as |
|---|---|---|
| `stat` | one number or word | a big figure; with `"max"`, a row of dots up to it |
| `series` | one number, sampled every `every` seconds | the figure and its history as the widget's dots |
| `status` | ok or not, and a word | a green or clay dot beside the word (`"ok": "value"` sets what ok is) |
| `list` | lines | rows |
| `table` | rows of columns | a table |
| `log` | lines | monospaced, newest at the bottom |
| `bars` | label → number | a row of dots per label |

The rules are applied in this order. Each one is optional.

- `parse`: `"text"` stops JSON output from being parsed.
- `lines` / `tail`: split text into lines, keeping the last n. `list`, `log` and
  `table` do this on their own.
- `regex`: on text, the first group for a single value, or every match for a
  list.
- `path`: `a.b.0.c`. `*` steps into every item of a list or every value of an
  object, and each value keeps its key as `_key`.
- `where`: `{ "field": "value" }`, `"!value"` for not, `">10"` or `"<10"`.
- `sort` + `desc`: order the items by a field.
- `reduce`: `count`, `sum`, `avg`, `min`, `max`, `first`, `last` or `join`,
  giving one value.
- `group`: for `bars`, counts items by a field.
- `columns`: for `table`, `[{ "label", "path", "format": "ago" | "bytes" | "percent" }]`.
  `headers` names the columns of a text table.
- `template`: for `list`, `"{name} · {ts|ago}"` makes one line from each item.
- `scale`, `round`, `limit`
- `unit`, `display` (`number`, `percent`, `bytes`, `ago`, `duration`), `max`:
  how the app shows the value.
- `every`: how often it is read, in seconds (default 60). `history: true` keeps
  a `stat`'s readings, the same way `series` does.

An example: how many watchers are failing, as a graph over time.

```json
{
  "id": "failing", "title": "failing now", "kind": "series",
  "http": { "url": "http://127.0.0.1:8478/api/status",
            "headers": { "Authorization": "Bearer ${json:~/code/watcher/secrets.json#auth_token}" } },
  "path": "watchers.*", "where": { "last_status": "!ok" }, "reduce": "count", "every": 60
}
```

## The API

Every request except `/health` needs `Authorization: Bearer <token>`.

| | |
|---|---|
| `GET /health` | `{ ok, hostd, name }` |
| `GET /v1` | the manifest: services, panels and the endpoint for each |
| `GET /v1/overview?points=120` | the machine, every service in brief, and the machine's panels |
| `GET /v1/services/{id}` | one service, with its graphs and panels |
| `GET /v1/services/{id}/logs?lines=200` | `{ lines, at }` |
| `POST /v1/services/{id}/actions/{action}` | runs one of the service's actions |
| `GET /v1/panels/{scope}/{id}` | one panel (`scope` is `host` or a service id); `POST` reads it again now |

Graphs are kept in `~/.local/state/hostd/history.json`, so they survive a
restart.

## Tests

```bash
python3 -m unittest host/test_hostd.py
```

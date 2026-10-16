/**
 * `hostd`'s protobuf messages, turned into the shapes the `host` section
 * draws (`Overview`, `ServiceDetail`, `Panel`). The server speaks gRPC and
 * Connect; the screens keep drawing what they always drew, and this is the
 * one place that knows both.
 *
 * Pure: the generated messages and `@bufbuild/protobuf` only, so it is
 * tested on Node.
 */

import type { Timestamp } from '@bufbuild/protobuf/wkt';

import type { GetOverviewResponse, GetServiceResponse, Service } from '../gen/hostd/v1/host_pb';
import { Display as ProtoDisplay, type View } from '../gen/hostd/v1/view_pb';
import type { Display, Overview, Panel, PanelKind, PanelValue, ServiceDetail, ServiceState } from './host';

/** Seconds since the epoch, or null. */
export function seconds(at: Timestamp | undefined): number | null {
  return at ? Number(at.seconds) + at.nanos / 1e9 : null;
}

/** A history from the wire: NaN is a reading that had no number. */
export function points(values: readonly number[]): (number | null)[] {
  return values.map((value) => (Number.isFinite(value) ? value : null));
}

const number = (value: bigint | number | undefined): number | null => (value == null ? null : Number(value));

const DISPLAYS: Record<ProtoDisplay, Display> = {
  [ProtoDisplay.UNSPECIFIED]: 'number',
  [ProtoDisplay.NUMBER]: 'number',
  [ProtoDisplay.PERCENT]: 'percent',
  [ProtoDisplay.BYTES]: 'bytes',
  [ProtoDisplay.AGO]: 'ago',
  [ProtoDisplay.DURATION]: 'duration',
};

/** One View: what it is drawn as, its value, and its history if it keeps one. */
export function toPanel(view: View): Panel {
  let kind: PanelKind = 'stat';
  let value: PanelValue | undefined;
  let series: (number | null)[] | undefined;
  const body = view.body;
  switch (body.case) {
    case 'stat': {
      kind = 'stat';
      const v = body.value.value?.kind;
      value = v?.case === 'number' || v?.case === 'text' ? v.value : null;
      if (body.value.history.length > 0) series = points(body.value.history);
      break;
    }
    case 'series': {
      kind = 'series';
      const v = body.value.value?.kind;
      value = v?.case === 'number' || v?.case === 'text' ? v.value : null;
      series = points(body.value.points);
      break;
    }
    case 'status':
      kind = 'status';
      value = { ok: body.value.ok, text: body.value.text };
      break;
    case 'list':
    case 'log':
      kind = body.case;
      value = [...body.value.lines];
      break;
    case 'table':
      kind = 'table';
      value = { columns: [...body.value.columns], rows: body.value.rows.map((row) => [...row.cells]), total: body.value.total };
      break;
    case 'bars':
      kind = 'bars';
      value = body.value.bars.map((bar) => ({ label: bar.label, value: bar.value }));
      break;
  }
  const panel: Panel = {
    id: view.id,
    title: view.title,
    kind,
    unit: view.unit,
    display: DISPLAYS[view.display] ?? 'number',
    every: view.everySeconds,
    history: series != null,
    max: view.max ?? null,
    key: view.key,
  };
  if (view.pending) panel.pending = true;
  else if (view.error) panel.error = view.error;
  else panel.value = value;
  const at = seconds(view.at);
  if (at != null) panel.at = at;
  if (series) panel.series = series;
  return panel;
}

function toServiceState(service: Service): ServiceState {
  const active = service.state === 'active';
  return {
    id: service.id,
    name: service.name,
    state: service.state,
    sub: service.sub,
    description: service.description,
    pid: service.pid || null,
    since: seconds(service.since),
    restarts: service.restarts ?? null,
    memory: active ? number(service.memoryBytes) : null,
    cpu: service.cpuPercent,
    health: service.health
      ? { ok: service.health.ok, detail: service.health.detail, ms: service.health.millis, at: seconds(service.health.at) ?? 0 }
      : null,
    series: {
      cpu: points(service.history?.cpu ?? []),
      up: points(service.history?.up ?? []),
      ...(service.history && service.history.memory.length > 0 ? { memory: points(service.history.memory) } : {}),
    },
  };
}

export function toOverview(response: GetOverviewResponse): Overview {
  const machine = response.machine;
  return {
    name: response.name,
    every: response.everySeconds,
    configError: response.configError || null,
    host: {
      at: seconds(machine?.at) ?? 0,
      cpu: machine?.cpuPercent ?? 0,
      cores: machine?.cores ?? 0,
      memory: {
        total: number(machine?.memory?.totalBytes) ?? 0,
        used: number(machine?.memory?.usedBytes) ?? 0,
        percent: machine?.memory?.percent ?? 0,
        swap: number(machine?.memory?.swapUsedBytes) ?? 0,
      },
      load: [...(machine?.load ?? [])],
      uptime: machine?.uptimeSeconds ?? 0,
      temperature: machine?.temperature ?? null,
      disks: (machine?.disks ?? []).map((disk) => ({
        path: disk.path,
        total: Number(disk.totalBytes),
        used: Number(disk.usedBytes),
        percent: disk.percent,
      })),
      series: {
        cpu: points(response.history?.cpu ?? []),
        memory: points(response.history?.memory ?? []),
        temperature: points(response.history?.temperature ?? []),
      },
    },
    services: response.services.map(toServiceState),
    panels: response.views.map(toPanel),
  };
}

export function toServiceDetail(response: GetServiceResponse): ServiceDetail | null {
  const service = response.service;
  if (!service) return null;
  return {
    ...toServiceState(service),
    about: service.about,
    url: service.url || null,
    actions: service.actions.map((action) => ({ id: action.id, label: action.label, confirm: action.confirm })),
    panels: service.views.map(toPanel),
    every: response.everySeconds,
  };
}

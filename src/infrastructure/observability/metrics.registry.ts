import { Injectable } from '@nestjs/common';

type Labels = Readonly<Record<string, string>>;

@Injectable()
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  constructor() {
    this.setGauge('outbox_lag_seconds', 0);
    this.increment('wager_dlq_total', {}, 0);
    this.increment('wager_lock_conflicts_total', {}, 0);
    this.increment('reconciliation_divergences_total', {}, 0);
  }

  increment(name: string, labels: Labels = {}, amount = 1): void {
    const key = metricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  setGauge(name: string, value: number, labels: Labels = {}): void {
    this.gauges.set(metricKey(name, labels), value);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    this.increment(`${name}_count`, labels);
    const sumKey = metricKey(`${name}_sum`, labels);
    this.counters.set(sumKey, (this.counters.get(sumKey) ?? 0) + value);
  }

  render(): string {
    const lines = [...this.counters, ...this.gauges]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key} ${formatNumber(value)}`);
    return `${lines.join('\n')}\n`;
  }
}

function metricKey(name: string, labels: Labels): string {
  const entries = Object.entries(labels).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) return name;
  const serialized = entries
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(',');
  return `${name}{${serialized}}`;
}

function escapeLabel(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n');
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

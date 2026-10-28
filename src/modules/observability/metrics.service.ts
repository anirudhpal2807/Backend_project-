import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService {
  public readonly registry: client.Registry;

  // 1. RED HTTP Metrics
  public readonly httpRequestsTotal: client.Counter<'method' | 'route' | 'status_code'>;
  public readonly httpRequestDuration: client.Histogram<'method' | 'route' | 'status_code'>;

  // 2. Resource & Infrastructure Metrics
  public readonly dbPoolActiveConnections: client.Gauge<string>;
  public readonly dbPoolIdleConnections: client.Gauge<string>;
  public readonly queueDepth: client.Gauge<'queue_name'>;
  public readonly cacheHitsTotal: client.Counter<string>;
  public readonly cacheMissesTotal: client.Counter<string>;

  // 3. Healthcare & Business Domain Metrics
  public readonly bookingsTotal: client.Counter<'status'>;
  public readonly sagaFailuresTotal: client.Counter<'reason'>;
  public readonly preventedDoubleBookingsTotal: client.Counter<string>;
  public readonly idempotentReplaysTotal: client.Counter<'endpoint'>;

  constructor() {
    this.registry = new client.Registry();
    client.collectDefaultMetrics({ register: this.registry, prefix: 'amrutam_' });

    // HTTP Request Counter
    this.httpRequestsTotal = new client.Counter({
      name: 'amrutam_http_requests_total',
      help: 'Total HTTP requests processed by method, route, and status code',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    // HTTP Request Duration Histogram
    this.httpRequestDuration = new client.Histogram({
      name: 'amrutam_http_request_duration_seconds',
      help: 'HTTP request latency distributions in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    // DB Pool Active Connections
    this.dbPoolActiveConnections = new client.Gauge({
      name: 'amrutam_db_pool_active_connections',
      help: 'Number of active PostgreSQL pool connections',
      registers: [this.registry],
    });

    // DB Pool Idle Connections
    this.dbPoolIdleConnections = new client.Gauge({
      name: 'amrutam_db_pool_idle_connections',
      help: 'Number of idle PostgreSQL pool connections',
      registers: [this.registry],
    });

    // Queue Depth
    this.queueDepth = new client.Gauge({
      name: 'amrutam_queue_depth',
      help: 'Current depth of BullMQ Redis worker queues',
      labelNames: ['queue_name'],
      registers: [this.registry],
    });

    // Cache Hits & Misses
    this.cacheHitsTotal = new client.Counter({
      name: 'amrutam_cache_hits_total',
      help: 'Total number of Redis cache hits',
      registers: [this.registry],
    });

    this.cacheMissesTotal = new client.Counter({
      name: 'amrutam_cache_misses_total',
      help: 'Total number of Redis cache misses',
      registers: [this.registry],
    });

    // Business domain metrics
    this.bookingsTotal = new client.Counter({
      name: 'amrutam_bookings_total',
      help: 'Total consultation booking flow transitions',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.sagaFailuresTotal = new client.Counter({
      name: 'amrutam_saga_failures_total',
      help: 'Total booking and payment saga compensation/failure events',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.preventedDoubleBookingsTotal = new client.Counter({
      name: 'amrutam_prevented_double_bookings_total',
      help: 'Total double-booking attempts successfully prevented by database constraints',
      registers: [this.registry],
    });

    this.idempotentReplaysTotal = new client.Counter({
      name: 'amrutam_idempotent_replays_total',
      help: 'Total requests served via idempotent response cache replay',
      labelNames: ['endpoint'],
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}

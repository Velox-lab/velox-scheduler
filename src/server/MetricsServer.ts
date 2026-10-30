import * as http from 'http';
import { SchedulerMetrics } from '../metrics/SchedulerMetrics';

/**
 * MetricsServer — exposes SchedulerMetrics over plain HTTP so an external
 * monitor (load balancer health check, Prometheus-style scraper, a human with
 * curl) can see whether the daemon is alive and what it has done.
 *
 * - `GET /health` — 200 if a cycle completed recently, 503 otherwise.
 * - `GET /metrics` — the full metrics snapshot as JSON.
 *
 * Single responsibility: serve what SchedulerMetrics already tracks. No
 * business logic, no writes back into the scheduler.
 */
export class MetricsServer {
  private server: http.Server | null = null;

  /**
   * @param metrics Metrics to report.
   * @param pollIntervalMs The scheduler's poll interval, used to judge staleness.
   * @param staleAfterCycles How many missed poll intervals before /health turns
   *   unhealthy. Default 3: tolerates one or two slow cycles without flapping,
   *   while still catching a genuinely stuck loop quickly.
   */
  constructor(
    private readonly metrics: SchedulerMetrics,
    private readonly pollIntervalMs: number,
    private readonly staleAfterCycles: number = 3
  ) {}

  /** Start listening on the given port. */
  start(port: number): void {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(port);
  }

  /** Stop listening. Resolves once the server has fully closed. */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      this.server = null;
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const path = (req.url ?? '').split('?')[0];

    if (path === '/health') {
      this.handleHealth(res);
    } else if (path === '/metrics') {
      this.handleMetrics(res);
    } else {
      this.respondJson(res, 404, { error: 'not found' });
    }
  }

  private handleHealth(res: http.ServerResponse): void {
    const lastCycleTimestamp = this.metrics.getLastCycleTimestamp();
    const healthy = this.isHealthy(lastCycleTimestamp);
    this.respondJson(res, healthy ? 200 : 503, { healthy, lastCycleTimestamp });
  }

  private handleMetrics(res: http.ServerResponse): void {
    this.respondJson(res, 200, {
      successCount: this.metrics.getTotalSuccessCount(),
      failureCount: this.metrics.getTotalFailureCount(),
      retryCount: this.metrics.getTotalRetryCount(),
      cycleCount: this.metrics.getTotalCycleCount(),
      successRate: this.metrics.getSuccessRate(),
      lastCycleTimestamp: this.metrics.getLastCycleTimestamp(),
    });
  }

  /** A cycle must have completed, and done so within staleAfterCycles poll intervals. */
  private isHealthy(lastCycleTimestamp: number | null): boolean {
    if (lastCycleTimestamp === null) return false;
    const nowMs = Date.now();
    const staleAfterMs = this.pollIntervalMs * this.staleAfterCycles;
    return nowMs - lastCycleTimestamp * 1000 <= staleAfterMs;
  }

  private respondJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

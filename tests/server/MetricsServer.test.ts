import { AddressInfo } from 'net';
import { MetricsServer } from '../../src/server/MetricsServer';
import { SchedulerMetrics } from '../../src/metrics/SchedulerMetrics';

const POLL_INTERVAL_MS = 10_000;

/** Start a MetricsServer on an OS-assigned free port and return its base URL. */
function startServer(metrics: SchedulerMetrics, staleAfterCycles?: number) {
  const server = new MetricsServer(metrics, POLL_INTERVAL_MS, staleAfterCycles);
  // Port 0 asks the OS for any free port, so parallel test runs never collide.
  server.start(0);
  // Reach into the private http.Server to read back which port it bound to.
  const address = (server as unknown as { server: { address(): AddressInfo } }).server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('MetricsServer', () => {
  let metrics: SchedulerMetrics;
  let server: MetricsServer;
  let baseUrl: string;

  afterEach(async () => {
    await server.stop();
  });

  describe('GET /health', () => {
    it('returns 503 when no cycle has ever completed', async () => {
      metrics = new SchedulerMetrics();
      ({ server, baseUrl } = startServer(metrics));

      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body).toEqual({ healthy: false, lastCycleTimestamp: null });
    });

    it('returns 200 when the last cycle was recent', async () => {
      metrics = new SchedulerMetrics();
      metrics.recordCycle(Math.floor(Date.now() / 1000));
      ({ server, baseUrl } = startServer(metrics));

      const res = await fetch(`${baseUrl}/health`);
      const body = (await res.json()) as { healthy: boolean };

      expect(res.status).toBe(200);
      expect(body.healthy).toBe(true);
    });

    it('returns 503 once the last cycle is older than staleAfterCycles poll intervals', async () => {
      metrics = new SchedulerMetrics();
      const staleTimestamp = Math.floor(Date.now() / 1000) - 1000; // 1000s ago
      metrics.recordCycle(staleTimestamp);
      // staleAfterCycles=1 means anything older than one 10s poll interval is stale
      ({ server, baseUrl } = startServer(metrics, 1));

      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body).toEqual({ healthy: false, lastCycleTimestamp: staleTimestamp });
    });
  });

  describe('GET /metrics', () => {
    it('returns the full metrics snapshot', async () => {
      metrics = new SchedulerMetrics();
      metrics.recordSuccess();
      metrics.recordSuccess();
      metrics.recordFailure();
      metrics.recordRetry();
      metrics.recordCycle(1_700_000_000);
      ({ server, baseUrl } = startServer(metrics));

      const res = await fetch(`${baseUrl}/metrics`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        successCount: 2,
        failureCount: 1,
        retryCount: 1,
        cycleCount: 1,
        successRate: 2 / 3,
        lastCycleTimestamp: 1_700_000_000,
      });
    });

    it('returns zeros before anything has happened', async () => {
      metrics = new SchedulerMetrics();
      ({ server, baseUrl } = startServer(metrics));

      const res = await fetch(`${baseUrl}/metrics`);
      const body = await res.json();

      expect(body).toEqual({
        successCount: 0,
        failureCount: 0,
        retryCount: 0,
        cycleCount: 0,
        successRate: 0,
        lastCycleTimestamp: null,
      });
    });
  });

  describe('other routes', () => {
    it('returns 404 for an unknown path', async () => {
      metrics = new SchedulerMetrics();
      ({ server, baseUrl } = startServer(metrics));

      const res = await fetch(`${baseUrl}/nope`);

      expect(res.status).toBe(404);
    });
  });

  describe('stop', () => {
    it('refuses new connections once stopped', async () => {
      metrics = new SchedulerMetrics();
      ({ server, baseUrl } = startServer(metrics));

      await server.stop();

      await expect(fetch(`${baseUrl}/health`)).rejects.toThrow();
    });

    it('resolves cleanly if called before start', async () => {
      server = new MetricsServer(new SchedulerMetrics(), POLL_INTERVAL_MS);
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });
});

import * as http from 'http';
import * as https from 'https';

export type AlertEvent = 'execution_failed' | 'cycle_error';

export interface AlertPayload {
  event: AlertEvent;
  message: string;
  scheduleId?: string;
  timestamp: number;
}

/** Delivers an alert payload to a webhook. Injected so tests never make a real network call. */
export interface AlertTransport {
  send(webhookUrl: string, payload: AlertPayload): Promise<void>;
}

/**
 * HttpAlertTransport — POSTs the payload as JSON to the configured webhook.
 *
 * Includes a top-level `text` field alongside the structured fields so this
 * same payload also renders as a plain message on Slack- and Discord-style
 * incoming webhooks, which only look at `text`.
 */
export class HttpAlertTransport implements AlertTransport {
  send(webhookUrl: string, payload: AlertPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ text: payload.message, ...payload });
      const url = new URL(webhookUrl);
      const client = url.protocol === 'http:' ? http : https;

      const req = client.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        }
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

/**
 * AlertNotifier — tells an external webhook about events an operator should
 * know about without staring at logs: a payment that failed for good, or a
 * whole cycle throwing.
 *
 * Single responsibility: format and dispatch alerts. Never throws back into
 * the scheduler — a broken webhook must not take down payment execution, so
 * transport failures go to `onTransportError` instead of rejecting.
 */
export class AlertNotifier {
  constructor(
    private readonly webhookUrl: string | null,
    private readonly transport: AlertTransport = new HttpAlertTransport(),
    private readonly onTransportError: (error: Error) => void = () => {}
  ) {}

  /** Notify that a scheduled payment ultimately failed (retries exhausted or non-retryable). */
  async notifyExecutionFailure(scheduleId: string, message: string, timestamp: number): Promise<void> {
    await this.send({ event: 'execution_failed', scheduleId, message, timestamp });
  }

  /** Notify that an entire poll cycle threw before it could execute anything. */
  async notifyCycleError(message: string, timestamp: number): Promise<void> {
    await this.send({ event: 'cycle_error', message, timestamp });
  }

  private async send(payload: AlertPayload): Promise<void> {
    if (!this.webhookUrl) return;
    try {
      await this.transport.send(this.webhookUrl, payload);
    } catch (err) {
      this.onTransportError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

import { AlertNotifier, AlertPayload, AlertTransport, HttpAlertTransport } from '../../src/alerting/AlertNotifier';
import * as http from 'http';
import { AddressInfo } from 'net';

describe('AlertNotifier', () => {
  function makeTransport(): jest.Mocked<AlertTransport> {
    return { send: jest.fn().mockResolvedValue(undefined) };
  }

  it('does nothing when no webhook URL is configured', async () => {
    const transport = makeTransport();
    const notifier = new AlertNotifier(null, transport);

    await notifier.notifyExecutionFailure('s1', 'boom', 123);

    expect(transport.send).not.toHaveBeenCalled();
  });

  it('sends an execution_failed payload with the configured webhook URL', async () => {
    const transport = makeTransport();
    const notifier = new AlertNotifier('https://hooks.example.com/alert', transport);

    await notifier.notifyExecutionFailure('s1', 'boom', 123);

    expect(transport.send).toHaveBeenCalledWith('https://hooks.example.com/alert', {
      event: 'execution_failed',
      scheduleId: 's1',
      message: 'boom',
      timestamp: 123,
    });
  });

  it('sends a cycle_error payload with no scheduleId', async () => {
    const transport = makeTransport();
    const notifier = new AlertNotifier('https://hooks.example.com/alert', transport);

    await notifier.notifyCycleError('cycle blew up', 456);

    expect(transport.send).toHaveBeenCalledWith('https://hooks.example.com/alert', {
      event: 'cycle_error',
      message: 'cycle blew up',
      timestamp: 456,
    });
  });

  it('swallows a transport failure and reports it via onTransportError instead of throwing', async () => {
    const transport: AlertTransport = { send: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const onTransportError = jest.fn();
    const notifier = new AlertNotifier('https://hooks.example.com/alert', transport, onTransportError);

    await expect(notifier.notifyExecutionFailure('s1', 'boom', 123)).resolves.toBeUndefined();

    expect(onTransportError).toHaveBeenCalledWith(new Error('ECONNREFUSED'));
  });

  it('wraps a non-Error transport rejection before reporting it', async () => {
    const transport: AlertTransport = { send: jest.fn().mockRejectedValue('not an Error') };
    const onTransportError = jest.fn();
    const notifier = new AlertNotifier('https://hooks.example.com/alert', transport, onTransportError);

    await notifier.notifyExecutionFailure('s1', 'boom', 123);

    expect(onTransportError).toHaveBeenCalledWith(new Error('not an Error'));
  });
});

describe('HttpAlertTransport', () => {
  it('POSTs the payload as JSON, with a text field for Slack/Discord-style webhooks', async () => {
    const received: { body: string; method?: string; contentType?: string } = { body: '' };
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        received.body = data;
        received.method = req.method;
        received.contentType = req.headers['content-type'];
        res.writeHead(200);
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const transport = new HttpAlertTransport();
      const payload: AlertPayload = {
        event: 'execution_failed',
        scheduleId: 's1',
        message: 'boom',
        timestamp: 123,
      };
      await transport.send(`http://127.0.0.1:${port}/webhook`, payload);

      expect(received.method).toBe('POST');
      expect(received.contentType).toBe('application/json');
      expect(JSON.parse(received.body)).toEqual({ text: 'boom', ...payload });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects when the server is unreachable', async () => {
    const transport = new HttpAlertTransport();
    await expect(
      transport.send('http://127.0.0.1:1', {
        event: 'cycle_error',
        message: 'boom',
        timestamp: 1,
      })
    ).rejects.toBeTruthy();
  });
});

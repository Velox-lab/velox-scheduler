import { ExecutionQueue } from '../../src/queue/ExecutionQueue';
import { Schedule } from '../../src/types';

function makeSchedule(id: string, nextPaymentTime: number): Schedule {
  return {
    scheduleId: id,
    scheduleType: 'recurring',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT',
    token: 'USDC',
    nextPaymentTime,
    status: 'active',
  };
}

describe('ExecutionQueue', () => {
  let queue: ExecutionQueue;

  beforeEach(() => {
    queue = new ExecutionQueue();
  });

  describe('enqueue', () => {
    it('increases the queue size by one', () => {
      queue.enqueue(makeSchedule('s1', 1000));
      expect(queue.size()).toBe(1);
    });

    it('orders schedules by nextPaymentTime ascending', () => {
      queue.enqueue(makeSchedule('s2', 2000));
      queue.enqueue(makeSchedule('s1', 1000));
      queue.enqueue(makeSchedule('s3', 3000));

      expect(queue.peekNext()!.scheduleId).toBe('s1');
    });
  });

  describe('dequeueDue', () => {
    it('returns schedules where nextPaymentTime <= currentTime', () => {
      queue.enqueue(makeSchedule('s1', 1000));
      queue.enqueue(makeSchedule('s2', 1500));
      queue.enqueue(makeSchedule('s3', 2000));

      const due = queue.dequeueDue(1500);
      expect(due).toHaveLength(2);
      expect(due.map((s) => s.scheduleId)).toEqual(['s1', 's2']);
    });

    it('leaves schedules not yet due in the queue', () => {
      queue.enqueue(makeSchedule('s1', 1000));
      queue.enqueue(makeSchedule('s2', 2000));

      queue.dequeueDue(1000);
      expect(queue.size()).toBe(1);
      expect(queue.peekNext()!.scheduleId).toBe('s2');
    });

    it('returns empty array when no schedules are due', () => {
      queue.enqueue(makeSchedule('s1', 5000));
      const due = queue.dequeueDue(1000);
      expect(due).toHaveLength(0);
    });

    it('returns empty array when queue is empty', () => {
      const due = queue.dequeueDue(9999);
      expect(due).toHaveLength(0);
    });
  });

  describe('peekNext', () => {
    it('returns null when queue is empty', () => {
      expect(queue.peekNext()).toBeNull();
    });

    it('returns the earliest schedule without removing it', () => {
      queue.enqueue(makeSchedule('s1', 1000));
      queue.enqueue(makeSchedule('s2', 500));

      expect(queue.peekNext()!.scheduleId).toBe('s2');
      expect(queue.size()).toBe(2); // not removed
    });
  });

  describe('clear', () => {
    it('empties the queue', () => {
      queue.enqueue(makeSchedule('s1', 1000));
      queue.enqueue(makeSchedule('s2', 2000));
      queue.clear();
      expect(queue.size()).toBe(0);
    });

    it('peekNext returns null after clear', () => {
      queue.enqueue(makeSchedule('s1', 1000));
      queue.clear();
      expect(queue.peekNext()).toBeNull();
    });
  });
});

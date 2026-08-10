import { Schedule } from '../types';

/**
 * ExecutionQueue — min-heap priority queue of scheduled payments.
 *
 * Schedules are ordered by nextPaymentTime (earliest first).
 * This is a pure data structure with no network or logging dependencies.
 */
export class ExecutionQueue {
  private queue: Schedule[] = [];

  /** Add a schedule to the queue, maintaining heap order. */
  enqueue(schedule: Schedule): void {
    this.queue.push(schedule);
    this.queue.sort((a, b) => a.nextPaymentTime - b.nextPaymentTime);
  }

  /** Remove and return all schedules due at or before currentTime. */
  dequeueDue(currentTime: number): Schedule[] {
    const due: Schedule[] = [];

    while (this.queue.length > 0 && this.queue[0].nextPaymentTime <= currentTime) {
      due.push(this.queue.shift()!);
    }

    return due;
  }

  /** Return the next schedule without removing it. Returns null if empty. */
  peekNext(): Schedule | null {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  /** Return the current number of items in the queue. */
  size(): number {
    return this.queue.length;
  }

  /** Clear all items from the queue. Used on daemon restart. */
  clear(): void {
    this.queue = [];
  }
}

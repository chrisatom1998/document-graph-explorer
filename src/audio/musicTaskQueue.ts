type Priority = 'preview' | 'analysis';
interface Task {
  priority: Priority;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort: () => void;
}

/** Bound decoder/model memory, and finish waiting previews before starting deeper work. */
export class MusicTaskQueue {
  private pending: Task[] = [];
  private active = 0;
  private activePreviews = 0;

  constructor(private readonly concurrency: number) {}

  schedule<T>(priority: Priority, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const task: Task = {
        priority, run, resolve: value => resolve(value as T), reject, signal,
        abort: () => {
          const index = this.pending.indexOf(task);
          if (index < 0) return;
          this.pending.splice(index, 1);
          signal?.removeEventListener('abort', task.abort);
          reject(signal?.reason);
          this.pump();
        },
      };
      signal?.addEventListener('abort', task.abort, { once: true });
      this.pending.push(task);
      this.pump();
    });
  }

  private pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const preview = this.pending.findIndex(task => task.priority === 'preview');
      if (preview < 0 && this.activePreviews) return;
      const task = this.pending.splice(preview < 0 ? 0 : preview, 1)[0];
      task.signal?.removeEventListener('abort', task.abort);
      this.active++;
      if (task.priority === 'preview') this.activePreviews++;
      void Promise.resolve().then(() => {
        task.signal?.throwIfAborted();
        return task.run();
      }).then(task.resolve, task.reject).finally(() => {
        this.active--;
        if (task.priority === 'preview') this.activePreviews--;
        this.pump();
      });
    }
  }
}

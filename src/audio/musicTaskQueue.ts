type Priority = 'preview' | 'analysis';
interface Task {
  priority: Priority;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort: () => void;
}

/** Bound decoder/model memory. By default, finish previews before deeper work. */
export class MusicTaskQueue {
  private pending: Task[] = [];
  private active = 0;
  private activePreviews = 0;

  constructor(
    private readonly concurrency: number,
    private readonly pipelineAnalysis: () => boolean = () => false,
  ) {}

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
      // Keep one deeper analysis moving while the other slot previews the folder.
      // Otherwise a large import leaves AST/CLAP idle until every preview finishes.
      // Once analysis owns a slot, previews retain priority for the remaining one.
      const pipeline = this.concurrency > 1 && this.pipelineAnalysis();
      const analysis = pipeline && this.active === this.activePreviews
        ? this.pending.findIndex(task => task.priority === 'analysis') : -1;
      if (!pipeline && preview < 0 && this.activePreviews) return;
      const index = analysis >= 0 ? analysis : preview >= 0 ? preview : 0;
      const task = this.pending.splice(index, 1)[0];
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

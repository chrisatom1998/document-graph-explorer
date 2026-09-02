/**
 * Protocol contract for the dedicated pdf worker's main-thread client:
 * requests are posted with transferred bytes, OCR progress streams to the
 * caller without settling the request, and every infrastructure failure
 * (worker-reported error, crash, watchdog timeout, abort) discards the
 * worker so the next request respawns a clean one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PdfWorkerClient,
  PdfWorkerFailure,
  type PdfWorkerLike,
  type PdfWorkerParseRequest,
  type PdfWorkerResponse,
} from './pdfWorkerClient';
import type { PdfParseResult } from './pdfEngine';

class FakePdfWorker implements PdfWorkerLike {
  messages: PdfWorkerParseRequest[] = [];
  transfers: (Transferable[] | undefined)[] = [];
  onmessage: ((ev: MessageEvent<PdfWorkerResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  terminated = false;
  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push(message as PdfWorkerParseRequest);
    this.transfers.push(transfer);
  }
  terminate(): void {
    this.terminated = true;
  }
  respond(msg: PdfWorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<PdfWorkerResponse>);
  }
  crash(): void {
    this.onerror?.({ message: 'boom' } as ErrorEvent);
  }
}

function makeResult(): PdfParseResult {
  return { title: 'Doc', text: 'body text', status: 'ok', links: [] };
}

describe('PdfWorkerClient protocol', () => {
  let workers: FakePdfWorker[];
  let client: PdfWorkerClient;

  beforeEach(() => {
    workers = [];
    client = new PdfWorkerClient({
      workerFactory: () => {
        const worker = new FakePdfWorker();
        workers.push(worker);
        return worker;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts the request with transferred bytes and resolves on pdf:done', async () => {
    const bytes = new ArrayBuffer(8);
    const parsed = client.parse(bytes, 'a.pdf', { ocrMaxPages: 20, ocrLanguage: 'eng' });

    expect(workers).toHaveLength(1);
    const [msg] = workers[0].messages;
    expect(msg).toMatchObject({
      type: 'parsePdf',
      name: 'a.pdf',
      ocrMaxPages: 20,
      ocrLanguage: 'eng',
    });
    expect(msg.bytes).toBe(bytes);
    expect(workers[0].transfers[0]).toEqual([bytes]);

    workers[0].respond({ type: 'pdf:done', requestId: msg.requestId, result: makeResult() });
    await expect(parsed).resolves.toMatchObject({ title: 'Doc', status: 'ok' });
  });

  it('streams pdf:ocr-progress to the callback without settling the request', async () => {
    const onOcrProgress = vi.fn();
    const parsed = client.parse(new ArrayBuffer(4), 'scan.pdf', {
      ocrMaxPages: 10,
      ocrLanguage: 'eng',
      onOcrProgress,
    });
    const { requestId } = workers[0].messages[0];

    workers[0].respond({ type: 'pdf:ocr-progress', requestId, completed: 0, total: 3 });
    workers[0].respond({ type: 'pdf:ocr-progress', requestId, completed: 1, total: 3 });
    expect(onOcrProgress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
    ]);

    workers[0].respond({ type: 'pdf:done', requestId, result: makeResult() });
    await expect(parsed).resolves.toMatchObject({ status: 'ok' });
  });

  it('rejects a pdf:error response as a worker infrastructure failure', async () => {
    const parsed = client.parse(new ArrayBuffer(4), 'a.pdf', {
      ocrMaxPages: 20,
      ocrLanguage: 'eng',
    });
    const { requestId } = workers[0].messages[0];
    workers[0].respond({ type: 'pdf:error', requestId, message: 'engine import failed' });
    await expect(parsed).rejects.toBeInstanceOf(PdfWorkerFailure);
  });

  it('a crash rejects every pending request; the next parse respawns', async () => {
    const first = client.parse(new ArrayBuffer(4), 'a.pdf', {
      ocrMaxPages: 20,
      ocrLanguage: 'eng',
    });
    const second = client.parse(new ArrayBuffer(4), 'b.pdf', {
      ocrMaxPages: 20,
      ocrLanguage: 'eng',
    });
    workers[0].crash();
    await expect(first).rejects.toBeInstanceOf(PdfWorkerFailure);
    await expect(second).rejects.toBeInstanceOf(PdfWorkerFailure);
    expect(workers[0].terminated).toBe(true);

    const third = client.parse(new ArrayBuffer(4), 'c.pdf', {
      ocrMaxPages: 20,
      ocrLanguage: 'eng',
    });
    expect(workers).toHaveLength(2);
    const { requestId } = workers[1].messages[0];
    workers[1].respond({ type: 'pdf:done', requestId, result: makeResult() });
    await expect(third).resolves.toMatchObject({ status: 'ok' });
  });

  it('abort tears the worker down and rejects with the abort reason', async () => {
    const controller = new AbortController();
    const parsed = client.parse(new ArrayBuffer(4), 'a.pdf', {
      ocrMaxPages: 20,
      ocrLanguage: 'eng',
      signal: controller.signal,
    });
    controller.abort();
    await expect(parsed).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].terminated).toBe(true);

    void client
      .parse(new ArrayBuffer(4), 'b.pdf', { ocrMaxPages: 20, ocrLanguage: 'eng' })
      .catch(() => undefined);
    expect(workers).toHaveLength(2);
  });

  it('a request made with an already-aborted signal rejects without spawning a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.parse(new ArrayBuffer(4), 'a.pdf', {
        ocrMaxPages: 20,
        ocrLanguage: 'eng',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers).toHaveLength(0);
  });

  it('the outer watchdog discards a wedged worker', async () => {
    vi.useFakeTimers();
    const parsed = client.parse(new ArrayBuffer(4), 'a.pdf', {
      ocrMaxPages: 20,
      ocrLanguage: 'eng',
    });
    // attach the handler before the clock advances so the rejection is
    // observed the moment it happens (no unhandled-rejection window)
    const timesOut = expect(parsed).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(390_001);
    await timesOut;
    expect(workers[0].terminated).toBe(true);
  });
});

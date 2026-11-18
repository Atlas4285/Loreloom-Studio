export type Disposer = () => void | Promise<void>;
export class Lifecycle {
  private readonly controller = new AbortController();
  private readonly disposers: Disposer[] = [];
  private disposal?: Promise<void>;
  readonly signal = this.controller.signal;

  assertActive(): void {
    this.signal.throwIfAborted();
  }
  cancel(): void {
    this.controller.abort(new Error("Runtime scope has ended."));
  }
  waitFor<T>(task: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        reject(this.signal.reason);
      };
      this.signal.addEventListener("abort", abort, { once: true });
      task.then(
        (value) => {
          this.signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          this.signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
      if (this.signal.aborted) {
        this.signal.removeEventListener("abort", abort);
        abort();
      }
    });
  }
  defer(dispose: Disposer): () => void {
    if (this.signal.aborted) {
      void Promise.resolve().then(dispose).catch(console.error);
      return () => {};
    }
    this.disposers.push(dispose);
    return () => {
      const index = this.disposers.indexOf(dispose);
      if (index >= 0) this.disposers.splice(index, 1);
    };
  }
  listen(
    target: EventTarget,
    event: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    this.assertActive();
    target.addEventListener(event, listener, options);
    this.defer(() => target.removeEventListener(event, listener, options));
  }
  observe(
    observer: MutationObserver,
    target: Node,
    options: MutationObserverInit,
  ): void {
    this.assertActive();
    observer.observe(target, options);
    this.defer(() => observer.disconnect());
  }
  interval(callback: () => void, milliseconds: number): void {
    this.assertActive();
    const id = setInterval(callback, milliseconds);
    this.defer(() => clearInterval(id));
  }
  timeout(callback: () => void, milliseconds: number): void {
    this.assertActive();
    const id = setTimeout(callback, milliseconds);
    this.defer(() => clearTimeout(id));
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.cancel();
    this.disposal = (async () => {
      const errors: unknown[] = [];
      for (const dispose of this.disposers.splice(0).reverse()) {
        try {
          await dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        console.error("Loreloom cleanup failed.", new AggregateError(errors));
    })();
    return this.disposal;
  }
}

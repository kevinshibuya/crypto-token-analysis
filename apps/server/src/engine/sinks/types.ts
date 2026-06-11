export interface Sink {
  readonly name: string;
  /** Must throw on delivery failure — the dispatcher owns retries. */
  send(text: string): Promise<void>;
}

import '@testing-library/jest-dom/vitest';

class StubEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener(): void {}
  close(): void {}
}
if (!(globalThis as Record<string, unknown>).EventSource) {
  (globalThis as Record<string, unknown>).EventSource = StubEventSource;
}

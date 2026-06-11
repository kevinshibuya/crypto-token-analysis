import type { Sink } from './types';

export class DiscordSink implements Sink {
  readonly name = 'discord';
  private f: typeof fetch;
  constructor(private opts: { webhookUrl: string; fetchImpl?: typeof fetch }) {
    this.f = opts.fetchImpl ?? fetch;
  }
  async send(text: string): Promise<void> {
    const res = await this.f(this.opts.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.slice(0, 2000) }),
    });
    if (!res.ok) throw new Error(`discord webhook failed: ${res.status}`);
  }
}

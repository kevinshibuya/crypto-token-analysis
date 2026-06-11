import type { Sink } from './types';

export class TelegramSink implements Sink {
  readonly name = 'telegram';
  private f: typeof fetch;
  constructor(private opts: { token: string; chatId: string; fetchImpl?: typeof fetch }) {
    this.f = opts.fetchImpl ?? fetch;
  }
  async send(text: string): Promise<void> {
    const res = await this.f(`https://api.telegram.org/bot${this.opts.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.opts.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`telegram sendMessage failed: ${res.status}`);
  }
}

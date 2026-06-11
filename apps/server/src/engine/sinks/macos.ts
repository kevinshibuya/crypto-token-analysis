import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Sink } from './types';

const execFileAsync = promisify(execFile);
type ExecImpl = (cmd: string, args: string[]) => Promise<unknown>;

export class MacosSink implements Sink {
  readonly name = 'macos';
  private exec: ExecImpl;
  constructor(opts: { execImpl?: ExecImpl } = {}) {
    this.exec = opts.execImpl ?? ((cmd, args) => execFileAsync(cmd, args));
  }
  async send(text: string): Promise<void> {
    try {
      await this.exec('terminal-notifier', ['-title', 'CTA Engine', '-message', text]);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await this.exec('osascript', ['-e', `display notification "${safe}" with title "CTA Engine"`]);
    }
  }
}

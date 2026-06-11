import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { openDb } from './cache/db';
import { CandleStore } from './cache/candleStore';
import { MarketStore } from './cache/marketStore';
import { BacktestStore } from './cache/backtestStore';
import { AlertStore } from './cache/alertStore';
import { MaSelectionStore } from './cache/maSelectionStore';
import { HyperliquidClient } from './hyperliquid/client';
import { RateLimiter } from './hyperliquid/rateLimiter';
import { CandleService } from './services/candleService';
import { MarketsService } from './services/marketsService';
import { AnalysisService } from './services/analysisService';
import { BacktestService } from './services/backtestService';
import { SignalsService } from './services/signalsService';
import { CACHE_DB_PATH, HYPERLIQUID_BASE_URL, RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SEC } from './config';
import { Engine } from './engine/engine';
import { Watchdog } from './engine/watchdog';
import { LiveFeed } from './engine/liveFeed';
import { loadEngineConfig } from './engine/config';
import { createEngineLogger } from './engine/logger';
import { SinkDispatcher } from './engine/sinks/dispatcher';
import { TelegramSink } from './engine/sinks/telegram';
import { DiscordSink } from './engine/sinks/discord';
import { MacosSink } from './engine/sinks/macos';
import type { Sink } from './engine/sinks/types';
import type { HealthSnapshot } from './engine/metrics';

const db = openDb(CACHE_DB_PATH);
const client = new HyperliquidClient({ baseUrl: HYPERLIQUID_BASE_URL });
const rateLimiter = new RateLimiter(RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SEC);
const candleStore = new CandleStore(db);
const candleService = new CandleService({ client, store: candleStore, rateLimiter });
const marketsService = new MarketsService({ client, store: new MarketStore(db), rateLimiter });
const analysisService = new AnalysisService(candleService);
const backtestService = new BacktestService(candleService, new BacktestStore(db));
const signalsService = new SignalsService(candleService, backtestService);

let engineStatus: (() => HealthSnapshot) | undefined;
let optimizeMa: ((coins?: string[]) => Promise<unknown>) | undefined;
let live: { feed: LiveFeed; snapshot: () => unknown } | undefined;
if (process.env.ENGINE_ENABLED === '1') {
  const engineLog = createEngineLogger(process.env.ENGINE_LOG_DIR ?? 'data/logs');
  const engineConfig = loadEngineConfig(process.env.ENGINE_CONFIG ?? 'engine.json');
  const sinks: Sink[] = [];
  if (engineConfig.sinks.telegram) sinks.push(new TelegramSink({ token: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID! }));
  if (engineConfig.sinks.discord) sinks.push(new DiscordSink({ webhookUrl: process.env.DISCORD_WEBHOOK_URL! }));
  if (engineConfig.sinks.macos) sinks.push(new MacosSink());
  const dispatcher = new SinkDispatcher({ sinks, log: engineLog });
  const alertStore = new AlertStore(db);
  const maSelectionStore = new MaSelectionStore(db);
  const engine = new Engine({
    config: engineConfig, log: engineLog,
    candleService, marketsService,
    candleStore, alertStore, maSelectionStore,
    dispatch: (text) => dispatcher.dispatch(text),
  });
  const watchdog = new Watchdog({
    wsLastMessageAt: () => engine.wsLastMessageAt, wsDeadExitMs: engineConfig.wsDeadExitMs, log: engineLog,
  });
  engine.start()
    .then(() => { watchdog.start(); engineLog.info('engine started'); })
    .catch((err) => { engineLog.fatal({ err: String(err) }, 'engine failed to start'); process.exit(1); });
  engineStatus = () => engine.status();
  optimizeMa = (coins) => engine.runMaOptimization(coins);

  const feed = new LiveFeed({ log: engineLog });
  engine.events.on('scan', (e) => feed.broadcast('scan', e));
  engine.events.on('alert', (r) => feed.broadcast('alert', r));
  engine.events.on('health', (h) => feed.broadcast('health', h));
  live = { feed, snapshot: () => ({ ...engine.liveSnapshot(), alerts: alertStore.recent(50) }) };
}

const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
const app = buildApp({ marketsService, analysisService, backtestService, signalsService, engineStatus, optimizeMa, live, webDistDir });
const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`server listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

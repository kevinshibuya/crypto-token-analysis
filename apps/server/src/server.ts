import { buildApp } from './app';
import { openDb } from './cache/db';
import { CandleStore } from './cache/candleStore';
import { MarketStore } from './cache/marketStore';
import { BacktestStore } from './cache/backtestStore';
import { HyperliquidClient } from './hyperliquid/client';
import { RateLimiter } from './hyperliquid/rateLimiter';
import { CandleService } from './services/candleService';
import { MarketsService } from './services/marketsService';
import { AnalysisService } from './services/analysisService';
import { BacktestService } from './services/backtestService';
import { CACHE_DB_PATH, HYPERLIQUID_BASE_URL, RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SEC } from './config';

const db = openDb(CACHE_DB_PATH);
const client = new HyperliquidClient({ baseUrl: HYPERLIQUID_BASE_URL });
const rateLimiter = new RateLimiter(RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SEC);
const candleService = new CandleService({ client, store: new CandleStore(db), rateLimiter });
const marketsService = new MarketsService({ client, store: new MarketStore(db), rateLimiter });
const analysisService = new AnalysisService(candleService);
const backtestService = new BacktestService(candleService, new BacktestStore(db));

const app = buildApp({ marketsService, analysisService, backtestService });
const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`server listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

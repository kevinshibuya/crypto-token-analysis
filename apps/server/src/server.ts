import { buildApp } from './app';

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`server listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

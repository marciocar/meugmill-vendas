import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Encerrando o servidor');
    const timer = setTimeout(() => {
      app.log.error('Tempo limite de encerramento excedido; forçando saída');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'Erro ao encerrar o servidor');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err: unknown) => {
  console.error('Falha ao iniciar a API:', err instanceof Error ? err.message : err);
  process.exit(1);
});

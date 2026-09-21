import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function SeedDatabase(): Promise<void> {
  const Application = await NestFactory.createApplicationContext(AppModule);
  await Application.close();
}

void SeedDatabase().catch((Error: unknown) => {
  console.error('Official database seed failed', Error);
  process.exitCode = 1;
});

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DatabaseSeedService } from './core/database/database-seed.service';

async function SeedDatabase(): Promise<void> {
  const Application = await NestFactory.createApplicationContext(AppModule);

  try {
    await Application.get(DatabaseSeedService).Seed();
  } finally {
    await Application.close();
  }
}

void SeedDatabase().catch((Error: unknown) => {
  console.error('Official database seed failed', Error);
  process.exitCode = 1;
});

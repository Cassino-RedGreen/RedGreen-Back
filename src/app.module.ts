import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { SlotMachineModule } from './modules/slot-machine/slot-machine.module';
import { SlotSessionModule } from './modules/slot-machine/sessions/slot-session.module';
import { GambitModule } from './modules/gambit/gambit.module';
import { GambitSessionModule } from './modules/gambit/sessions/gambit-session.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { DatabaseSeedService } from './core/database/database-seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (Config: ConfigService) => {
        const host = Config.get<string>('POSTGRES_HOST', 'localhost');
        const port = parseInt(Config.get<string>('POSTGRES_PORT', '5433'), 10);
        const username = Config.get<string>('POSTGRES_USER');
        const password = Config.get<string>('POSTGRES_PASSWORD');
        const database = Config.get<string>('POSTGRES_DB');
        const sslEnabled =
          Config.get<string>('POSTGRES_SSL', 'false') === 'true';

        if (!username || !password || !database) {
          throw new Error(
            'Missing required database configuration variables (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)'
          );
        }

        console.log(
          `Connecting to PostgreSQL: postgres://${username}:****@${host}:${port}/${database}`
        );

        return {
          type: 'postgres',
          host,
          port,
          username,
          password,
          database,
          autoLoadEntities: true,
          synchronize: true,
          logging: true,
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
          extra: {
            max: 5,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
          },
        };
      },
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    AuthModule,
    SlotMachineModule,
    SlotSessionModule,
    GambitModule,
    GambitSessionModule,
    SessionsModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseSeedService],
})
export class AppModule {}

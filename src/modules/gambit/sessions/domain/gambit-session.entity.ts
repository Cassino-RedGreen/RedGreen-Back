import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GambitTable } from '../../domain/gambit-table.entity';
import { User } from '../../../auth/domain/user.entity';
import type { CurrentGridSnapshot } from './types/gambit-session.types';
import { GambitCard } from './types/gambit-session.types';
import { CurrentGridSnapshotDto } from './dto/current-grid-snapshot.dto';

export enum GambitSessionStatus {
  InProgress = 'InProgress',
  Finished = 'Finished',
  CashedOut = 'CashedOut',
}

@Entity({ name: 'GambitSession' })
export class GambitSession {
  @ApiProperty({
    example: 1,
    description: 'Unique identifier for the gambit session',
  })
  @PrimaryGeneratedColumn()
  GambitSessionId: number;

  @ApiProperty({
    example: 'c14e1f5a-09b2-4f4e-97b2-19b1b2c0a0d1',
    description: 'UUID of the user who owns this session',
  })
  @Column('uuid')
  UserId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'UserId' })
  User: User;

  @ApiProperty({
    example: 1,
    description: 'ID of the gambit table used in this session',
  })
  @Column({ type: 'int' })
  GambitTableId: number;

  @ApiProperty({
    type: () => GambitTable,
    description: 'The gambit table associated with this session',
  })
  @ManyToOne(() => GambitTable, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'GambitTableId' })
  GambitTable: GambitTable;

  @ApiProperty({
    example: 10,
    description: 'Number of cards purchased for this session',
  })
  @Column({ type: 'int' })
  CardsPurchased: number;

  @ApiProperty({
    example: 0,
    description:
      'Number of manual card flips performed by the player. Used to determine when the next PendingEvent triggers.',
  })
  @Column({ type: 'int', default: 0 })
  ManualFlipsCount: number;

  @ApiProperty({
    example: 7,
    description:
      'The exact flip number at which the first event will trigger. Randomly determined between 5 and 9 at session creation.',
  })
  @Column({ type: 'int' })
  FirstEventFlip: number;

  @ApiProperty({
    example: 14,
    description:
      'The exact flip number at which the second event will trigger. Randomly determined between 13 and 17 at session creation.',
  })
  @Column({ type: 'int' })
  SecondEventFlip: number;

  @ApiProperty({
    example: 10,
    description:
      'Number of burns(plays) available for the player. Starts equal to CardsPurchased and can be modified by card effects during the session.',
  })
  @Column({ type: 'int' })
  BurnSlotsAvailable: number;

  @ApiProperty({
    type: () => CurrentGridSnapshotDto,
    nullable: true,
    description:
      'Current state of the game grid. The Unrevealed array is stripped before any response reaches the client.',
  })
  @Column({ type: 'jsonb', nullable: true })
  CurrentGridSnapshot: CurrentGridSnapshot | null;

  @ApiProperty({
    example: 0,
    description:
      'Raw points accumulated during the session. Can be negative, zero, or positive. The final reward in chips is calculated at session end by applying the table multipliers to this value.',
  })
  @Column({ type: 'int', default: 0 })
  AccumulatedPoints: number;

  @ApiProperty({
    enum: GambitSessionStatus,
    enumName: 'GambitSessionStatus',
    description: 'Status of the gambit session',
  })
  @Column({ type: 'enum', enum: GambitSessionStatus })
  Status: GambitSessionStatus;

  @ApiProperty({
    example: null,
    description: 'Final result of the session in chips',
    nullable: true,
  })
  @Column({ type: 'int', nullable: true })
  Result: number | null;

  @ApiProperty({
    enum: GambitCard,
    enumName: 'GambitCard',
    nullable: true,
    description: 'Effect card to be applied on the next scoring card revealed',
  })
  @Column({ type: 'varchar', nullable: true, default: null })
  NextEffect: GambitCard | null;

  @ApiProperty({ description: 'Session creation timestamp' })
  @Column({ type: 'timestamp', default: () => 'NOW()' })
  CreatedAt: Date;

  @ApiProperty({ description: 'Session last update timestamp' })
  @Column({ type: 'timestamp', default: () => 'NOW()' })
  UpdatedAt: Date;
}

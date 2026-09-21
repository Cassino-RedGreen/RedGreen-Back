import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { SlotSession, SlotSessionStatus } from '../domain/slot-session.entity';
import { SlotMachine } from '../../domain/slot-machine.entity';
import { User } from '../../../auth/domain/user.entity';
import { CreateSlotSessionDto } from '../domain/dto/create-slot-session.dto';
import { UpdateSlotSessionDto } from '../domain/dto/update-slot-session.dto';
import { SlotSymbol } from '../domain/enums/slot-symbol.enum';
import type { SpinReelResult } from '../domain/types/slot-session.types';
import { AuthService } from '../../../auth/application/auth.service';
import { SessionRegistryService } from '../../../sessions/application/session-registry.service';
import { GameType } from '../../../sessions/domain/enums/game-type.enum';
import { ActiveSession } from '../../../sessions/domain/active-session.entity';

@Injectable()
export class SlotSessionService {
  constructor(
    @InjectRepository(SlotSession)
    private readonly slotSessionRepo: Repository<SlotSession>,
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly sessionRegistryService: SessionRegistryService
  ) {}

  async create(
    slotMachineId: number,
    dto: CreateSlotSessionDto,
    userId: string
  ): Promise<{ session: SlotSession; currentBalance: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      const FoundMachine = await manager.findOne(SlotMachine, {
        where: { SlotMachineId: slotMachineId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!FoundMachine) {
        throw new NotFoundException(
          `SlotMachine with ID ${slotMachineId} not found`
        );
      }

      if (!FoundMachine.Active) {
        throw new BadRequestException('This slot machine is not active');
      }

      const ExistingActive = await manager.findOne(ActiveSession, {
        where: { UserId: userId },
      });

      if (ExistingActive) {
        throw new ConflictException(
          'Você já está em uma partida. Encerre a mesa atual antes de entrar em outra.'
        );
      }

      const UserEntity = await manager.findOne(User, {
        where: { UserId: userId },
      });

      if (!UserEntity) {
        throw new NotFoundException('User not found');
      }

      if (
        FoundMachine.MinimumSpinValue &&
        UserEntity.ChipBalance < FoundMachine.MinimumSpinValue
      ) {
        throw new BadRequestException(
          'Insufficient chips to start a new session'
        );
      }

      if (FoundMachine.MinimumSpinValue) {
        await manager.decrement(
          User,
          { UserId: userId },
          'ChipBalance',
          FoundMachine.MinimumSpinValue
        );
      }

      const Reels = this.generateRandomReels();
      const Reward = this.calculateReward(Reels);

      const NewSession = manager.create(SlotSession, {
        UserId: userId,
        SlotMachineId: slotMachineId,
        Status: SlotSessionStatus.InProgress,
        StartedAt: dto.StartedAt || new Date(),
        LastInteractionAt: dto.LastInteractionAt || new Date(),
        EndedAt: dto.EndedAt ?? null,
        CurrentRewardSnapshot: Reward,
        CurrentSpinResult: { Reels },
        CurrentRerollsSpent: { Rerolls: { Max: 5, Used: 0 } },
      });
      const SavedSession = await manager.save(SlotSession, NewSession);

      await this.sessionRegistryService.acquire(
        manager,
        userId,
        GameType.Slot,
        SavedSession.SlotSessionId
      );

      await queryRunner.commitTransaction();

      const FinalBalance = await this.authService.GetChipBalance(userId);
      return {
        session: SavedSession,
        currentBalance: FinalBalance.ChipBalance,
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(slotMachineId: number, userId: string): Promise<SlotSession[]> {
    return this.slotSessionRepo.find({
      where: {
        SlotMachineId: slotMachineId,
        UserId: userId,
        DeletedAt: IsNull(),
      },
    });
  }

  async findOne(
    slotMachineId: number,
    id: number,
    userId: string
  ): Promise<SlotSession> {
    const Session = await this.slotSessionRepo.findOne({
      where: {
        SlotSessionId: id,
        SlotMachineId: slotMachineId,
        UserId: userId,
        DeletedAt: IsNull(),
      },
    });

    if (!Session) {
      throw new NotFoundException(
        `SlotSession with Id ${id} not found for this slot machine and user`
      );
    }

    return Session;
  }

  async update(
    slotMachineId: number,
    id: number,
    dto: UpdateSlotSessionDto,
    userId: string
  ): Promise<SlotSession> {
    const Session = await this.findOne(slotMachineId, id, userId);
    Object.assign(Session, dto);
    return this.slotSessionRepo.save(Session);
  }

  async findActiveSession(userId: string): Promise<SlotSession | null> {
    return (
      (await this.slotSessionRepo.findOne({
        where: {
          UserId: userId,
          Status: SlotSessionStatus.InProgress,
          DeletedAt: IsNull(),
        },
      })) ?? null
    );
  }

  async rerollActive(
    userId: string,
    reelIndex: number
  ): Promise<{ session: SlotSession; currentBalance: number }> {
    const ActiveSession = await this.findActiveSession(userId);

    if (!ActiveSession) {
      throw new NotFoundException('No active session found');
    }

    return this.reroll(
      ActiveSession.SlotMachineId,
      ActiveSession.SlotSessionId,
      reelIndex,
      userId
    );
  }

  async cashOutActive(
    userId: string
  ): Promise<{ message: string; finalBalance: number }> {
    const ActiveSession = await this.findActiveSession(userId);

    if (!ActiveSession) {
      const LatestSession = await this.slotSessionRepo.findOne({
        where: { UserId: userId, DeletedAt: IsNull() },
        order: { SlotSessionId: 'DESC' },
      });

      if (LatestSession?.Status === SlotSessionStatus.CashedOut) {
        throw new BadRequestException('Session has already been cashed out');
      }

      throw new NotFoundException('No active session found');
    }

    return this.cashOut(
      ActiveSession.SlotMachineId,
      ActiveSession.SlotSessionId,
      userId
    );
  }

  async remove(
    slotMachineId: number,
    id: number,
    userId: string
  ): Promise<void> {
    const Session = await this.findOne(slotMachineId, id, userId);
    Session.DeletedAt = new Date();
    await this.slotSessionRepo.save(Session);
  }

  async reroll(
    slotMachineId: number,
    id: number,
    reelIndex: number,
    userId: string
  ): Promise<{ session: SlotSession; currentBalance: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      const Session = await manager.findOne(SlotSession, {
        where: {
          SlotSessionId: id,
          SlotMachineId: slotMachineId,
          UserId: userId,
          DeletedAt: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!Session) {
        throw new NotFoundException(
          `SlotSession with Id ${id} not found for this slot machine and user`
        );
      }

      if (Session.Status !== SlotSessionStatus.InProgress) {
        throw new BadRequestException('Session is not active');
      }

      const FoundMachine = await manager.findOne(SlotMachine, {
        where: { SlotMachineId: slotMachineId },
      });

      if (!FoundMachine) {
        throw new NotFoundException(
          `SlotMachine with ID ${slotMachineId} not found`
        );
      }

      if (!FoundMachine.Active) {
        throw new BadRequestException('This slot machine is no longer active');
      }

      if (
        Session.CurrentRerollsSpent.Rerolls.Used >=
        Session.CurrentRerollsSpent.Rerolls.Max
      ) {
        throw new BadRequestException('No rerolls left');
      }

      if (
        reelIndex < 0 ||
        reelIndex >= Session.CurrentSpinResult.Reels.length
      ) {
        throw new BadRequestException('Invalid reel index');
      }

      const UserEntity = await manager.findOne(User, {
        where: { UserId: userId },
      });

      if (!UserEntity) {
        throw new NotFoundException('User not found');
      }

      if (
        FoundMachine.MinimumRerollValue &&
        UserEntity.ChipBalance < FoundMachine.MinimumRerollValue
      ) {
        throw new BadRequestException('Insufficient chips to reroll');
      }

      if (FoundMachine.MinimumRerollValue) {
        await manager.decrement(
          User,
          { UserId: userId },
          'ChipBalance',
          FoundMachine.MinimumRerollValue
        );
      }

      const NewSymbol = this.getRandomSymbol();
      Session.CurrentSpinResult.Reels[reelIndex].SymbolId = NewSymbol;

      const NewReward = this.calculateReward(Session.CurrentSpinResult.Reels);
      Session.CurrentRewardSnapshot = NewReward;
      Session.CurrentRerollsSpent.Rerolls.Used += 1;
      Session.LastInteractionAt = new Date();

      const UpdatedSession = await manager.save(SlotSession, Session);

      await queryRunner.commitTransaction();

      const FinalBalance = await this.authService.GetChipBalance(userId);
      return {
        session: UpdatedSession,
        currentBalance: FinalBalance.ChipBalance,
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async cashOut(
    slotMachineId: number,
    id: number,
    userId: string
  ): Promise<{ message: string; finalBalance: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;
      const SessionRepo = manager.getRepository(SlotSession);

      const Session = await SessionRepo.findOne({
        where: {
          SlotSessionId: id,
          SlotMachineId: slotMachineId,
          UserId: userId,
          DeletedAt: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!Session) {
        throw new NotFoundException('Session not found');
      }

      if (Session.Status !== SlotSessionStatus.InProgress) {
        throw new BadRequestException('Session is not active');
      }

      const Reward = Session.CurrentRewardSnapshot;

      await manager.increment(User, { UserId: userId }, 'ChipBalance', Reward);

      Session.Status = SlotSessionStatus.CashedOut;
      Session.EndedAt = new Date();
      await SessionRepo.save(Session);

      await this.sessionRegistryService.release(manager, userId);

      await queryRunner.commitTransaction();

      const FinalBalance = await this.authService.GetChipBalance(userId);
      return {
        message: 'Cash out successful',
        finalBalance: FinalBalance.ChipBalance,
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private generateRandomReels(): SpinReelResult[] {
    const Reels: SpinReelResult[] = [];
    for (let i = 0; i < 4; i++) {
      Reels.push({ ReelIndex: i, SymbolId: this.getRandomSymbol() });
    }
    return Reels;
  }

  private getRandomSymbol(): SlotSymbol {
    const Weighted: { Symbol: SlotSymbol; Weight: number }[] = [
      { Symbol: SlotSymbol.Orange, Weight: 25 },
      { Symbol: SlotSymbol.Oranges, Weight: 20 },
      { Symbol: SlotSymbol.Pig, Weight: 5 },
      { Symbol: SlotSymbol.TwoX, Weight: 5 },
      { Symbol: SlotSymbol.Rat, Weight: 15 },
      { Symbol: SlotSymbol.Cheese, Weight: 10 },
      { Symbol: SlotSymbol.Watermelon, Weight: 10 },
      { Symbol: SlotSymbol.Egg, Weight: 10 },
    ];

    const Total = Weighted.reduce((s, item) => s + item.Weight, 0);
    const RandomValue = Math.random() * Total;
    let Accumulator = 0;
    for (const WeightedItem of Weighted) {
      Accumulator += WeightedItem.Weight;
      if (RandomValue < Accumulator) return WeightedItem.Symbol;
    }

    return Weighted[Weighted.length - 1].Symbol;
  }

  private calculateReward(Reels: SpinReelResult[]): number {
    const SymbolCounts = new Map<SlotSymbol, number>();
    for (const Reel of Reels) {
      SymbolCounts.set(
        Reel.SymbolId,
        (SymbolCounts.get(Reel.SymbolId) || 0) + 1
      );
    }

    let Reward = 0;
    const HasRat = SymbolCounts.get(SlotSymbol.Rat) || 0;
    const HasCheese = SymbolCounts.get(SlotSymbol.Cheese) || 0;

    const EffectiveRat = HasCheese > 0 ? 0 : HasRat;

    if (EffectiveRat > 0) {
      Reward = 0;
    } else {
      const OrangeCount = SymbolCounts.get(SlotSymbol.Orange) || 0;
      if (OrangeCount === 3) Reward += 5;
      else if (OrangeCount === 4) Reward += 8;

      const OrangesCount = SymbolCounts.get(SlotSymbol.Oranges) || 0;
      if (OrangesCount === 3) Reward += 10;
      else if (OrangesCount === 4) Reward += 15;

      const PigCount = SymbolCounts.get(SlotSymbol.Pig) || 0;
      Reward += PigCount * 20;

      const WatermelonCount = SymbolCounts.get(SlotSymbol.Watermelon) || 0;
      if (WatermelonCount === 4) Reward += 100;

      if (HasCheese > 0 && HasRat > 0) {
        Reward += HasRat * 10;
      }

      const TwoXCount = SymbolCounts.get(SlotSymbol.TwoX) || 0;
      if (TwoXCount > 0) Reward *= 2;
    }

    return Reward;
  }
}

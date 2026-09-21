import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  GambitSession,
  GambitSessionStatus,
} from '../domain/gambit-session.entity';
import { GambitTable } from '../../domain/gambit-table.entity';
import { User } from '../../../auth/domain/user.entity';
import { CreateGambitSessionDto } from '../domain/dto/create-gambit-session.dto';
import { UpdateGambitSessionDto } from '../domain/dto/update-gambit-session.dto';
import { ResolveEventDto } from '../domain/dto/resolve-event.dto';
import { ResolveEffectDto } from '../domain/dto/resolve-effect.dto';
import {
  BOARD_SIZE,
  CARD_POINTS_RANGE,
  EFFECT_CARD_DENSITY,
  FIRST_EVENT_RANGE,
  RANDOM_POINTS_RANGE,
  SECOND_EVENT_RANGE,
} from '../../gambit.constants';
import { CalcMultiplier } from '../../gambit.utils';
import { SessionRegistryService } from '../../../sessions/application/session-registry.service';
import { GameType } from '../../../sessions/domain/enums/game-type.enum';
import {
  GambitCard,
  GambitCardConfig,
  GambitEffectConfig,
} from '../domain/types/gambit-session.types';
import type {
  CurrentGridSnapshot,
  GambitGridView,
  GambitSessionView,
  GridPosition,
  PendingEvent,
} from '../domain/types/gambit-session.types';

const ALL_CARDS = Object.values(GambitCard) as GambitCard[];
const BOARD_CARDS = ALL_CARDS.filter((c) => c !== GambitCard.MOSCA_JOKER);
const EVENT_CARDS = ALL_CARDS.filter((c) => c !== GambitCard.BUMIS_INFILTRADOS);
const GOOD_CARDS = ALL_CARDS.filter(
  (c) => GambitCardConfig[c].nature === 'Good'
);

export type PeekResult =
  | { Position: number; Points: number; Effect: GambitCard | null }
  | { AtLeastOneBad: boolean }
  | null;

@Injectable()
export class GambitSessionService {
  constructor(
    @InjectRepository(GambitSession)
    private readonly GambitSessionRepo: Repository<GambitSession>,
    @InjectRepository(GambitTable)
    private readonly GambitTableRepo: Repository<GambitTable>,
    private readonly dataSource: DataSource,
    private readonly sessionRegistryService: SessionRegistryService
  ) {}

  async Create(
    GambitTableId: number,
    DTO: CreateGambitSessionDto,
    UserId: string
  ): Promise<{ session: GambitSessionView; currentBalance: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      const Table = await manager.findOne(GambitTable, {
        where: { GambitTableId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!Table) {
        throw new NotFoundException(
          `GambitTable with ID ${GambitTableId} not found`
        );
      }
      if (!Table.Active) {
        throw new BadRequestException('This gambit table is not active');
      }

      const Cards = DTO.CardsPurchased;
      if (
        Cards < Table.MinimumCardsPurchased ||
        Cards > Table.MaxCardsPurchased
      ) {
        throw new BadRequestException(
          `CardsPurchased must be between ${Table.MinimumCardsPurchased} and ${Table.MaxCardsPurchased}`
        );
      }

      const UserEntity = await manager.findOne(User, { where: { UserId } });
      if (!UserEntity) {
        throw new NotFoundException('User not found');
      }

      const Cost = Table.CardPrice * Cards;
      if (
        Table.MinimumChipsRequired &&
        UserEntity.ChipBalance < Table.MinimumChipsRequired
      ) {
        throw new BadRequestException(
          'Insufficient chips to access this table'
        );
      }
      if (UserEntity.ChipBalance < Cost) {
        throw new BadRequestException(
          'Insufficient chips to purchase these cards'
        );
      }

      const Snapshot: CurrentGridSnapshot = {
        Unrevealed: this.GenerateBoard(),
        Revealed: [],
        PendingEvent: null,
        PendingInteraction: null,
        EventsFired: [],
      };

      const Session = manager.create(GambitSession, {
        UserId,
        GambitTableId,
        CardsPurchased: Cards,
        BurnSlotsAvailable: Cards,
        ManualFlipsCount: 0,
        FirstEventFlip: this.RandomInt(
          FIRST_EVENT_RANGE.MIN,
          FIRST_EVENT_RANGE.MAX
        ),
        SecondEventFlip: this.RandomInt(
          SECOND_EVENT_RANGE.MIN,
          SECOND_EVENT_RANGE.MAX
        ),
        AccumulatedPoints: 0,
        Status: GambitSessionStatus.InProgress,
        Result: null,
        NextEffect: null,
        CurrentGridSnapshot: Snapshot,
      });
      const Saved = await manager.save(GambitSession, Session);

      await manager.decrement(User, { UserId }, 'ChipBalance', Cost);

      await this.sessionRegistryService.acquire(
        manager,
        UserId,
        GameType.Gambit,
        Saved.GambitSessionId
      );

      await queryRunner.commitTransaction();

      return {
        session: this.ToClientView(Saved),
        currentBalance: UserEntity.ChipBalance - Cost,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async GetActiveSessionView(
    UserId: string
  ): Promise<GambitSessionView | null> {
    const Session = await this.FindCurrentSessionEntity(UserId);
    return Session ? this.ToClientView(Session) : null;
  }

  async Burn(UserId: string, Position: number): Promise<GambitSessionView> {
    const Session = await this.FindCurrentSessionEntity(UserId);
    if (!Session) {
      throw new NotFoundException('No active session found');
    }
    if (Session.Status !== GambitSessionStatus.InProgress) {
      throw new BadRequestException('Session is not in progress');
    }

    this.ValidateNoBlockingState(Session);

    const Snap = this.RequireSnapshot(Session);
    if (Session.ManualFlipsCount >= Session.BurnSlotsAvailable) {
      throw new BadRequestException('No burns left in this session');
    }

    const Index = Snap.Unrevealed.findIndex((c) => c.Position === Position);
    if (Index === -1) {
      throw new BadRequestException(
        `Position ${Position} is not an unrevealed card`
      );
    }
    const Card = Snap.Unrevealed[Index];
    if (Card.Locked) {
      throw new BadRequestException('This card is locked and cannot be burned');
    }

    let Points = Card.Points;
    let CancelThisCardEffect = false;
    if (Session.NextEffect) {
      const Def = GambitCardConfig[Session.NextEffect];
      const Value = Def.value ?? 2;
      switch (Def.effect) {
        case 'MULTIPLY':
          Points = Card.Points * Value;
          break;
        case 'DIVIDE':
          Points = Math.trunc(Card.Points / Value);
          break;
        case 'INVERT':
          Points = -Card.Points;
          break;
        case 'NULLIFY_NEXT_SCORE':
          Points = 0;
          break;
        case 'FORCE_NEGATIVE_NEXT':
          Points = -Math.abs(Card.Points);
          break;
        case 'CANCEL_NEXT_BURN':
          CancelThisCardEffect = true;
          break;
        default:
          break;
      }
      Session.NextEffect = null;
    }
    Session.AccumulatedPoints += Points;

    Snap.Unrevealed.splice(Index, 1);
    Snap.Revealed.push(Card);
    Session.ManualFlipsCount += 1;

    if (Card.Effect && !CancelThisCardEffect) {
      this.ApplyCardEffect(Session, Snap, Card.Effect);
    }

    await this.AdvanceState(Session, Snap);

    Session.CurrentGridSnapshot = Snap;
    const Saved = await this.GambitSessionRepo.save(Session);
    return this.ToClientView(Saved);
  }

  async ResolveEvent(
    UserId: string,
    DTO: ResolveEventDto
  ): Promise<GambitSessionView> {
    const Session = await this.FindCurrentSessionEntity(UserId);
    if (!Session || Session.Status !== GambitSessionStatus.InProgress) {
      throw new NotFoundException('No active session found');
    }
    const Snap = this.RequireSnapshot(Session);
    const Event = Snap.PendingEvent;
    if (!Event) {
      throw new BadRequestException('There is no selection event to resolve');
    }
    if (
      DTO.GoodIndex >= Event.GoodOptions.length ||
      DTO.BadIndex >= Event.BadOptions.length
    ) {
      throw new BadRequestException('Selection index out of range');
    }

    const Chosen = [
      Event.GoodOptions[DTO.GoodIndex],
      Event.BadOptions[DTO.BadIndex],
    ];
    for (const Card of Chosen) {
      this.SubstituteIntoBoard(Snap, Card);
    }

    Snap.PendingEvent = null;
    await this.AdvanceState(Session, Snap);

    Session.CurrentGridSnapshot = Snap;
    const Saved = await this.GambitSessionRepo.save(Session);
    return this.ToClientView(Saved);
  }

  async ResolveEffect(
    UserId: string,
    DTO: ResolveEffectDto
  ): Promise<GambitSessionView & { PeekResult: PeekResult }> {
    const Session = await this.FindCurrentSessionEntity(UserId);
    if (!Session || Session.Status !== GambitSessionStatus.InProgress) {
      throw new NotFoundException('No active session found');
    }
    const Snap = this.RequireSnapshot(Session);
    const Pending = Snap.PendingInteraction;
    if (!Pending) {
      throw new BadRequestException(
        'There is no effect interaction to resolve'
      );
    }
    if (DTO.Positions.length !== Pending.RequiredSelections) {
      throw new BadRequestException(
        `This effect requires exactly ${Pending.RequiredSelections} position(s)`
      );
    }

    const Chosen: GridPosition[] = [];
    for (const Pos of DTO.Positions) {
      const Card = Snap.Unrevealed.find((c) => c.Position === Pos);
      if (!Card) {
        throw new BadRequestException(
          `Position ${Pos} is not an unrevealed card`
        );
      }
      if (Chosen.includes(Card)) {
        throw new BadRequestException('Duplicate position selected');
      }
      Chosen.push(Card);
    }

    const Effect = GambitCardConfig[Pending.Effect].effect;
    let Result: PeekResult = null;
    if (Effect === 'REVEAL') {
      const Card = Chosen[0];
      Result = {
        Position: Card.Position,
        Points: Card.Points,
        Effect: this.DisplayedEffect(Card),
      };
    } else if (Effect === 'PEEK_CARDS') {
      Result = { AtLeastOneBad: Chosen.some((c) => this.IsBadCard(c)) };
    }

    Snap.PendingInteraction = null;
    await this.AdvanceState(Session, Snap);

    Session.CurrentGridSnapshot = Snap;
    const Saved = await this.GambitSessionRepo.save(Session);
    return { ...this.ToClientView(Saved), PeekResult: Result };
  }

  async CashOut(
    UserId: string
  ): Promise<{ message: string; reward: number; finalBalance: number }> {
    const Current = await this.FindCurrentSessionEntity(UserId);
    if (!Current) {
      const LatestSession = await this.GambitSessionRepo.findOne({
        where: { UserId },
        order: { GambitSessionId: 'DESC' },
      });

      if (LatestSession?.Status === GambitSessionStatus.CashedOut) {
        throw new BadRequestException('Session has already been cashed out');
      }

      throw new NotFoundException('No session to cash out');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      const Session = await manager.findOne(GambitSession, {
        where: { GambitSessionId: Current.GambitSessionId, UserId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!Session) {
        throw new NotFoundException('Session not found');
      }
      if (Session.Status !== GambitSessionStatus.Finished) {
        throw new BadRequestException(
          'Session is not finished yet. Burn all purchased cards first.'
        );
      }

      const UserEntity = await manager.findOne(User, { where: { UserId } });
      if (!UserEntity) {
        throw new NotFoundException('User not found');
      }

      const Reward = Math.max(0, Session.Result ?? 0);
      await manager.increment(User, { UserId }, 'ChipBalance', Reward);

      Session.Status = GambitSessionStatus.CashedOut;
      await manager.save(GambitSession, Session);

      await this.sessionRegistryService.release(manager, UserId);

      await queryRunner.commitTransaction();

      return {
        message: 'Cash out successful',
        reward: Reward,
        finalBalance: UserEntity.ChipBalance + Reward,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async FindAll(
    GambitTableId: number,
    UserId: string
  ): Promise<GambitSession[]> {
    return this.GambitSessionRepo.find({ where: { GambitTableId, UserId } });
  }

  async FindOne(
    GambitTableId: number,
    Id: number,
    UserId: string
  ): Promise<GambitSession> {
    const Session = await this.GambitSessionRepo.findOne({
      where: { GambitSessionId: Id, GambitTableId, UserId },
    });
    if (!Session) {
      throw new NotFoundException(
        `GambitSession with ID ${Id} not found for this gambit table and user`
      );
    }
    return Session;
  }

  async Update(
    GambitTableId: number,
    Id: number,
    DTO: UpdateGambitSessionDto,
    UserId: string
  ): Promise<GambitSession> {
    const Session = await this.FindOne(GambitTableId, Id, UserId);
    Object.assign(Session, DTO);
    return this.GambitSessionRepo.save(Session);
  }

  async Remove(
    GambitTableId: number,
    Id: number,
    UserId: string
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      const Session = await manager.findOne(GambitSession, {
        where: { GambitSessionId: Id, GambitTableId, UserId },
      });

      if (!Session) {
        throw new NotFoundException(
          `GambitSession with ID ${Id} not found for this gambit table and user`
        );
      }

      await manager.remove(GambitSession, Session);
      await this.sessionRegistryService.release(manager, UserId);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private ValidateNoBlockingState(Session: GambitSession): void {
    const Snapshot = Session.CurrentGridSnapshot;
    if (!Snapshot) return;
    if (Snapshot.PendingEvent !== null) {
      throw new BadRequestException(
        'Cannot perform action: a pending event must be resolved first'
      );
    }
    if (Snapshot.PendingInteraction !== null) {
      throw new BadRequestException(
        'Cannot perform action: a pending interaction must be resolved first'
      );
    }
  }

  private async FindCurrentSessionEntity(
    UserId: string
  ): Promise<GambitSession | null> {
    return this.GambitSessionRepo.findOne({
      where: {
        UserId,
        Status: In([
          GambitSessionStatus.InProgress,
          GambitSessionStatus.Finished,
        ]),
      },
      order: { GambitSessionId: 'DESC' },
    });
  }

  private RequireSnapshot(Session: GambitSession): CurrentGridSnapshot {
    if (!Session.CurrentGridSnapshot) {
      throw new BadRequestException('Session has no grid snapshot');
    }
    return Session.CurrentGridSnapshot;
  }

  private ApplyCardEffect(
    Session: GambitSession,
    Snap: CurrentGridSnapshot,
    Card: GambitCard
  ): void {
    const Def = GambitCardConfig[Card];
    const EffectDef = GambitEffectConfig[Def.effect];

    if (EffectDef.appliedOn === 'NEXT_BURN') {
      Session.NextEffect = Card;
      return;
    }

    if (EffectDef.requiresUserInteraction) {
      const Selections = Def.effect === 'PEEK_CARDS' ? 3 : 1;
      Snap.PendingInteraction = {
        Effect: Card,
        Action: Selections > 1 ? 'SELECT_MULTIPLE_CARDS' : 'SELECT_CARD',
        RequiredSelections: Selections,
        SelectedPositions: [],
      };
      return;
    }

    switch (Def.effect) {
      case 'RANDOM_POINTS':
        Session.AccumulatedPoints += this.RandomEffectPoints();
        break;
      case 'RESET_POINTS':
        Session.AccumulatedPoints = 0;
        break;
      case 'REMOVE_BURN_SLOT':
        Session.BurnSlotsAvailable = Math.max(
          Session.ManualFlipsCount,
          Session.BurnSlotsAvailable - 1
        );
        break;
      case 'ADD_BURN_SLOT':
        Session.BurnSlotsAvailable = Math.min(
          BOARD_SIZE,
          Session.BurnSlotsAvailable + 1
        );
        break;
      case 'LOCK_GOOD_CARD':
        this.LockGoodCard(Snap);
        break;
      case 'TRANSFORM_CARD':
        this.TransformRandomCard(Snap);
        break;
      case 'JACKPOT':
        Session.AccumulatedPoints += Def.value ?? 0;
        break;
      case 'NO_OP':
        break;
      case 'SABOTAGE_HIGHEST':
        this.SabotageHighestUnrevealed(Snap);
        break;
      default:
        break;
    }
  }

  private SabotageHighestUnrevealed(Snap: CurrentGridSnapshot): void {
    if (Snap.Unrevealed.length === 0) {
      return;
    }
    const Highest = Snap.Unrevealed.reduce((a, b) =>
      b.Points > a.Points ? b : a
    );
    Highest.Points = -Math.abs(Highest.Points);
  }

  private async AdvanceState(
    Session: GambitSession,
    Snap: CurrentGridSnapshot
  ): Promise<void> {
    if (Snap.PendingInteraction) {
      return;
    }

    if (!Snap.PendingEvent) {
      const Triggers = [Session.FirstEventFlip, Session.SecondEventFlip];
      if (
        Triggers.includes(Session.ManualFlipsCount) &&
        !Snap.EventsFired.includes(Session.ManualFlipsCount)
      ) {
        Snap.EventsFired.push(Session.ManualFlipsCount);
        Snap.PendingEvent = this.GenerateSelectionEvent();
        return;
      }
    }

    if (Snap.PendingEvent) {
      return;
    }

    const HasBurnableCard = Snap.Unrevealed.some((c) => !c.Locked);
    if (
      Session.Status === GambitSessionStatus.InProgress &&
      (Session.ManualFlipsCount >= Session.BurnSlotsAvailable ||
        !HasBurnableCard)
    ) {
      const Table = await this.GambitTableRepo.findOne({
        where: { GambitTableId: Session.GambitTableId },
      });
      const Multiplier = CalcMultiplier(
        Session.CardsPurchased,
        Table?.TableMultiplier ?? 1
      );
      Session.Status = GambitSessionStatus.Finished;
      Session.Result = Math.max(
        0,
        Math.floor(Session.AccumulatedPoints * Multiplier)
      );
    }
  }

  private SubstituteIntoBoard(
    Snap: CurrentGridSnapshot,
    Card: GambitCard
  ): void {
    let Candidates = Snap.Unrevealed.filter(
      (c) => !c.Locked && c.Effect === null
    );
    if (Candidates.length === 0) {
      Candidates = Snap.Unrevealed.filter((c) => !c.Locked);
    }
    if (Candidates.length === 0) {
      return;
    }
    const Target = Candidates[this.RandomInt(0, Candidates.length - 1)];
    Target.Effect = Card;
    Target.Points = this.RandomCardPoints();
  }

  private LockGoodCard(Snap: CurrentGridSnapshot): void {
    const Candidates = Snap.Unrevealed.filter(
      (c) =>
        !c.Locked &&
        c.Effect !== null &&
        GambitCardConfig[c.Effect].nature === 'Good'
    );
    if (Candidates.length === 0) {
      return;
    }
    const Target = Candidates[this.RandomInt(0, Candidates.length - 1)];
    Target.Locked = true;
  }

  private TransformRandomCard(Snap: CurrentGridSnapshot): void {
    const Candidates = Snap.Unrevealed.filter((c) => !c.Locked);
    if (Candidates.length === 0) {
      return;
    }
    const Target = Candidates[this.RandomInt(0, Candidates.length - 1)];
    Target.Effect = this.RandomCard();
  }

  private IsBadCard(Card: GridPosition): boolean {
    if (Card.Effect === GambitCard.BUMIS_INFILTRADOS) {
      return false;
    }
    if (Card.Effect && GambitCardConfig[Card.Effect].nature === 'Bad') {
      return true;
    }
    return Card.Points < 0;
  }

  private DisplayedEffect(Card: GridPosition): GambitCard | null {
    if (Card.Effect === GambitCard.BUMIS_INFILTRADOS) {
      return GOOD_CARDS[Card.Position % GOOD_CARDS.length];
    }
    return Card.Effect;
  }

  private ToClientView(Session: GambitSession): GambitSessionView {
    const Snap = Session.CurrentGridSnapshot;
    const Grid: GambitGridView = Snap
      ? {
          Revealed: Snap.Revealed,
          Unrevealed: Snap.Unrevealed.map((c) => ({
            Position: c.Position,
            Locked: c.Locked,
          })),
          PendingEvent: Snap.PendingEvent,
          PendingInteraction: Snap.PendingInteraction,
        }
      : {
          Revealed: [],
          Unrevealed: [],
          PendingEvent: null,
          PendingInteraction: null,
        };

    return {
      GambitSessionId: Session.GambitSessionId,
      GambitTableId: Session.GambitTableId,
      UserId: Session.UserId,
      CardsPurchased: Session.CardsPurchased,
      BurnSlotsAvailable: Session.BurnSlotsAvailable,
      ManualFlipsCount: Session.ManualFlipsCount,
      BurnsRemaining: Math.max(
        0,
        Session.BurnSlotsAvailable - Session.ManualFlipsCount
      ),
      AccumulatedPoints: Session.AccumulatedPoints,
      NextEffect: Session.NextEffect,
      Status: Session.Status,
      Result: Session.Result,
      Grid,
    };
  }

  private GenerateBoard(): GridPosition[] {
    const Board: GridPosition[] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      Board.push({
        Position: i,
        Points: this.RandomCardPoints(),
        Effect: Math.random() < EFFECT_CARD_DENSITY ? this.RandomCard() : null,
        Locked: false,
      });
    }
    return Board;
  }

  private GenerateSelectionEvent(): PendingEvent {
    const GoodPool = EVENT_CARDS.filter(
      (c) => GambitCardConfig[c].nature !== 'Bad'
    );
    const BadPool = EVENT_CARDS.filter(
      (c) => GambitCardConfig[c].nature !== 'Good'
    );
    return {
      GoodOptions: this.PickN(GoodPool, 3),
      BadOptions: this.PickN(BadPool, 3),
    };
  }

  private RandomCardPoints(): number {
    return this.RandomInt(CARD_POINTS_RANGE.MIN, CARD_POINTS_RANGE.MAX);
  }

  private RandomEffectPoints(): number {
    return this.RandomInt(RANDOM_POINTS_RANGE.MIN, RANDOM_POINTS_RANGE.MAX);
  }

  private RandomCard(): GambitCard {
    return BOARD_CARDS[this.RandomInt(0, BOARD_CARDS.length - 1)];
  }

  private PickN(Pool: GambitCard[], N: number): GambitCard[] {
    const Copy = [...Pool];
    const Picked: GambitCard[] = [];
    for (let i = 0; i < N; i++) {
      if (Copy.length === 0) {
        Picked.push(Pool[this.RandomInt(0, Pool.length - 1)]);
        continue;
      }
      const Index = this.RandomInt(0, Copy.length - 1);
      Picked.push(Copy.splice(Index, 1)[0]);
    }
    return Picked;
  }

  private RandomInt(Min: number, Max: number): number {
    return Math.floor(Math.random() * (Max - Min + 1)) + Min;
  }
}

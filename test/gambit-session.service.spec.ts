import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GambitSessionService } from '../src/modules/gambit/sessions/application/gambit-session.service';
import {
  GambitSession,
  GambitSessionStatus,
} from '../src/modules/gambit/sessions/domain/gambit-session.entity';
import { GambitTable } from '../src/modules/gambit/domain/gambit-table.entity';
import { User } from '../src/modules/auth/domain/user.entity';
import { CalcMultiplier } from '../src/modules/gambit/gambit.utils';
import {
  CurrentGridSnapshot,
  GambitCard,
  GambitCardConfig,
  GridPosition,
} from '../src/modules/gambit/sessions/domain/types/gambit-session.types';
import { CreateGambitSessionDto } from '../src/modules/gambit/sessions/domain/dto/create-gambit-session.dto';
import { UpdateGambitSessionDto } from '../src/modules/gambit/sessions/domain/dto/update-gambit-session.dto';
import {
  FIRST_EVENT_RANGE,
  SECOND_EVENT_RANGE,
} from '../src/modules/gambit/gambit.constants';
import { SessionRegistryService } from '../src/modules/sessions/application/session-registry.service';
import { ActiveSession } from '../src/modules/sessions/domain/active-session.entity';
import { GameType } from '../src/modules/sessions/domain/enums/game-type.enum';

type GambitSessionRepoMock = {
  create: jest.MockedFunction<(s: Partial<GambitSession>) => GambitSession>;
  save: jest.MockedFunction<(s: GambitSession) => Promise<GambitSession>>;
  findOne: jest.MockedFunction<(c: object) => Promise<GambitSession | null>>;
  find: jest.MockedFunction<(c: object) => Promise<GambitSession[]>>;
  remove: jest.MockedFunction<(s: GambitSession) => Promise<GambitSession>>;
};

type GambitTableRepoMock = {
  findOne: jest.MockedFunction<(c: object) => Promise<GambitTable | null>>;
};

type RegistryMock = { acquire: jest.Mock; release: jest.Mock };

type ServicePrivate = {
  GenerateBoard(): GridPosition[];
};

function MakeManagerMock() {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    increment: jest.fn(),
    decrement: jest.fn(),
  };
}

function MakeQRMock(Mgr: ReturnType<typeof MakeManagerMock>) {
  return {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: Mgr,
  };
}

const BuildTable = (Overrides: Partial<GambitTable> = {}): GambitTable => ({
  GambitTableId: 1,
  Name: 'Test Table',
  Description: 'test',
  MinimumChipsRequired: 0,
  CardPrice: 10,
  TableMultiplier: 1,
  MinimumCardsPurchased: 5,
  MaxCardsPurchased: 20,
  Active: true,
  ...Overrides,
});

const BuildSnapshot = (
  Overrides: Partial<CurrentGridSnapshot> = {}
): CurrentGridSnapshot => ({
  Unrevealed: Array.from({ length: 25 }, (_, i) => ({
    Position: i,
    Points: 10,
    Effect: null,
    Locked: false,
  })),
  Revealed: [],
  PendingEvent: null,
  PendingInteraction: null,
  EventsFired: [],
  ...Overrides,
});

const BuildSession = (Overrides: Partial<GambitSession> = {}): GambitSession =>
  ({
    GambitSessionId: 1,
    UserId: 'user1',
    GambitTableId: 1,
    CardsPurchased: 10,
    BurnSlotsAvailable: 10,
    ManualFlipsCount: 0,
    FirstEventFlip: 7,
    SecondEventFlip: 14,
    AccumulatedPoints: 0,
    Status: GambitSessionStatus.InProgress,
    Result: null,
    NextEffect: null,
    CurrentGridSnapshot: BuildSnapshot(),
    CreatedAt: new Date(),
    UpdatedAt: new Date(),
    ...Overrides,
  }) as GambitSession;

describe('GambitSessionService', () => {
  let Service: GambitSessionService;
  let Repo: GambitSessionRepoMock;
  let TableRepo: GambitTableRepoMock;
  let Registry: RegistryMock;

  const MockRepo: GambitSessionRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
  };

  const MockTableRepo: GambitTableRepoMock = {
    findOne: jest.fn(),
  };

  const MockDataSource = {
    createQueryRunner: jest.fn(),
  };

  const UseQueryRunner = () => {
    const Mgr = MakeManagerMock();
    const Qr = MakeQRMock(Mgr);
    MockDataSource.createQueryRunner.mockReturnValue(Qr);
    return { Mgr, Qr };
  };

  beforeEach(async () => {
    Registry = {
      acquire: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const Module: TestingModule = await Test.createTestingModule({
      providers: [
        GambitSessionService,
        {
          provide: getRepositoryToken(GambitSession),
          useValue: MockRepo,
        },
        {
          provide: getRepositoryToken(GambitTable),
          useValue: MockTableRepo,
        },
        {
          provide: DataSource,
          useValue: MockDataSource,
        },
        {
          provide: SessionRegistryService,
          useValue: Registry,
        },
      ],
    }).compile();

    Service = Module.get<GambitSessionService>(GambitSessionService);
    Repo = MockRepo;
    TableRepo = MockTableRepo;

    Repo.save.mockImplementation((s) => Promise.resolve(s));
    TableRepo.findOne.mockResolvedValue(BuildTable({ TableMultiplier: 1 }));
  });

  afterEach(() => jest.clearAllMocks());

  describe('CalcMultiplier (formula)', () => {
    it('returns 1x at the minimum and grows monotonically', () => {
      const M5 = CalcMultiplier(5, 1);
      const M10 = CalcMultiplier(10, 1);
      const M20 = CalcMultiplier(20, 1);
      expect(M5).toBeCloseTo(1.4, 5);
      expect(M10).toBeGreaterThan(M5);
      expect(M20).toBeGreaterThan(M10);
    });

    it('is continuous at the segment boundaries (5 and 15)', () => {
      expect(CalcMultiplier(15, 1)).toBeCloseTo(2.6, 5);
    });
  });

  describe('GenerateBoard', () => {
    it('creates 25 sequential, unlocked positions', () => {
      const Board = (Service as unknown as ServicePrivate).GenerateBoard();
      expect(Board).toHaveLength(25);
      Board.forEach((C, I) => {
        expect(C.Position).toBe(I);
        expect(C.Locked).toBe(false);
      });
    });
  });

  describe('Create', () => {
    it('creates a session InProgress, deducts the buy-in and acquires the lock', async () => {
      const Dto: CreateGambitSessionDto = { CardsPurchased: 10 };
      const MockUser = { UserId: 'user1', ChipBalance: 1000 } as User;
      const Saved = BuildSession({ CardsPurchased: 10 });

      const { Mgr, Qr } = UseQueryRunner();
      Mgr.findOne.mockImplementation((Entity: unknown) => {
        if (Entity === GambitTable) return Promise.resolve(BuildTable());
        if (Entity === ActiveSession) return Promise.resolve(null);
        if (Entity === User) return Promise.resolve(MockUser);
        return Promise.resolve(null);
      });
      Mgr.create.mockReturnValue(Saved);
      Mgr.save.mockResolvedValue(Saved);

      const Result = await Service.Create(1, Dto, 'user1');

      expect(Mgr.create).toHaveBeenCalledWith(
        GambitSession,
        expect.objectContaining({
          GambitTableId: 1,
          UserId: 'user1',
          Status: GambitSessionStatus.InProgress,
          BurnSlotsAvailable: Dto.CardsPurchased,
        })
      );

      const CallArg = (
        Mgr.create.mock.calls[0] as unknown[]
      )[1] as GambitSession;
      expect(CallArg.FirstEventFlip).toBeGreaterThanOrEqual(
        FIRST_EVENT_RANGE.MIN
      );
      expect(CallArg.FirstEventFlip).toBeLessThanOrEqual(FIRST_EVENT_RANGE.MAX);
      expect(CallArg.SecondEventFlip).toBeGreaterThanOrEqual(
        SECOND_EVENT_RANGE.MIN
      );
      expect(CallArg.SecondEventFlip).toBeLessThanOrEqual(
        SECOND_EVENT_RANGE.MAX
      );

      const BuyIn = Dto.CardsPurchased * BuildTable().CardPrice;
      expect(Mgr.decrement).toHaveBeenCalledWith(
        User,
        { UserId: 'user1' },
        'ChipBalance',
        BuyIn
      );

      expect(Registry.acquire).toHaveBeenCalledWith(
        Mgr,
        'user1',
        GameType.Gambit,
        Saved.GambitSessionId
      );

      expect(Qr.commitTransaction).toHaveBeenCalledTimes(1);
      expect(Result.session.Status).toBe(GambitSessionStatus.InProgress);
      expect(Result.currentBalance).toBe(1000 - BuyIn);
      expect(Result.session.Grid.Unrevealed[0]).toEqual({
        Position: 0,
        Locked: false,
      });
    });

    it('blocks a second open session (acquire throws ConflictException)', async () => {
      const MockUser = { UserId: 'user1', ChipBalance: 1000 } as User;
      const { Mgr, Qr } = UseQueryRunner();
      Mgr.findOne.mockImplementation((Entity: unknown) => {
        if (Entity === GambitTable) return Promise.resolve(BuildTable());
        if (Entity === User) return Promise.resolve(MockUser);
        return Promise.resolve(null);
      });
      Mgr.create.mockReturnValue(BuildSession());
      Mgr.save.mockResolvedValue(BuildSession());
      Registry.acquire.mockRejectedValue(
        new ConflictException('already in a match')
      );

      await expect(
        Service.Create(1, { CardsPurchased: 10 }, 'user1')
      ).rejects.toBeInstanceOf(ConflictException);
      expect(Qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects out-of-range card counts', async () => {
      const { Mgr } = UseQueryRunner();
      Mgr.findOne.mockImplementation((Entity: unknown) =>
        Entity === GambitTable
          ? Promise.resolve(BuildTable())
          : Promise.resolve(null)
      );
      await expect(
        Service.Create(1, { CardsPurchased: 99 }, 'user1')
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects insufficient chips for the purchase', async () => {
      const PoorUser = { UserId: 'user1', ChipBalance: 50 } as User;
      const { Mgr } = UseQueryRunner();
      Mgr.findOne.mockImplementation((Entity: unknown) => {
        if (Entity === GambitTable) return Promise.resolve(BuildTable());
        if (Entity === User) return Promise.resolve(PoorUser);
        return Promise.resolve(null);
      });
      await expect(
        Service.Create(1, { CardsPurchased: 10 }, 'user1')
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an inactive table', async () => {
      const { Mgr } = UseQueryRunner();
      Mgr.findOne.mockImplementation((Entity: unknown) =>
        Entity === GambitTable
          ? Promise.resolve(BuildTable({ Active: false }))
          : Promise.resolve(null)
      );
      await expect(
        Service.Create(1, { CardsPurchased: 10 }, 'user1')
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the table does not exist', async () => {
      const { Mgr } = UseQueryRunner();
      Mgr.findOne.mockResolvedValue(null);
      await expect(
        Service.Create(1, { CardsPurchased: 10 }, 'user1')
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Burn — NextEffect on points', () => {
    const BurnFirst = async (Session: GambitSession) => {
      Repo.findOne.mockResolvedValue(Session);
      return Service.Burn('user1', 0);
    };

    it('MULTIPLY doubles the next burned card points', async () => {
      const View = await BurnFirst(
        BuildSession({ NextEffect: GambitCard.DOBRO_DE_POTASSIO })
      );
      expect(View.AccumulatedPoints).toBe(20);
      expect(View.NextEffect).toBeNull();
    });

    it('DIVIDE halves the next burned card points', async () => {
      const View = await BurnFirst(
        BuildSession({ NextEffect: GambitCard.MELANCIDIO })
      );
      expect(View.AccumulatedPoints).toBe(5);
    });

    it('INVERT flips the sign', async () => {
      const View = await BurnFirst(
        BuildSession({ NextEffect: GambitCard.INVERSAO_GRAVITACIONAL })
      );
      expect(View.AccumulatedPoints).toBe(-10);
    });

    it('CANCEL_NEXT_BURN keeps points but skips the card own effect', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = GambitCard.CHRIS_JOKER;
      const View = await BurnFirst(
        BuildSession({
          NextEffect: GambitCard.ANULACAO_TOTAL,
          AccumulatedPoints: 50,
          CurrentGridSnapshot: Snap,
        })
      );
      expect(View.AccumulatedPoints).toBe(60);
    });
  });

  describe('Burn — immediate effects', () => {
    const BurnWithEffect = async (
      Effect: GambitCard,
      Base: Partial<GambitSession> = {}
    ) => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = Effect;
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap, ...Base })
      );
      return Service.Burn('user1', 0);
    };

    it('RESET_POINTS zeroes points', async () => {
      const View = await BurnWithEffect(GambitCard.CHRIS_JOKER, {
        AccumulatedPoints: 80,
      });
      expect(View.AccumulatedPoints).toBe(0);
    });

    it('ADD_BURN_SLOT grants one more burn', async () => {
      const View = await BurnWithEffect(GambitCard.QUANTO_MAIS_MELHOR);
      expect(View.BurnSlotsAvailable).toBe(11);
    });

    it('REMOVE_BURN_SLOT removes one burn', async () => {
      const View = await BurnWithEffect(GambitCard.QUANTO_MENOS_MELHOR);
      expect(View.BurnSlotsAvailable).toBe(9);
    });

    it('a NEXT_BURN card sets NextEffect for the next burn', async () => {
      const View = await BurnWithEffect(GambitCard.DOBRO_DE_POTASSIO);
      expect(View.NextEffect).toBe(GambitCard.DOBRO_DE_POTASSIO);
    });

    it('PEEK_CARDS opens a blocking SELECT_MULTIPLE_CARDS interaction', async () => {
      const View = await BurnWithEffect(GambitCard.CABECINHA);
      expect(View.Grid.PendingInteraction).toEqual({
        Effect: GambitCard.CABECINHA,
        Action: 'SELECT_MULTIPLE_CARDS',
        RequiredSelections: 3,
        SelectedPositions: [],
      });
    });
  });

  describe('Burn — new cards', () => {
    const BurnAt = async (Session: GambitSession, Pos = 0) => {
      Repo.findOne.mockResolvedValue(Session);
      return Service.Burn('user1', Pos);
    };

    it('JACKPOT adds a large fixed amount of points (+200)', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = GambitCard.JACKPOT;
      const View = await BurnAt(BuildSession({ CurrentGridSnapshot: Snap }));
      expect(View.AccumulatedPoints).toBe(10 + 200);
    });

    it('RATIMUNDIO adds a large negative amount (-200)', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = GambitCard.RATIMUNDIO;
      const View = await BurnAt(BuildSession({ CurrentGridSnapshot: Snap }));
      expect(View.AccumulatedPoints).toBe(10 - 200);
    });

    it('BUMIS_INFILTRADOS (trap) does nothing beyond its own points', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = GambitCard.BUMIS_INFILTRADOS;
      const View = await BurnAt(
        BuildSession({ CurrentGridSnapshot: Snap, AccumulatedPoints: 30 })
      );
      expect(View.AccumulatedPoints).toBe(30 + 10);
    });

    it('HEADGEAR (FORCE_NEGATIVE_NEXT) makes the next card subtract points', async () => {
      const View = await BurnAt(
        BuildSession({ NextEffect: GambitCard.HEADGEAR })
      );
      expect(View.AccumulatedPoints).toBe(-10);
    });

    it('COLORIDINHO zeroes the next card points but keeps its effect', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = GambitCard.JACKPOT;
      const View = await BurnAt(
        BuildSession({
          NextEffect: GambitCard.COLORIDINHO,
          CurrentGridSnapshot: Snap,
        })
      );
      expect(View.AccumulatedPoints).toBe(200);
    });

    it('PAO_COM_OQUE turns the highest unrevealed card negative (without revealing)', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = GambitCard.PAO_COM_OQUE;
      Snap.Unrevealed[5].Points = 90;
      await BurnAt(BuildSession({ CurrentGridSnapshot: Snap }));
      const Sabotaged = Snap.Unrevealed.find((C) => C.Position === 5);
      expect(Sabotaged?.Points).toBe(-90);
    });
  });

  describe('Burn — end of game / settlement', () => {
    it('finishes and computes Result = max(0, floor(points * CalcMultiplier))', async () => {
      TableRepo.findOne.mockResolvedValue(BuildTable({ TableMultiplier: 1 }));
      const Session = BuildSession({
        BurnSlotsAvailable: 1,
        ManualFlipsCount: 0,
        AccumulatedPoints: 40,
        CardsPurchased: 10,
      });
      Repo.findOne.mockResolvedValue(Session);

      const View = await Service.Burn('user1', 0);

      const Mult = CalcMultiplier(10, 1);
      expect(View.Status).toBe(GambitSessionStatus.Finished);
      expect(View.Result).toBe(Math.max(0, Math.floor((40 + 10) * Mult)));
    });

    it('clamps a negative final score to 0', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Points = -500;
      Repo.findOne.mockResolvedValue(
        BuildSession({
          BurnSlotsAvailable: 1,
          AccumulatedPoints: 0,
          CurrentGridSnapshot: Snap,
        })
      );

      const View = await Service.Burn('user1', 0);
      expect(View.Status).toBe(GambitSessionStatus.Finished);
      expect(View.Result).toBe(0);
    });

    it('rejects burning a locked card', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Locked = true;
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      await expect(Service.Burn('user1', 0)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('finalizes when no burnable card remains (avoids a soft-locked session)', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed.forEach((C) => {
        if (C.Position !== 0) C.Locked = true;
      });
      Repo.findOne.mockResolvedValue(
        BuildSession({
          BurnSlotsAvailable: 10,
          ManualFlipsCount: 0,
          CurrentGridSnapshot: Snap,
        })
      );

      const View = await Service.Burn('user1', 0);
      expect(View.Status).toBe(GambitSessionStatus.Finished);
    });
  });

  describe('CashOut', () => {
    it('pays the prize, marks CashedOut, releases the lock and commits', async () => {
      const Finished = BuildSession({
        Status: GambitSessionStatus.Finished,
        Result: 120,
      });
      Repo.findOne.mockResolvedValue(Finished);

      const { Mgr, Qr } = UseQueryRunner();
      const MockUser = { UserId: 'user1', ChipBalance: 1000 } as User;
      Mgr.findOne.mockImplementation((Entity: unknown) => {
        if (Entity === GambitSession) return Promise.resolve(Finished);
        if (Entity === User) return Promise.resolve(MockUser);
        return Promise.resolve(null);
      });
      Mgr.save.mockResolvedValue({
        ...Finished,
        Status: GambitSessionStatus.CashedOut,
      });

      const Result = await Service.CashOut('user1');

      expect(Mgr.increment).toHaveBeenCalledWith(
        User,
        { UserId: 'user1' },
        'ChipBalance',
        120
      );
      const SavedArg = (
        Mgr.save.mock.calls[0] as unknown[]
      )[1] as GambitSession;
      expect(SavedArg.Status).toBe(GambitSessionStatus.CashedOut);
      expect(Registry.release).toHaveBeenCalledWith(Mgr, 'user1');
      expect(Qr.commitTransaction).toHaveBeenCalledTimes(1);
      expect(Result.reward).toBe(120);
      expect(Result.finalBalance).toBe(1000 + 120);
      expect(Result.message).toBe('Cash out successful');
    });

    it('pays max(0, Result) — a negative result yields a zero reward', async () => {
      const Finished = BuildSession({
        Status: GambitSessionStatus.Finished,
        Result: -50,
      });
      Repo.findOne.mockResolvedValue(Finished);

      const { Mgr } = UseQueryRunner();
      const MockUser = { UserId: 'user1', ChipBalance: 1000 } as User;
      Mgr.findOne.mockImplementation((Entity: unknown) => {
        if (Entity === GambitSession) return Promise.resolve(Finished);
        if (Entity === User) return Promise.resolve(MockUser);
        return Promise.resolve(null);
      });
      Mgr.save.mockResolvedValue(Finished);

      const Result = await Service.CashOut('user1');
      expect(Mgr.increment).toHaveBeenCalledWith(
        User,
        { UserId: 'user1' },
        'ChipBalance',
        0
      );
      expect(Result.reward).toBe(0);
      expect(Result.finalBalance).toBe(1000);
    });

    it('rolls back when the session is not finished', async () => {
      const InProgress = BuildSession({
        Status: GambitSessionStatus.InProgress,
      });
      Repo.findOne.mockResolvedValue(InProgress);

      const { Mgr, Qr } = UseQueryRunner();
      Mgr.findOne.mockImplementation((Entity: unknown) =>
        Entity === GambitSession
          ? Promise.resolve(InProgress)
          : Promise.resolve(null)
      );

      await expect(Service.CashOut('user1')).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(Mgr.increment).not.toHaveBeenCalled();
      expect(Registry.release).not.toHaveBeenCalled();
      expect(Qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when there is no current session', async () => {
      Repo.findOne.mockResolvedValue(null);
      await expect(Service.CashOut('user1')).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe('ResolveEvent', () => {
    it('substitutes the chosen good + bad cards into the board', async () => {
      const Snap = BuildSnapshot({
        PendingEvent: {
          GoodOptions: [
            GambitCard.DOBRO_DE_POTASSIO,
            GambitCard.CABECINHA,
            GambitCard.CLARIVIDENCIA,
          ],
          BadOptions: [
            GambitCard.MELANCIDIO,
            GambitCard.MENTE_LISA,
            GambitCard.CHRIS_JOKER,
          ],
        },
      });
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );

      await Service.ResolveEvent('user1', { GoodIndex: 0, BadIndex: 1 });

      const Placed = Snap.Unrevealed.map((C) => C.Effect).filter(
        (E): E is GambitCard => E !== null
      );
      expect(Placed).toContain(GambitCard.DOBRO_DE_POTASSIO);
      expect(Placed).toContain(GambitCard.MENTE_LISA);
      expect(Snap.PendingEvent).toBeNull();
    });

    it('rejects an out-of-range index', async () => {
      const Snap = BuildSnapshot({
        PendingEvent: {
          GoodOptions: [
            GambitCard.DOBRO_DE_POTASSIO,
            GambitCard.CABECINHA,
            GambitCard.CLARIVIDENCIA,
          ],
          BadOptions: [
            GambitCard.MELANCIDIO,
            GambitCard.MENTE_LISA,
            GambitCard.HEADGEAR,
          ],
        },
      });
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      await expect(
        Service.ResolveEvent('user1', { GoodIndex: 5, BadIndex: 0 })
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ResolveEffect — BUMIS_INFILTRADOS disguise', () => {
    it('REVEAL on a BUMIS_INFILTRADOS shows a fake GOOD card, never BUMIS_INFILTRADOS', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[3].Effect = GambitCard.BUMIS_INFILTRADOS;
      Snap.PendingInteraction = {
        Effect: GambitCard.CLARIVIDENCIA,
        Action: 'SELECT_CARD',
        RequiredSelections: 1,
        SelectedPositions: [],
      };
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );

      const Res = await Service.ResolveEffect('user1', { Positions: [3] });
      const Peek = Res.PeekResult as {
        Position: number;
        Effect: GambitCard | null;
      };
      expect(Peek.Effect).not.toBe(GambitCard.BUMIS_INFILTRADOS);
      expect(Peek.Effect).not.toBeNull();
      expect(GambitCardConfig[Peek.Effect as GambitCard].nature).toBe('Good');
    });
  });

  describe('ResolveEffect / Burn — edge cases', () => {
    const WithInteraction = (
      Effect: GambitCard,
      Action: 'SELECT_CARD' | 'SELECT_MULTIPLE_CARDS',
      Required: number
    ) => {
      const Snap = BuildSnapshot();
      Snap.PendingInteraction = {
        Effect,
        Action,
        RequiredSelections: Required,
        SelectedPositions: [],
      };
      return Snap;
    };

    it('PEEK does NOT flag a BUMIS_INFILTRADOS (the disguise fools the warning)', async () => {
      const Snap = WithInteraction(
        GambitCard.CABECINHA,
        'SELECT_MULTIPLE_CARDS',
        3
      );
      Snap.Unrevealed[1].Effect = GambitCard.BUMIS_INFILTRADOS;
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      const Res = await Service.ResolveEffect('user1', {
        Positions: [1, 2, 3],
      });
      expect((Res.PeekResult as { AtLeastOneBad: boolean }).AtLeastOneBad).toBe(
        false
      );
    });

    it('PEEK flags a real bad card (Melancídio)', async () => {
      const Snap = WithInteraction(
        GambitCard.CABECINHA,
        'SELECT_MULTIPLE_CARDS',
        3
      );
      Snap.Unrevealed[1].Effect = GambitCard.MELANCIDIO;
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      const Res = await Service.ResolveEffect('user1', {
        Positions: [1, 2, 3],
      });
      expect((Res.PeekResult as { AtLeastOneBad: boolean }).AtLeastOneBad).toBe(
        true
      );
    });

    it('REVEAL on a normal card shows its REAL effect (no disguise)', async () => {
      const Snap = WithInteraction(GambitCard.CLARIVIDENCIA, 'SELECT_CARD', 1);
      Snap.Unrevealed[2].Effect = GambitCard.DOBRO_DE_POTASSIO;
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      const Res = await Service.ResolveEffect('user1', { Positions: [2] });
      expect((Res.PeekResult as { Effect: GambitCard }).Effect).toBe(
        GambitCard.DOBRO_DE_POTASSIO
      );
    });

    it('REVEAL on a BUMIS_INFILTRADOS is deterministic (same fake on repeated peeks)', async () => {
      const Reveal = async () => {
        const Snap = WithInteraction(
          GambitCard.CLARIVIDENCIA,
          'SELECT_CARD',
          1
        );
        Snap.Unrevealed[3].Effect = GambitCard.BUMIS_INFILTRADOS;
        Repo.findOne.mockResolvedValue(
          BuildSession({ CurrentGridSnapshot: Snap })
        );
        const Res = await Service.ResolveEffect('user1', { Positions: [3] });
        return (Res.PeekResult as { Effect: GambitCard }).Effect;
      };
      expect(await Reveal()).toBe(await Reveal());
    });

    it('Burn is blocked while a PendingInteraction is open', async () => {
      const Snap = WithInteraction(
        GambitCard.CABECINHA,
        'SELECT_MULTIPLE_CARDS',
        3
      );
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      await expect(Service.Burn('user1', 0)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('Burn is blocked while a PendingEvent is open', async () => {
      const Snap = BuildSnapshot({
        PendingEvent: { GoodOptions: [], BadOptions: [] },
      });
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      await expect(Service.Burn('user1', 0)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('Burn fails when no burns are left', async () => {
      Repo.findOne.mockResolvedValue(
        BuildSession({ BurnSlotsAvailable: 3, ManualFlipsCount: 3 })
      );
      await expect(Service.Burn('user1', 0)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('Burn fails on an invalid/already-revealed position', async () => {
      Repo.findOne.mockResolvedValue(BuildSession());
      await expect(Service.Burn('user1', 999)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('reaching FirstEventFlip opens a selection event (and defers finalize)', async () => {
      Repo.findOne.mockResolvedValue(
        BuildSession({
          BurnSlotsAvailable: 10,
          ManualFlipsCount: 0,
          FirstEventFlip: 1,
        })
      );
      const View = await Service.Burn('user1', 0);
      expect(View.Grid.PendingEvent).not.toBeNull();
      expect(View.Status).toBe(GambitSessionStatus.InProgress);
    });

    it('an event on the LAST burn defers settlement until the event is resolved', async () => {
      Repo.findOne.mockResolvedValue(
        BuildSession({
          BurnSlotsAvailable: 1,
          ManualFlipsCount: 0,
          FirstEventFlip: 1,
        })
      );
      const AfterBurn = await Service.Burn('user1', 0);
      expect(AfterBurn.Status).toBe(GambitSessionStatus.InProgress);
      expect(AfterBurn.Grid.PendingEvent).not.toBeNull();

      const AfterResolve = await Service.ResolveEvent('user1', {
        GoodIndex: 0,
        BadIndex: 0,
      });
      expect(AfterResolve.Status).toBe(GambitSessionStatus.Finished);
    });

    it('ResolveEffect rejects the wrong number of positions', async () => {
      const Snap = WithInteraction(
        GambitCard.CABECINHA,
        'SELECT_MULTIPLE_CARDS',
        3
      );
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      await expect(
        Service.ResolveEffect('user1', { Positions: [0] })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ResolveEffect rejects duplicate positions', async () => {
      const Snap = WithInteraction(
        GambitCard.CABECINHA,
        'SELECT_MULTIPLE_CARDS',
        3
      );
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );
      await expect(
        Service.ResolveEffect('user1', { Positions: [1, 1, 2] })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('LOCK_GOOD_CARD locks a Good-tagged card, which can no longer be burned', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Effect = GambitCard.MENTE_LISA;
      Snap.Unrevealed[1].Effect = GambitCard.DOBRO_DE_POTASSIO;
      Repo.findOne.mockResolvedValue(
        BuildSession({ CurrentGridSnapshot: Snap })
      );

      const V1 = await Service.Burn('user1', 0);
      const Locked = V1.Grid.Unrevealed.find((C) => C.Position === 1);
      expect(Locked?.Locked).toBe(true);

      await expect(Service.Burn('user1', 1)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('HEADGEAR keeps an already-negative next card negative', async () => {
      const Snap = BuildSnapshot();
      Snap.Unrevealed[0].Points = -30;
      Repo.findOne.mockResolvedValue(
        BuildSession({
          NextEffect: GambitCard.HEADGEAR,
          CurrentGridSnapshot: Snap,
        })
      );
      const View = await Service.Burn('user1', 0);
      expect(View.AccumulatedPoints).toBe(-30);
    });
  });

  describe('FindAll', () => {
    it('returns sessions filtered by GambitTableId and UserId', async () => {
      const Sessions = [BuildSession()];
      Repo.find.mockResolvedValue(Sessions);

      const Result = await Service.FindAll(1, 'user1');

      expect(Repo.find).toHaveBeenCalledWith({
        where: { GambitTableId: 1, UserId: 'user1' },
      });
      expect(Result).toEqual(Sessions);
    });
  });

  describe('FindOne', () => {
    it('returns the session when found', async () => {
      const Session = BuildSession();
      Repo.findOne.mockResolvedValue(Session);

      const Result = await Service.FindOne(1, 1, 'user1');
      expect(Result).toEqual(Session);
    });

    it('throws NotFoundException when the session does not exist', async () => {
      Repo.findOne.mockResolvedValue(null);
      await expect(Service.FindOne(1, 99, 'user1')).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe('Update', () => {
    it('updates and returns the modified session', async () => {
      const Dto: UpdateGambitSessionDto = { CardsPurchased: 15 };
      Repo.findOne.mockResolvedValue(BuildSession());
      Repo.save.mockImplementation((s) => Promise.resolve(s));

      const Result = await Service.Update(1, 1, Dto, 'user1');
      expect(Result.CardsPurchased).toBe(15);
    });

    it('throws NotFoundException when the session does not exist', async () => {
      Repo.findOne.mockResolvedValue(null);
      await expect(Service.Update(1, 99, {}, 'user1')).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe('Remove', () => {
    it('removes the session and releases the registry lock', async () => {
      const Session = BuildSession();
      const { Mgr, Qr } = UseQueryRunner();
      Mgr.findOne.mockResolvedValue(Session);

      await expect(Service.Remove(1, 1, 'user1')).resolves.toBeUndefined();

      expect(Mgr.remove).toHaveBeenCalledWith(GambitSession, Session);
      expect(Registry.release).toHaveBeenCalledWith(Mgr, 'user1');
      expect(Qr.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException and rolls back when the session does not exist', async () => {
      const { Mgr, Qr } = UseQueryRunner();
      Mgr.findOne.mockResolvedValue(null);

      await expect(Service.Remove(1, 99, 'user1')).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(Qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
  });
});

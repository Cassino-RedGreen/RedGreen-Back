import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { SlotSessionService } from '../src/modules/slot-machine/sessions/application/slot-session.service';
import {
  SlotSession,
  SlotSessionStatus,
} from '../src/modules/slot-machine/sessions/domain/slot-session.entity';
import { SlotSymbol } from '../src/modules/slot-machine/sessions/domain/enums/slot-symbol.enum';
import type { SpinReelResult } from '../src/modules/slot-machine/sessions/domain/types/slot-session.types';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { SlotMachineService } from '../src/modules/slot-machine/application/slot-machine.service';
import { SlotMachine } from '../src/modules/slot-machine/domain/slot-machine.entity';
import { SlotMachineColor } from '../src/modules/slot-machine/domain/enums/slot-machine-color.enum';
import { CreateSlotSessionDto } from '../src/modules/slot-machine/sessions/domain/dto/create-slot-session.dto';
import { SessionRegistryService } from '../src/modules/sessions/application/session-registry.service';
import { User } from '../src/modules/auth/domain/user.entity';
import { ActiveSession } from '../src/modules/sessions/domain/active-session.entity';
import { GameType } from '../src/modules/sessions/domain/enums/game-type.enum';

type SlotSessionRepoMock = {
  create: jest.MockedFunction<(session: Partial<SlotSession>) => SlotSession>;
  save: jest.MockedFunction<(session: SlotSession) => Promise<SlotSession>>;
  findOne: jest.MockedFunction<
    (criteria: object) => Promise<SlotSession | null>
  >;
  find: jest.MockedFunction<(criteria: object) => Promise<SlotSession[]>>;
};

type AuthServiceMock = {
  GetChipBalance: jest.MockedFunction<
    (userId: string) => Promise<{ ChipBalance: number }>
  >;
  UpdateChipBalance: jest.MockedFunction<
    (userId: string, amount: number) => Promise<void>
  >;
};

type SlotMachineServiceMock = {
  FindOne: jest.MockedFunction<(id: number) => Promise<SlotMachine>>;
};

type SlotSessionServicePrivate = {
  calculateReward(reels: SpinReelResult[]): number;
  generateRandomReels(): SpinReelResult[];
};

type ManagerMock = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  increment: jest.Mock;
  decrement: jest.Mock;
  delete: jest.Mock;
  getRepository: jest.Mock;
};

type QueryRunnerMock = {
  connect: jest.Mock;
  isTransactionActive: boolean;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  manager: ManagerMock;
};

const MockCashOutSessionRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
};

const MockManagerForCashOut: ManagerMock = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  increment: jest.fn(),
  decrement: jest.fn(),
  delete: jest.fn(),
  getRepository: jest.fn().mockReturnValue(MockCashOutSessionRepo),
};

const MockQueryRunner: QueryRunnerMock = {
  connect: jest.fn(),
  isTransactionActive: true,
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: MockManagerForCashOut,
};

const MockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(MockQueryRunner),
};

const CallCalculateReward = (
  Service: SlotSessionService,
  Reels: SpinReelResult[]
): number =>
  (Service as unknown as SlotSessionServicePrivate).calculateReward(Reels);

const CallGenerateRandomReels = (
  Service: SlotSessionService
): SpinReelResult[] =>
  (Service as unknown as SlotSessionServicePrivate).generateRandomReels();

describe('SlotSessionService', () => {
  let Service: SlotSessionService;
  let AuthServiceMockInstance: AuthServiceMock;

  const MockSlotSessionRepo: SlotSessionRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const MockAuthService: AuthServiceMock = {
    GetChipBalance: jest.fn(),
    UpdateChipBalance: jest.fn(),
  };

  const MockSlotMachineService: SlotMachineServiceMock = {
    FindOne: jest.fn(),
  };

  const MockSessionRegistry = {
    acquire: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const Module: TestingModule = await Test.createTestingModule({
      providers: [
        SlotSessionService,
        {
          provide: getRepositoryToken(SlotSession),
          useValue: MockSlotSessionRepo,
        },
        {
          provide: DataSource,
          useValue: MockDataSource,
        },
        {
          provide: AuthService,
          useValue: MockAuthService,
        },
        {
          provide: SlotMachineService,
          useValue: MockSlotMachineService,
        },
        {
          provide: SessionRegistryService,
          useValue: MockSessionRegistry,
        },
      ],
    }).compile();

    Service = Module.get<SlotSessionService>(SlotSessionService);
    AuthServiceMockInstance = MockAuthService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateReward', () => {
    it('should return 0 when rat is present without cheese', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.Orange },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(0);
    });

    it('should return 5 for 3 oranges', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.Cheese },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(5);
    });

    it('should return 8 for 4 oranges', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.Orange },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(8);
    });

    it('should return 10 for 3 oranges-bundle', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 1, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 2, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 3, SymbolId: SlotSymbol.Cheese },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(10);
    });

    it('should return 15 for 4 oranges-bundle', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 1, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 2, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 3, SymbolId: SlotSymbol.Oranges },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(15);
    });

    it('should return 20 for 1 pig', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Pig },
        { ReelIndex: 1, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 2, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 3, SymbolId: SlotSymbol.Cheese },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(20);
    });

    it('should return 100 for 4 watermelons', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Watermelon },
        { ReelIndex: 1, SymbolId: SlotSymbol.Watermelon },
        { ReelIndex: 2, SymbolId: SlotSymbol.Watermelon },
        { ReelIndex: 3, SymbolId: SlotSymbol.Watermelon },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(100);
    });

    it('should double reward with TwoX', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(10);
    });

    it('should cancel rat effect with cheese', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.Orange },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(10);
    });

    it('should give bonus when cheese and rat are present', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 2, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 3, SymbolId: SlotSymbol.Cheese },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(10);
    });

    it('should apply TwoX multiplier after rat + cheese bonus', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 2, SymbolId: SlotSymbol.TwoX },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(20);
    });

    it('should handle multiple rats with cheese and multiplier', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 2, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(40);
    });

    it('should include egg symbol', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Egg },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 3, SymbolId: SlotSymbol.Egg },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(0);
    });

    it('should combine pig rewards with multiplier', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Pig },
        { ReelIndex: 1, SymbolId: SlotSymbol.Pig },
        { ReelIndex: 2, SymbolId: SlotSymbol.Pig },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(120);
    });

    it('should not reward rat when present alone or with other non-cheese symbols', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 2, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 3, SymbolId: SlotSymbol.Rat },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(0);
    });

    it('should combine orange and pig rewards', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.Pig },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(25);
    });

    it('should double combined rewards (oranges + multiplier)', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(10);
    });

    it('should handle oranges combined with pigs and multiplier', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 1, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 2, SymbolId: SlotSymbol.Pig },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(40);
    });

    it('should handle all oranges-bundle with multiplier', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 1, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 2, SymbolId: SlotSymbol.Oranges },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(20);
    });

    it('should zero reward when rat blocks everything with multiplier', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.TwoX },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(0);
    });

    it('should handle multiple cheese symbols with rats', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 2, SymbolId: SlotSymbol.Cheese },
        { ReelIndex: 3, SymbolId: SlotSymbol.Cheese },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(20);
    });

    it('should handle no matching symbols', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Egg },
        { ReelIndex: 1, SymbolId: SlotSymbol.Egg },
        { ReelIndex: 2, SymbolId: SlotSymbol.Egg },
        { ReelIndex: 3, SymbolId: SlotSymbol.Egg },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(0);
    });

    it('should apply rat + cheese bonus correctly', () => {
      const Reels: SpinReelResult[] = [
        { ReelIndex: 0, SymbolId: SlotSymbol.Rat },
        { ReelIndex: 1, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 2, SymbolId: SlotSymbol.Orange },
        { ReelIndex: 3, SymbolId: SlotSymbol.Cheese },
      ];
      expect(CallCalculateReward(Service, Reels)).toBe(10);
    });
  });

  describe('generateRandomReels', () => {
    it('should generate 4 reels', () => {
      const Result = CallGenerateRandomReels(Service);
      expect(Result).toHaveLength(4);
      expect(Result[0]).toHaveProperty('ReelIndex', 0);
      expect(Result[1]).toHaveProperty('ReelIndex', 1);
      expect(Result[2]).toHaveProperty('ReelIndex', 2);
      expect(Result[3]).toHaveProperty('ReelIndex', 3);
    });

    it('should have valid symbol IDs', () => {
      const Result = CallGenerateRandomReels(Service);
      const Symbols = Object.values(SlotSymbol);
      Result.forEach((Reel) => {
        expect(Symbols).toContain(Reel.SymbolId);
      });
    });

    it('should include all valid symbols in possible outcomes', () => {
      const Symbols = Object.values(SlotSymbol);
      expect(Symbols).toContain(SlotSymbol.Egg);
      expect(Symbols).toContain(SlotSymbol.Orange);
      expect(Symbols).toContain(SlotSymbol.Oranges);
      expect(Symbols).toContain(SlotSymbol.Watermelon);
      expect(Symbols).toContain(SlotSymbol.Rat);
      expect(Symbols).toContain(SlotSymbol.Cheese);
      expect(Symbols).toContain(SlotSymbol.TwoX);
      expect(Symbols).toContain(SlotSymbol.Pig);
      expect(Symbols.length).toBe(8);
    });

    it('should generate reels with different indices', () => {
      const Result = CallGenerateRandomReels(Service);
      const Indices = Result.map((Reel) => Reel.ReelIndex);
      expect(Indices).toEqual([0, 1, 2, 3]);
    });

    it('should select symbols according to configured probability', () => {
      const OriginalRandom = Math.random;
      try {
        const Values = [0.0, 0.3, 0.46, 0.52, 0.6, 0.75, 0.85, 0.95];
        const Expected = [
          SlotSymbol.Orange,
          SlotSymbol.Oranges,
          SlotSymbol.Pig,
          SlotSymbol.TwoX,
          SlotSymbol.Rat,
          SlotSymbol.Cheese,
          SlotSymbol.Watermelon,
          SlotSymbol.Egg,
        ];

        Values.forEach((V, I) => {
          jest.spyOn(Math, 'random').mockReturnValueOnce(V);
          const SelectedSymbol = (
            Service as unknown as SlotSessionServicePrivate
          ).generateRandomReels()[0].SymbolId;
          expect(SelectedSymbol).toBe(Expected[I]);
        });
      } finally {
        Math.random = OriginalRandom;
        jest.restoreAllMocks();
      }
    });
  });

  describe('create', () => {
    const MockSlotMachine: SlotMachine = {
      SlotMachineId: 1,
      Name: 'Test Machine',
      Description: 'Test machine',
      MinimumSpinValue: 10,
      MinimumChipsRequired: 0,
      MinimumRerollValue: 5,
      Active: true,
      TableColor: SlotMachineColor.White,
    };

    const SavedSlotSession = {
      SlotSessionId: 1,
      UserId: 'user1',
      SlotMachineId: 1,
      Status: SlotSessionStatus.InProgress,
      StartedAt: new Date(),
      LastInteractionAt: new Date(),
      EndedAt: null,
      CurrentRewardSnapshot: 0,
      CurrentSpinResult: { Reels: [] },
      CurrentRerollsSpent: { Rerolls: { Max: 5, Used: 0 } },
      DeletedAt: null,
    } as unknown as SlotSession;

    function setupCreateMocks(
      userChips = 100,
      existingActive: ActiveSession | null = null
    ) {
      MockManagerForCashOut.findOne.mockImplementation((entity: unknown) => {
        if (entity === SlotMachine) return Promise.resolve(MockSlotMachine);
        if (entity === ActiveSession) return Promise.resolve(existingActive);
        if (entity === User) return Promise.resolve({ ChipBalance: userChips });
        return Promise.resolve(null);
      });
      MockManagerForCashOut.decrement.mockResolvedValue(undefined);
      MockManagerForCashOut.create.mockReturnValue(SavedSlotSession);
      MockManagerForCashOut.save.mockResolvedValue(SavedSlotSession);
      MockSessionRegistry.acquire.mockResolvedValue(undefined);
      AuthServiceMockInstance.GetChipBalance.mockResolvedValue({
        ChipBalance: userChips - 10,
      });
    }

    it('should create session successfully', async () => {
      setupCreateMocks(100);

      const Dto = new CreateSlotSessionDto();
      const Result = await Service.create(1, Dto, 'user1');

      expect(Result).toHaveProperty('session');
      expect(Result).toHaveProperty('currentBalance');
      expect(MockManagerForCashOut.decrement).toHaveBeenCalledWith(
        User,
        { UserId: 'user1' },
        'ChipBalance',
        10
      );
      expect(MockSessionRegistry.acquire).toHaveBeenCalledWith(
        MockManagerForCashOut,
        'user1',
        GameType.Slot,
        SavedSlotSession.SlotSessionId
      );
      expect(MockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException when user already has an active session', async () => {
      const ExistingActive = {
        ActiveSessionId: 'x',
        UserId: 'user1',
      } as ActiveSession;
      setupCreateMocks(100, ExistingActive);

      const Dto = new CreateSlotSessionDto();
      await expect(Service.create(1, Dto, 'user1')).rejects.toThrow();
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(MockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when insufficient chips', async () => {
      setupCreateMocks(5); // below MinimumSpinValue of 10

      const Dto = new CreateSlotSessionDto();
      await expect(Service.create(1, Dto, 'user1')).rejects.toThrow(
        BadRequestException
      );
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('reroll', () => {
    const MockSlotMachine: SlotMachine = {
      SlotMachineId: 1,
      Name: 'Test Machine',
      Description: 'Test machine',
      MinimumSpinValue: 10,
      MinimumChipsRequired: 0,
      MinimumRerollValue: 5,
      Active: true,
      TableColor: SlotMachineColor.White,
    };

    const MockSessionForReroll = {
      SlotSessionId: 1,
      UserId: 'user1',
      SlotMachineId: 1,
      Status: SlotSessionStatus.InProgress,
      StartedAt: new Date(),
      LastInteractionAt: new Date(),
      EndedAt: null,
      CurrentRewardSnapshot: 0,
      CurrentSpinResult: {
        Reels: [
          { ReelIndex: 0, SymbolId: SlotSymbol.Cheese },
          { ReelIndex: 1, SymbolId: SlotSymbol.Cheese },
          { ReelIndex: 2, SymbolId: SlotSymbol.Cheese },
          { ReelIndex: 3, SymbolId: SlotSymbol.Cheese },
        ],
      },
      CurrentRerollsSpent: { Rerolls: { Max: 5, Used: 0 } },
      DeletedAt: null,
    } as unknown as SlotSession;

    function setupRerollMocks(
      session: SlotSession | null = MockSessionForReroll,
      userChips = 100
    ) {
      MockManagerForCashOut.findOne.mockImplementation((entity: unknown) => {
        if (entity === SlotSession) return Promise.resolve(session);
        if (entity === SlotMachine) return Promise.resolve(MockSlotMachine);
        if (entity === User) return Promise.resolve({ ChipBalance: userChips });
        return Promise.resolve(null);
      });
      MockManagerForCashOut.decrement.mockResolvedValue(undefined);
      MockManagerForCashOut.save.mockResolvedValue(session);
      AuthServiceMockInstance.GetChipBalance.mockResolvedValue({
        ChipBalance: userChips - 5,
      });
    }

    it('should reroll successfully', async () => {
      setupRerollMocks();

      const Result = await Service.reroll(1, 1, 0, 'user1');

      expect(Result).toHaveProperty('session');
      expect(Result).toHaveProperty('currentBalance');
      expect(MockManagerForCashOut.decrement).toHaveBeenCalledWith(
        User,
        { UserId: 'user1' },
        'ChipBalance',
        5
      );
      expect(MockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('should throw error when no rerolls left', async () => {
      const NoRerolls = {
        ...MockSessionForReroll,
        CurrentRerollsSpent: { Rerolls: { Max: 5, Used: 5 } },
      };
      setupRerollMocks(NoRerolls);

      await expect(Service.reroll(1, 1, 0, 'user1')).rejects.toThrow(
        'No rerolls left'
      );
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('should throw error when session is not active', async () => {
      const InactiveSession = {
        ...MockSessionForReroll,
        Status: SlotSessionStatus.Finished,
      };
      setupRerollMocks(InactiveSession);

      await expect(Service.reroll(1, 1, 0, 'user1')).rejects.toThrow(
        'Session is not active'
      );
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('should throw error when insufficient chips for reroll', async () => {
      setupRerollMocks(MockSessionForReroll, 2);

      await expect(Service.reroll(1, 1, 0, 'user1')).rejects.toThrow(
        'Insufficient chips to reroll'
      );
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('cashOut', () => {
    const SlotMachineId = 1;
    const SessionId = 10;
    const UserId = 'user1';

    const BuildActiveSession = (
      Overrides: Partial<SlotSession> = {}
    ): SlotSession =>
      ({
        SlotSessionId: SessionId,
        SlotMachineId,
        UserId,
        Status: SlotSessionStatus.InProgress,
        CurrentRewardSnapshot: 42,
        StartedAt: new Date(),
        LastInteractionAt: new Date(),
        EndedAt: null,
        CurrentSpinResult: { Reels: [] },
        CurrentRerollsSpent: { Rerolls: { Max: 5, Used: 0 } },
        DeletedAt: null,
        ...Overrides,
      }) as unknown as SlotSession;

    it('should credit reward atomically, end session, release registry, and commit', async () => {
      const ActiveSession = BuildActiveSession({ CurrentRewardSnapshot: 42 });
      MockCashOutSessionRepo.findOne.mockResolvedValue(ActiveSession);
      MockCashOutSessionRepo.save.mockImplementation((s) => Promise.resolve(s));
      MockManagerForCashOut.increment.mockResolvedValue(undefined);
      MockSessionRegistry.release.mockResolvedValue(undefined);
      AuthServiceMockInstance.GetChipBalance.mockResolvedValue({
        ChipBalance: 142,
      });

      const Result = await Service.cashOut(SlotMachineId, SessionId, UserId);

      expect(MockManagerForCashOut.increment).toHaveBeenCalledWith(
        User,
        { UserId },
        'ChipBalance',
        42
      );
      expect(AuthServiceMockInstance.UpdateChipBalance).not.toHaveBeenCalled();

      const SavedSession = (
        MockCashOutSessionRepo.save.mock.calls[0] as unknown[]
      )[0] as { Status: SlotSessionStatus; EndedAt: Date | null };
      expect(SavedSession.Status).toBe(SlotSessionStatus.CashedOut);
      expect(SavedSession.EndedAt).toBeInstanceOf(Date);

      expect(MockSessionRegistry.release).toHaveBeenCalledWith(
        MockManagerForCashOut,
        UserId
      );

      expect(MockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(MockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(MockQueryRunner.release).toHaveBeenCalledTimes(1);
      expect(Result).toEqual({
        message: 'Cash out successful',
        finalBalance: 142,
      });
    });

    it('should rollback when session is not active', async () => {
      const EndedSession = BuildActiveSession({
        Status: SlotSessionStatus.CashedOut,
      });
      MockCashOutSessionRepo.findOne.mockResolvedValue(EndedSession);

      await expect(
        Service.cashOut(SlotMachineId, SessionId, UserId)
      ).rejects.toThrow(BadRequestException);
      expect(MockManagerForCashOut.increment).not.toHaveBeenCalled();
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(MockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('should rollback when increment fails', async () => {
      const ActiveSession = BuildActiveSession({ CurrentRewardSnapshot: 42 });
      MockCashOutSessionRepo.findOne.mockResolvedValue(ActiveSession);
      MockManagerForCashOut.increment.mockRejectedValue(new Error('DB error'));

      await expect(
        Service.cashOut(SlotMachineId, SessionId, UserId)
      ).rejects.toThrow('DB error');
      expect(MockCashOutSessionRepo.save).not.toHaveBeenCalled();
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(MockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('should not save session when session not found', async () => {
      MockCashOutSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        Service.cashOut(SlotMachineId, SessionId, UserId)
      ).rejects.toThrow();
      expect(MockCashOutSessionRepo.save).not.toHaveBeenCalled();
      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });
});

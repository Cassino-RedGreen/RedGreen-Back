import {
  ConflictException,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { GambitSessionService } from '../src/modules/gambit/sessions/application/gambit-session.service';
import {
  GambitSession,
  GambitSessionStatus,
} from '../src/modules/gambit/sessions/domain/gambit-session.entity';
import { GambitTable } from '../src/modules/gambit/domain/gambit-table.entity';
import { GambitTableService } from '../src/modules/gambit/application/gambit-table.service';
import { SlotMachineService } from '../src/modules/slot-machine/application/slot-machine.service';
import {
  SlotSession,
  SlotSessionStatus,
} from '../src/modules/slot-machine/sessions/domain/slot-session.entity';
import { SlotMachine } from '../src/modules/slot-machine/domain/slot-machine.entity';
import { SessionRegistryService } from '../src/modules/sessions/application/session-registry.service';
import { GameType } from '../src/modules/sessions/domain/enums/game-type.enum';
import { User } from '../src/modules/auth/domain/user.entity';
import { AdminGuard } from '../src/core/guards/admin.guard';
import { UserType } from '../src/modules/auth/domain/user.entity';

function makeManagerMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    increment: jest.fn(),
    decrement: jest.fn(),
    getRepository: jest.fn(),
    ...overrides,
  };
}

function makeQueryRunnerMock(managerMock: ReturnType<typeof makeManagerMock>) {
  return {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: managerMock,
  };
}

function makeDataSourceMock(
  qrMock: ReturnType<typeof makeQueryRunnerMock>
): Partial<DataSource> {
  return { createQueryRunner: jest.fn().mockReturnValue(qrMock) };
}

const MockActiveSlotTable = {
  SlotMachineId: 1,
  Name: 'Test Slot',
  Description: null,
  MinimumSpinValue: 0,
  MinimumChipsRequired: 0,
  MinimumRerollValue: 0,
  Active: true,
} as unknown as SlotMachine;

const MockActiveGambitTable = {
  GambitTableId: 1,
  Name: 'Test Gambit',
  Description: null,
  MinimumChipsRequired: 0,
  CardPrice: 10,
  TableMultiplier: 1,
  MinimumCardsPurchased: 1,
  MaxCardsPurchased: 20,
  Active: true,
} as unknown as GambitTable;

describe('Criterion 1 – user with active slot session cannot open a gambit', () => {
  let gambitService: GambitSessionService;
  let qrMock: ReturnType<typeof makeQueryRunnerMock>;

  beforeEach(async () => {
    const managerMock = makeManagerMock();
    qrMock = makeQueryRunnerMock(managerMock);

    managerMock.findOne.mockImplementation((entity: unknown) => {
      if (entity === GambitTable) return Promise.resolve(MockActiveGambitTable);
      if (entity === User)
        return Promise.resolve({ UserId: 'user-1', ChipBalance: 1000 } as User);
      return Promise.resolve(null);
    });
    managerMock.create.mockReturnValue({ GambitSessionId: 1 });
    managerMock.save.mockResolvedValue({ GambitSessionId: 1 });
    managerMock.insert.mockRejectedValue({ code: '23505' });

    const mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };
    const registryService = new SessionRegistryService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GambitSessionService,
        { provide: getRepositoryToken(GambitSession), useValue: mockRepo },
        {
          provide: getRepositoryToken(GambitTable),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: makeDataSourceMock(qrMock) as DataSource,
        },
        { provide: SessionRegistryService, useValue: registryService },
      ],
    }).compile();

    gambitService = module.get<GambitSessionService>(GambitSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should throw ConflictException and not commit when user already has a session', async () => {
    await expect(
      gambitService.Create(1, { CardsPurchased: 5 }, 'user-1')
    ).rejects.toThrow(ConflictException);

    expect(qrMock.commitTransaction).not.toHaveBeenCalled();
    expect(qrMock.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('Criterion 2 – concurrent session-start: 23505 becomes ConflictException', () => {
  it('acquire() converts 23505 to ConflictException', async () => {
    const service = new SessionRegistryService();
    const mgr = makeManagerMock();
    mgr.insert.mockRejectedValue({ code: '23505' });

    await expect(
      service.acquire(
        mgr as unknown as EntityManager,
        'user-1',
        GameType.Slot,
        99
      )
    ).rejects.toThrow(ConflictException);
  });

  it('acquire() is called inside the create transaction so the DB enforces uniqueness', async () => {
    const managerMock = makeManagerMock();
    const qrMock = makeQueryRunnerMock(managerMock);

    managerMock.findOne.mockResolvedValue(null);
    managerMock.create.mockReturnValue({ GambitSessionId: 1 });
    managerMock.save.mockResolvedValue({ GambitSessionId: 1 });
    managerMock.insert.mockResolvedValue(undefined);

    managerMock.findOne.mockImplementation((entity: unknown) => {
      if (entity === GambitTable) return Promise.resolve(MockActiveGambitTable);
      if (entity === User)
        return Promise.resolve({ UserId: 'user-1', ChipBalance: 1000 } as User);
      return Promise.resolve(null);
    });

    const registryMock = {
      acquire: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    const mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GambitSessionService,
        { provide: getRepositoryToken(GambitSession), useValue: mockRepo },
        {
          provide: getRepositoryToken(GambitTable),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: makeDataSourceMock(qrMock) as DataSource,
        },
        { provide: SessionRegistryService, useValue: registryMock },
      ],
    }).compile();

    const service = module.get<GambitSessionService>(GambitSessionService);
    await service.Create(1, { CardsPurchased: 5 }, 'user-1');

    expect(registryMock.acquire).toHaveBeenCalledWith(
      managerMock,
      'user-1',
      GameType.Gambit,
      1
    );
    expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('Criterion 3 – admin deactivates slot machine with 3 InProgress sessions', () => {
  const UserId1 = 'user-a';
  const UserId2 = 'user-b';
  const UserId3 = 'user-c';

  const Sessions: SlotSession[] = [
    {
      SlotSessionId: 1,
      UserId: UserId1,
      CurrentRewardSnapshot: 10,
      Status: SlotSessionStatus.InProgress,
    } as SlotSession,
    {
      SlotSessionId: 2,
      UserId: UserId2,
      CurrentRewardSnapshot: 25,
      Status: SlotSessionStatus.InProgress,
    } as SlotSession,
    {
      SlotSessionId: 3,
      UserId: UserId3,
      CurrentRewardSnapshot: 0,
      Status: SlotSessionStatus.InProgress,
    } as SlotSession,
  ];

  let slotMachineService: SlotMachineService;
  let registryMock: { acquire: jest.Mock; release: jest.Mock };
  let managerMock: ReturnType<typeof makeManagerMock>;
  let qrMock: ReturnType<typeof makeQueryRunnerMock>;

  beforeEach(async () => {
    managerMock = makeManagerMock();
    qrMock = makeQueryRunnerMock(managerMock);
    registryMock = {
      acquire: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };

    managerMock.findOne.mockResolvedValue({ ...MockActiveSlotTable });
    managerMock.save.mockResolvedValue(undefined);
    managerMock.find.mockResolvedValue(Sessions);
    managerMock.increment.mockResolvedValue(undefined);

    const mockSlotMachineRepo = {
      findOneBy: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    };
    const mockSlotSessionRepo = {
      find: jest.fn().mockResolvedValue(Sessions),
      count: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlotMachineService,
        {
          provide: getRepositoryToken(SlotMachine),
          useValue: mockSlotMachineRepo,
        },
        {
          provide: getRepositoryToken(SlotSession),
          useValue: mockSlotSessionRepo,
        },
        {
          provide: DataSource,
          useValue: makeDataSourceMock(qrMock) as DataSource,
        },
        { provide: SessionRegistryService, useValue: registryMock },
      ],
    }).compile();

    slotMachineService = module.get<SlotMachineService>(SlotMachineService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should deactivate machine, cashout all 3, credit balances, and release registry', async () => {
    const result = await slotMachineService.AdminDeactivate(1);

    expect(result.ClosedSessions).toBe(3);
    expect(result.ChipsReturned).toBe(35); // 10 + 25 + 0

    expect(managerMock.save).toHaveBeenCalledWith(
      SlotMachine,
      expect.objectContaining({ Active: false })
    );

    expect(managerMock.save).toHaveBeenCalledTimes(4);
    Sessions.forEach((session) => {
      expect(managerMock.save).toHaveBeenCalledWith(
        SlotSession,
        expect.objectContaining({
          SlotSessionId: session.SlotSessionId,
          Status: SlotSessionStatus.CashedOut,
        })
      );
      expect(session.EndedAt).toBeInstanceOf(Date);
    });

    expect(managerMock.increment).toHaveBeenCalledTimes(3);
    expect(managerMock.increment).toHaveBeenCalledWith(
      User,
      { UserId: UserId1 },
      'ChipBalance',
      10
    );
    expect(managerMock.increment).toHaveBeenCalledWith(
      User,
      { UserId: UserId2 },
      'ChipBalance',
      25
    );
    expect(managerMock.increment).toHaveBeenCalledWith(
      User,
      { UserId: UserId3 },
      'ChipBalance',
      0
    );

    expect(registryMock.release).toHaveBeenCalledTimes(3);
    expect(registryMock.release).toHaveBeenCalledWith(managerMock, UserId1);
    expect(registryMock.release).toHaveBeenCalledWith(managerMock, UserId2);
    expect(registryMock.release).toHaveBeenCalledWith(managerMock, UserId3);

    expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('Criterion 4 – gambit admin deactivate: credits Result when Result is not null', () => {
  const SessionWithResult: GambitSession = {
    GambitSessionId: 1,
    UserId: 'user-x',
    GambitTableId: 1,
    CardsPurchased: 5,
    Result: 80,
    Status: GambitSessionStatus.InProgress,
    GambitTable: { ...MockActiveGambitTable },
  } as GambitSession;

  let gambitTableService: GambitTableService;
  let managerMock: ReturnType<typeof makeManagerMock>;
  let qrMock: ReturnType<typeof makeQueryRunnerMock>;
  let registryMock: { acquire: jest.Mock; release: jest.Mock };

  beforeEach(async () => {
    managerMock = makeManagerMock();
    qrMock = makeQueryRunnerMock(managerMock);
    registryMock = {
      acquire: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };

    managerMock.findOne.mockResolvedValue({ ...MockActiveGambitTable });
    managerMock.save.mockResolvedValue(undefined);
    managerMock.find.mockResolvedValue([SessionWithResult]);
    managerMock.increment.mockResolvedValue(undefined);

    const mockGambitTableRepo = {
      findOneBy: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    const mockGambitSessionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GambitTableService,
        {
          provide: getRepositoryToken(GambitTable),
          useValue: mockGambitTableRepo,
        },
        {
          provide: getRepositoryToken(GambitSession),
          useValue: mockGambitSessionRepo,
        },
        {
          provide: DataSource,
          useValue: makeDataSourceMock(qrMock) as DataSource,
        },
        { provide: SessionRegistryService, useValue: registryMock },
      ],
    }).compile();

    gambitTableService = module.get<GambitTableService>(GambitTableService);
  });

  afterEach(() => jest.clearAllMocks());

  it('credits Result (80) when Result is not null', async () => {
    const result = await gambitTableService.AdminDeactivate(1);

    expect(result.ChipsReturned).toBe(80);
    expect(managerMock.increment).toHaveBeenCalledWith(
      User,
      { UserId: 'user-x' },
      'ChipBalance',
      80
    );
    expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('Criterion 5 – gambit admin deactivate: refunds CardsPurchased*CardPrice when Result is null', () => {
  const SessionMidGame: GambitSession = {
    GambitSessionId: 2,
    UserId: 'user-y',
    GambitTableId: 1,
    CardsPurchased: 7,
    Result: null,
    Status: GambitSessionStatus.InProgress,
    GambitTable: { ...MockActiveGambitTable, CardPrice: 10 }, // 7 * 10 = 70
  } as GambitSession;

  let gambitTableService: GambitTableService;
  let managerMock: ReturnType<typeof makeManagerMock>;
  let qrMock: ReturnType<typeof makeQueryRunnerMock>;
  let registryMock: { acquire: jest.Mock; release: jest.Mock };

  beforeEach(async () => {
    managerMock = makeManagerMock();
    qrMock = makeQueryRunnerMock(managerMock);
    registryMock = {
      acquire: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };

    managerMock.findOne.mockResolvedValue({ ...MockActiveGambitTable });
    managerMock.save.mockResolvedValue(undefined);
    managerMock.find.mockResolvedValue([SessionMidGame]);
    managerMock.increment.mockResolvedValue(undefined);

    const mockGambitTableRepo = {
      findOneBy: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    const mockGambitSessionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GambitTableService,
        {
          provide: getRepositoryToken(GambitTable),
          useValue: mockGambitTableRepo,
        },
        {
          provide: getRepositoryToken(GambitSession),
          useValue: mockGambitSessionRepo,
        },
        {
          provide: DataSource,
          useValue: makeDataSourceMock(qrMock) as DataSource,
        },
        { provide: SessionRegistryService, useValue: registryMock },
      ],
    }).compile();

    gambitTableService = module.get<GambitTableService>(GambitTableService);
  });

  afterEach(() => jest.clearAllMocks());

  it('credits CardsPurchased * CardPrice (70) when Result is null', async () => {
    const result = await gambitTableService.AdminDeactivate(1);

    expect(result.ChipsReturned).toBe(70);
    expect(managerMock.increment).toHaveBeenCalledWith(
      User,
      { UserId: 'user-y' },
      'ChipBalance',
      70
    );
    expect(qrMock.commitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('Criterion 6 – non-admin cannot call deactivate', () => {
  it('AdminGuard throws for non-admin user', async () => {
    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { UserId: 'regular-user', UserType: UserType.USER },
        }),
      }),
    };

    const guard = new AdminGuard();

    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockResolvedValue(true);

    await expect(
      guard.canActivate(mockExecutionContext as unknown as ExecutionContext)
    ).rejects.toThrow(UnauthorizedException);
  });

  it('AdminGuard passes for admin user', async () => {
    const mockExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { UserId: 'admin-user', UserType: UserType.ADMIN },
        }),
      }),
    };

    const guard = new AdminGuard();

    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockResolvedValue(true);

    const result = await guard.canActivate(
      mockExecutionContext as unknown as ExecutionContext
    );
    expect(result).toBe(true);
  });
});

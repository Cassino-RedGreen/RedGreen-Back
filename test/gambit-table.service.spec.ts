import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GambitTableService } from '../src/modules/gambit/application/gambit-table.service';
import { SessionRegistryService } from '../src/modules/sessions/application/session-registry.service';
import { GambitTable } from '../src/modules/gambit/domain/gambit-table.entity';
import {
  GambitSession,
  GambitSessionStatus,
} from '../src/modules/gambit/sessions/domain/gambit-session.entity';
import { CreateGambitTableDto } from '../src/modules/gambit/domain/dto/create-gambit-table.dto';
import { UpdateGambitTableDto } from '../src/modules/gambit/domain/dto/update-gambit-table.dto';

type GambitTableRepoMock = {
  create: jest.MockedFunction<(table: Partial<GambitTable>) => GambitTable>;
  save: jest.MockedFunction<(table: GambitTable) => Promise<GambitTable>>;
  remove: jest.MockedFunction<(table: GambitTable) => Promise<GambitTable>>;
  find: jest.MockedFunction<() => Promise<GambitTable[]>>;
  findOneBy: jest.MockedFunction<
    (criteria: object) => Promise<GambitTable | null>
  >;
};

type GambitSessionRepoMock = {
  findOne: jest.MockedFunction<
    (criteria: object) => Promise<GambitSession | null>
  >;
  find: jest.MockedFunction<(criteria: object) => Promise<GambitSession[]>>;
};

type TransactionManagerMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  save: jest.Mock;
  increment: jest.Mock;
};

const MockManager: TransactionManagerMock = {
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  increment: jest.fn(),
};

const MockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: MockManager,
};

const MockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(MockQueryRunner),
};

const MockSessionRegistry = {
  acquire: jest.fn(),
  release: jest.fn(),
};

const MockTable: GambitTable = {
  GambitTableId: 1,
  Name: 'High Stakes Gambit',
  Description: 'A high-stakes card flipping game',
  MinimumChipsRequired: 100,
  CardPrice: 10,
  TableMultiplier: 1,
  MinimumCardsPurchased: 5,
  MaxCardsPurchased: 20,
  Active: true,
};

const MockActiveSession = {
  GambitSessionId: 1,
  GambitTableId: 1,
  Status: GambitSessionStatus.InProgress,
} as GambitSession;

describe('GambitTableService', () => {
  let service: GambitTableService;
  let tableRepo: GambitTableRepoMock;
  let sessionRepo: GambitSessionRepoMock;

  const MockTableRepo: GambitTableRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
  };

  const MockSessionRepo: GambitSessionRepoMock = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GambitTableService,
        {
          provide: getRepositoryToken(GambitTable),
          useValue: MockTableRepo,
        },
        {
          provide: getRepositoryToken(GambitSession),
          useValue: MockSessionRepo,
        },
        {
          provide: DataSource,
          useValue: MockDataSource,
        },
        {
          provide: SessionRegistryService,
          useValue: MockSessionRegistry,
        },
      ],
    }).compile();

    service = module.get<GambitTableService>(GambitTableService);
    tableRepo = MockTableRepo;
    sessionRepo = MockSessionRepo;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Create', () => {
    it('should create and return a new gambit table', async () => {
      const Dto: CreateGambitTableDto = {
        Name: 'High Stakes Gambit',
        CardPrice: 10,
        MinimumCardsPurchased: 5,
      };
      tableRepo.create.mockReturnValue(MockTable);
      tableRepo.save.mockResolvedValue(MockTable);

      const Result = await service.Create(Dto);

      expect(tableRepo.create).toHaveBeenCalledWith(Dto);
      expect(tableRepo.save).toHaveBeenCalledWith(MockTable);
      expect(Result).toEqual(MockTable);
    });
  });

  describe('FindAll', () => {
    it('should return all gambit tables', async () => {
      tableRepo.find.mockResolvedValue([MockTable]);

      const Result = await service.FindAll();

      expect(tableRepo.find).toHaveBeenCalled();
      expect(Result).toEqual([MockTable]);
    });
  });

  describe('FindOne', () => {
    it('should return the table when found', async () => {
      tableRepo.findOneBy.mockResolvedValue(MockTable);

      const Result = await service.FindOne(1);

      expect(tableRepo.findOneBy).toHaveBeenCalledWith({ GambitTableId: 1 });
      expect(Result).toEqual(MockTable);
    });

    it('should throw NotFoundException when table does not exist', async () => {
      tableRepo.findOneBy.mockResolvedValue(null);

      await expect(service.FindOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('Update', () => {
    it('should apply every provided configuration field', async () => {
      const Dto: UpdateGambitTableDto = {
        Name: 'Updated Table',
        Description: 'Updated description',
        MinimumChipsRequired: 250,
        CardPrice: 25,
        TableMultiplier: 2,
        MinimumCardsPurchased: 6,
        MaxCardsPurchased: 30,
      };
      const Table = { ...MockTable };
      tableRepo.findOneBy.mockResolvedValue(Table);
      tableRepo.save.mockImplementation((Saved) => Promise.resolve(Saved));

      const Result = await service.Update(1, Dto);

      expect(Result).toMatchObject(Dto);
      expect(tableRepo.save).toHaveBeenCalledWith(expect.objectContaining(Dto));
    });

    it('should update only the provided fields', async () => {
      const Dto: UpdateGambitTableDto = { Name: 'Updated Name', CardPrice: 20 };
      const UpdatedTable = {
        ...MockTable,
        Name: 'Updated Name',
        CardPrice: 20,
      };
      tableRepo.findOneBy.mockResolvedValue({ ...MockTable });
      tableRepo.save.mockResolvedValue(UpdatedTable);

      const Result = await service.Update(1, Dto);

      expect(tableRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ Name: 'Updated Name', CardPrice: 20 })
      );
      expect(Result.Name).toBe('Updated Name');
      expect(Result.CardPrice).toBe(20);
    });

    it('should not overwrite fields that are not in the DTO', async () => {
      const Dto: UpdateGambitTableDto = { Name: 'Only Name Changed' };
      tableRepo.findOneBy.mockResolvedValue({ ...MockTable });
      tableRepo.save.mockImplementation((table) => Promise.resolve(table));

      await service.Update(1, Dto);

      expect(tableRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          CardPrice: MockTable.CardPrice,
          TableMultiplier: MockTable.TableMultiplier,
        })
      );
    });

    it('should throw NotFoundException when table does not exist', async () => {
      tableRepo.findOneBy.mockResolvedValue(null);

      await expect(service.Update(99, { Name: 'X' })).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('Remove', () => {
    it('should delete the table record', async () => {
      tableRepo.findOneBy.mockResolvedValue({ ...MockTable });
      sessionRepo.findOne.mockResolvedValue(null);
      tableRepo.remove.mockResolvedValue(MockTable);

      await service.Remove(1);

      expect(tableRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ GambitTableId: 1 })
      );
    });

    it('should throw BadRequestException when table has an active session', async () => {
      tableRepo.findOneBy.mockResolvedValue({ ...MockTable });
      sessionRepo.findOne.mockResolvedValue(MockActiveSession);

      await expect(service.Remove(1)).rejects.toThrow(BadRequestException);
      expect(tableRepo.save).not.toHaveBeenCalled();
      expect(tableRepo.remove).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when table does not exist', async () => {
      tableRepo.findOneBy.mockResolvedValue(null);

      await expect(service.Remove(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('Deactivate', () => {
    it('should toggle the table Active status', async () => {
      tableRepo.findOneBy.mockResolvedValue({ ...MockTable });
      tableRepo.save.mockImplementation((table) => Promise.resolve(table));

      const Result = await service.Deactivate(1);

      expect(tableRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ Active: false })
      );
      expect(Result.Active).toBe(false);
    });

    it('should reactivate an inactive table', async () => {
      tableRepo.findOneBy.mockResolvedValue({ ...MockTable, Active: false });
      tableRepo.save.mockImplementation((table) => Promise.resolve(table));

      const Result = await service.Deactivate(1);

      expect(Result.Active).toBe(true);
    });

    it('should throw NotFoundException when table does not exist', async () => {
      tableRepo.findOneBy.mockResolvedValue(null);

      await expect(service.Deactivate(99)).rejects.toThrow(NotFoundException);
    });

    describe('FindActiveSessions', () => {
      it('should use the result when set and otherwise calculate potential payout', async () => {
        const Sessions = [
          {
            UserId: 'user-1',
            User: { Nickname: 'Player One' },
            Status: GambitSessionStatus.InProgress,
            Result: 120,
            CardsPurchased: 5,
            GambitTable: { CardPrice: 10 },
          },
          {
            UserId: 'user-2',
            User: { Nickname: 'Player Two' },
            Status: GambitSessionStatus.InProgress,
            Result: null,
            CardsPurchased: 8,
            GambitTable: { CardPrice: 10 },
          },
        ] as GambitSession[];
        tableRepo.findOneBy.mockResolvedValue(MockTable);
        sessionRepo.find.mockResolvedValue(Sessions);

        await expect(service.FindActiveSessions(1)).resolves.toEqual([
          {
            UserId: 'user-1',
            Nickname: 'Player One',
            Status: GambitSessionStatus.InProgress,
            PotentialPayout: 120,
          },
          {
            UserId: 'user-2',
            Nickname: 'Player Two',
            Status: GambitSessionStatus.InProgress,
            PotentialPayout: 80,
          },
        ]);
        expect(sessionRepo.find).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              GambitTableId: 1,
              Status: GambitSessionStatus.InProgress,
            },
            relations: { GambitTable: true, User: true },
          })
        );
      });
    });

    describe('AdminDeactivate', () => {
      it('should refund and close active sessions in a transaction', async () => {
        const Table = { ...MockTable };
        const Sessions = [
          {
            UserId: 'user-1',
            Result: 120,
            CardsPurchased: 5,
            Status: GambitSessionStatus.InProgress,
          },
          {
            UserId: 'user-2',
            Result: null,
            CardsPurchased: 8,
            Status: GambitSessionStatus.InProgress,
          },
        ] as GambitSession[];
        MockManager.findOne.mockResolvedValue(Table);
        MockManager.find.mockResolvedValue(Sessions);
        MockManager.save.mockImplementation(
          (_Entity: unknown, Record: unknown) => Promise.resolve(Record)
        );
        MockManager.increment.mockResolvedValue(undefined);
        MockSessionRegistry.release.mockResolvedValue(undefined);

        await expect(service.AdminDeactivate(1)).resolves.toEqual({
          ClosedSessions: 2,
          ChipsReturned: 200,
        });

        expect(Table.Active).toBe(false);
        expect(MockManager.increment).toHaveBeenNthCalledWith(
          1,
          expect.anything(),
          { UserId: 'user-1' },
          'ChipBalance',
          120
        );
        expect(MockManager.increment).toHaveBeenNthCalledWith(
          2,
          expect.anything(),
          { UserId: 'user-2' },
          'ChipBalance',
          80
        );
        expect(
          Sessions.every((Session) => Session.UpdatedAt instanceof Date)
        ).toBe(true);
        expect(MockSessionRegistry.release).toHaveBeenCalledTimes(2);
        expect(MockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
        expect(MockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
        expect(MockQueryRunner.release).toHaveBeenCalledTimes(1);
      });

      it('should rollback when the table does not exist', async () => {
        MockManager.findOne.mockResolvedValue(null);

        await expect(service.AdminDeactivate(99)).rejects.toThrow(
          NotFoundException
        );

        expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(MockQueryRunner.release).toHaveBeenCalledTimes(1);
        expect(MockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      });
    });
  });
});

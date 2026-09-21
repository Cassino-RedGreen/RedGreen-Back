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
          useValue: { createQueryRunner: jest.fn() },
        },
        {
          provide: SessionRegistryService,
          useValue: { acquire: jest.fn(), release: jest.fn() },
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
  });
});

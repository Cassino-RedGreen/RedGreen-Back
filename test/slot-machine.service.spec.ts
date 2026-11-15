import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SessionRegistryService } from '../src/modules/sessions/application/session-registry.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SlotMachineService } from '../src/modules/slot-machine/application/slot-machine.service';
import { SlotMachine } from '../src/modules/slot-machine/domain/slot-machine.entity';
import {
  SlotSession,
  SlotSessionStatus,
} from '../src/modules/slot-machine/sessions/domain/slot-session.entity';
import { CreateSlotMachineDto } from '../src/modules/slot-machine/domain/dto/create-slot-machine.dto';
import { UpdateSlotMachineDto } from '../src/modules/slot-machine/domain/dto/update-slot-machine.dto';
import { SlotMachineColor } from '../src/modules/slot-machine/domain/enums/slot-machine-color.enum';

type SlotMachineRepoMock = {
  create: jest.MockedFunction<(dto: Partial<SlotMachine>) => SlotMachine>;
  save: jest.MockedFunction<(entity: SlotMachine) => Promise<SlotMachine>>;
  find: jest.MockedFunction<() => Promise<SlotMachine[]>>;
  findOneBy: jest.MockedFunction<
    (criteria: object) => Promise<SlotMachine | null>
  >;
  remove: jest.MockedFunction<(entity: SlotMachine) => Promise<SlotMachine>>;
  count: jest.MockedFunction<(criteria: object) => Promise<number>>;
};

type SlotSessionRepoMock = {
  count: jest.MockedFunction<(criteria: object) => Promise<number>>;
  find: jest.MockedFunction<(criteria: object) => Promise<SlotSession[]>>;
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

const BuildMachine = (overrides: Partial<SlotMachine> = {}): SlotMachine => ({
  SlotMachineId: 1,
  Name: 'Test Machine',
  Description: null,
  MinimumSpinValue: null,
  MinimumChipsRequired: null,
  MinimumRerollValue: null,
  Active: true,
  TableColor: SlotMachineColor.White,
  ...overrides,
});

describe('SlotMachineService', () => {
  let Service: SlotMachineService;
  let SlotMachineRepo: SlotMachineRepoMock;
  let SlotSessionRepo: SlotSessionRepoMock;

  const MockSlotMachineRepo: SlotMachineRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
  };

  const MockSlotSessionRepo: SlotSessionRepoMock = {
    count: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const Module: TestingModule = await Test.createTestingModule({
      providers: [
        SlotMachineService,
        {
          provide: getRepositoryToken(SlotMachine),
          useValue: MockSlotMachineRepo,
        },
        {
          provide: getRepositoryToken(SlotSession),
          useValue: MockSlotSessionRepo,
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

    Service = Module.get<SlotMachineService>(SlotMachineService);
    SlotMachineRepo = MockSlotMachineRepo;
    SlotSessionRepo = MockSlotSessionRepo;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('FindAll', () => {
    it('should return all slot machines', async () => {
      const Machines = [BuildMachine()];
      SlotMachineRepo.find.mockResolvedValue(Machines);

      await expect(Service.FindAll()).resolves.toBe(Machines);
      expect(SlotMachineRepo.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('FindOne', () => {
    it('should throw when the requested machine does not exist', async () => {
      SlotMachineRepo.findOneBy.mockResolvedValue(null);

      await expect(Service.FindOne(99)).rejects.toThrow(
        'SlotMachine with ID 99 not found'
      );
    });
  });

  describe('CreateSlotMachineDto validation — TableColor', () => {
    it('should pass validation with a valid TableColor enum value', async () => {
      const Dto = plainToInstance(CreateSlotMachineDto, {
        Name: 'Lucky Slots',
        TableColor: SlotMachineColor.Gold,
      });

      const Errors = await validate(Dto);
      const ColorError = Errors.find((e) => e.property === 'TableColor');
      expect(ColorError).toBeUndefined();
    });

    it('should fail validation with an invalid TableColor value', async () => {
      const Dto = plainToInstance(CreateSlotMachineDto, {
        Name: 'Lucky Slots',
        TableColor: 'InvalidColor',
      });

      const Errors = await validate(Dto);
      const ColorError = Errors.find((e) => e.property === 'TableColor');
      expect(ColorError).toBeDefined();
      expect(ColorError?.constraints).toHaveProperty('isEnum');
    });

    it('should pass validation when TableColor is omitted (field is optional)', async () => {
      const Dto = plainToInstance(CreateSlotMachineDto, {
        Name: 'Lucky Slots',
      });

      const Errors = await validate(Dto);
      const ColorError = Errors.find((e) => e.property === 'TableColor');
      expect(ColorError).toBeUndefined();
    });
  });

  describe('Create', () => {
    it('should create a slot machine with a specified TableColor', async () => {
      const Dto: CreateSlotMachineDto = {
        Name: 'Golden Machine',
        TableColor: SlotMachineColor.Gold,
      } as CreateSlotMachineDto;

      const CreatedEntity = BuildMachine({
        Name: 'Golden Machine',
        TableColor: SlotMachineColor.Gold,
      });
      const SavedEntity = { ...CreatedEntity };

      SlotMachineRepo.create.mockReturnValue(CreatedEntity);
      SlotMachineRepo.save.mockResolvedValue(SavedEntity);

      const Result = await Service.Create(Dto);

      expect(SlotMachineRepo.create).toHaveBeenCalledWith(Dto);
      expect(SlotMachineRepo.save).toHaveBeenCalledWith(CreatedEntity);
      expect(Result.TableColor).toBe(SlotMachineColor.Gold);
    });

    it('should default TableColor to White when not provided', async () => {
      const Dto: CreateSlotMachineDto = {
        Name: 'Plain Machine',
      } as CreateSlotMachineDto;

      const CreatedEntity = BuildMachine({
        Name: 'Plain Machine',
        TableColor: SlotMachineColor.White,
      });
      const SavedEntity = { ...CreatedEntity };

      SlotMachineRepo.create.mockReturnValue(CreatedEntity);
      SlotMachineRepo.save.mockResolvedValue(SavedEntity);

      const Result = await Service.Create(Dto);

      expect(Result.TableColor).toBe(SlotMachineColor.White);
    });
  });

  describe('Update', () => {
    it('should apply every provided configuration field', async () => {
      const Machine = BuildMachine();
      const Dto: UpdateSlotMachineDto = {
        Name: 'Updated machine',
        Description: 'Updated description',
        MinimumSpinValue: 5,
        MinimumChipsRequired: 20,
        MinimumRerollValue: 2,
        TableColor: SlotMachineColor.Diamond,
      };
      SlotMachineRepo.findOneBy.mockResolvedValue(Machine);
      SlotMachineRepo.save.mockImplementation((Saved) =>
        Promise.resolve(Saved)
      );

      const Result = await Service.Update(1, Dto);

      expect(Result).toMatchObject(Dto);
      expect(SlotMachineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining(Dto)
      );
    });

    it('should update TableColor on an existing SlotMachine', async () => {
      const ExistingMachine = BuildMachine({
        TableColor: SlotMachineColor.White,
      });
      const UpdateDto: UpdateSlotMachineDto = {
        TableColor: SlotMachineColor.Diamond,
      };
      const UpdatedMachine = {
        ...ExistingMachine,
        TableColor: SlotMachineColor.Diamond,
      };

      SlotMachineRepo.findOneBy.mockResolvedValue(ExistingMachine);
      SlotMachineRepo.save.mockResolvedValue(UpdatedMachine);

      const Result = await Service.Update(1, UpdateDto);

      expect(SlotMachineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ TableColor: SlotMachineColor.Diamond })
      );
      expect(Result.TableColor).toBe(SlotMachineColor.Diamond);
    });
  });

  describe('Deactivate', () => {
    it('should deactivate an active machine', async () => {
      const Machine = BuildMachine({ Active: true });
      SlotMachineRepo.findOneBy.mockResolvedValue(Machine);
      SlotMachineRepo.save.mockImplementation((Saved) =>
        Promise.resolve(Saved)
      );

      await expect(Service.Deactivate(1)).resolves.toMatchObject({
        Active: false,
      });
    });

    it('should reactivate an inactive machine', async () => {
      const Machine = BuildMachine({ Active: false });
      SlotMachineRepo.findOneBy.mockResolvedValue(Machine);
      SlotMachineRepo.save.mockImplementation((Saved) =>
        Promise.resolve(Saved)
      );

      await expect(Service.Deactivate(1)).resolves.toMatchObject({
        Active: true,
      });
    });
  });

  describe('FindActiveSessions', () => {
    it('should return the active sessions with user-facing fields', async () => {
      const Session = {
        UserId: 'user-1',
        User: { Nickname: 'Player One' },
        Status: SlotSessionStatus.InProgress,
        CurrentRewardSnapshot: 75,
      } as SlotSession;
      SlotMachineRepo.findOneBy.mockResolvedValue(BuildMachine());
      SlotSessionRepo.find.mockResolvedValue([Session]);

      await expect(Service.FindActiveSessions(1)).resolves.toEqual([
        {
          UserId: 'user-1',
          Nickname: 'Player One',
          Status: SlotSessionStatus.InProgress,
          PotentialPayout: 75,
        },
      ]);
      const Criteria = SlotSessionRepo.find.mock.calls[0]?.[0];
      expect(Criteria).toHaveProperty('where.SlotMachineId', 1);
      expect(Criteria).toHaveProperty(
        'where.Status',
        SlotSessionStatus.InProgress
      );
      expect(Criteria).toHaveProperty('relations.User', true);
    });
  });

  describe('AdminDeactivate', () => {
    it('should refund and close every active session in a transaction', async () => {
      const Machine = BuildMachine({ Active: true });
      const Sessions = [
        {
          UserId: 'user-1',
          CurrentRewardSnapshot: 30,
          Status: SlotSessionStatus.InProgress,
        },
        {
          UserId: 'user-2',
          CurrentRewardSnapshot: 45,
          Status: SlotSessionStatus.InProgress,
        },
      ] as SlotSession[];
      MockManager.findOne.mockResolvedValue(Machine);
      MockManager.find.mockResolvedValue(Sessions);
      MockManager.save.mockImplementation((_Entity: unknown, Record: unknown) =>
        Promise.resolve(Record)
      );
      MockManager.increment.mockResolvedValue(undefined);
      MockSessionRegistry.release.mockResolvedValue(undefined);

      await expect(Service.AdminDeactivate(1)).resolves.toEqual({
        ClosedSessions: 2,
        ChipsReturned: 75,
      });

      expect(Machine.Active).toBe(false);
      expect(MockManager.increment).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        { UserId: 'user-1' },
        'ChipBalance',
        30
      );
      expect(MockManager.increment).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        { UserId: 'user-2' },
        'ChipBalance',
        45
      );
      expect(Sessions.every((Session) => Session.EndedAt instanceof Date)).toBe(
        true
      );
      expect(MockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(MockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(MockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('should rollback when the machine does not exist', async () => {
      MockManager.findOne.mockResolvedValue(null);

      await expect(Service.AdminDeactivate(99)).rejects.toThrow(
        NotFoundException
      );

      expect(MockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(MockQueryRunner.release).toHaveBeenCalledTimes(1);
      expect(MockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('Update edge cases', () => {
    it('should not change TableColor when it is absent from the update DTO', async () => {
      const ExistingMachine = BuildMachine({
        TableColor: SlotMachineColor.Bronze,
      });
      const UpdateDto: UpdateSlotMachineDto = { Name: 'Renamed Machine' };
      const UpdatedMachine = { ...ExistingMachine, Name: 'Renamed Machine' };

      SlotMachineRepo.findOneBy.mockResolvedValue(ExistingMachine);
      SlotMachineRepo.save.mockResolvedValue(UpdatedMachine);

      const Result = await Service.Update(1, UpdateDto);

      expect(SlotMachineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ TableColor: SlotMachineColor.Bronze })
      );
      expect(Result.TableColor).toBe(SlotMachineColor.Bronze);
    });

    it('should throw NotFoundException when updating a non-existent SlotMachine', async () => {
      SlotMachineRepo.findOneBy.mockResolvedValue(null);

      await expect(
        Service.Update(999, { TableColor: SlotMachineColor.Gold })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Remove', () => {
    it('should throw BadRequestException when active sessions exist', async () => {
      SlotMachineRepo.findOneBy.mockResolvedValue(BuildMachine());
      SlotSessionRepo.count.mockResolvedValue(1);

      await expect(Service.Remove(1)).rejects.toThrow(BadRequestException);
    });

    it('should remove the machine when no active sessions exist', async () => {
      const Machine = BuildMachine();
      SlotMachineRepo.findOneBy.mockResolvedValue(Machine);
      SlotSessionRepo.count.mockResolvedValue(0);
      SlotMachineRepo.remove.mockResolvedValue(Machine);

      await expect(Service.Remove(1)).resolves.toBeUndefined();
      expect(SlotMachineRepo.remove).toHaveBeenCalledWith(Machine);
    });
  });
});

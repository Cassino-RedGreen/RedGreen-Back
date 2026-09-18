import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SessionRegistryService } from '../src/modules/sessions/application/session-registry.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SlotMachineService } from '../src/modules/slot-machine/application/slot-machine.service';
import { SlotMachine } from '../src/modules/slot-machine/domain/slot-machine.entity';
import { SlotSession } from '../src/modules/slot-machine/sessions/domain/slot-session.entity';
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
          useValue: { createQueryRunner: jest.fn() },
        },
        {
          provide: SessionRegistryService,
          useValue: { acquire: jest.fn(), release: jest.fn() },
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

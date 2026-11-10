import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserType } from '@modules/auth/domain/user.entity';
import { GambitTable } from '@modules/gambit/domain/gambit-table.entity';
import { SlotMachine } from '@modules/slot-machine/domain/slot-machine.entity';
import { SlotMachineColor } from '@modules/slot-machine/domain/enums/slot-machine-color.enum';

@Injectable()
export class DatabaseSeedService implements OnModuleInit {
  private readonly Logger = new Logger(DatabaseSeedService.name);

  constructor(private readonly DataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.Seed();
  }

  async Seed(): Promise<void> {
    await this.DataSource.transaction(async (Manager) => {
      await this.SeedAdmin(Manager);
      await this.SeedSlotMachines(Manager);
      await this.SeedGambitTables(Manager);
    });

    this.Logger.log('Official database seed completed');
  }

  private async SeedAdmin(Manager: EntityManager): Promise<void> {
    const UserRepo = Manager.getRepository(User);
    const ExistingAdmin = await UserRepo.createQueryBuilder('User')
      .addSelect('User.Password')
      .where('User.Email = :Email', { Email: 'admin@admin.com' })
      .getOne();
    let Password = ExistingAdmin?.Password;
    if (!Password || !(await bcrypt.compare('admin123', Password))) {
      Password = await bcrypt.hash('admin123', 10);
    }
    const Admin = ExistingAdmin ?? UserRepo.create();

    UserRepo.merge(Admin, {
      Name: 'Admin',
      Nickname: 'Admin',
      Email: 'admin@admin.com',
      Password,
      BirthDate: new Date('1990-12-29T00:00:00.000Z'),
      ChipBalance: 10000,
      Active: true,
      UserType: UserType.ADMIN,
    });

    await UserRepo.save(Admin);
  }

  private async SeedSlotMachines(Manager: EntityManager): Promise<void> {
    const SlotMachineRepo = Manager.getRepository(SlotMachine);
    const SlotMachines = [
      {
        Name: 'Slot 1',
        Description: 'SlotMachine',
        MinimumSpinValue: 10,
        MinimumChipsRequired: 100,
        MinimumRerollValue: 5,
        TableColor: SlotMachineColor.White,
        Active: true,
      },
      {
        Name: 'Slot 2',
        Description: 'SlotMachine',
        MinimumSpinValue: 20,
        MinimumChipsRequired: 500,
        MinimumRerollValue: 10,
        TableColor: SlotMachineColor.White,
        Active: true,
      },
      {
        Name: 'Slot 3',
        Description: 'SlotMachine',
        MinimumSpinValue: 30,
        MinimumChipsRequired: 600,
        MinimumRerollValue: 15,
        TableColor: SlotMachineColor.White,
        Active: true,
      },
      {
        Name: 'Slot 0',
        Description: 'SlotMachine',
        MinimumSpinValue: 10,
        MinimumChipsRequired: 0,
        MinimumRerollValue: 5,
        TableColor: SlotMachineColor.White,
        Active: true,
      },
    ];

    for (const SlotMachineData of SlotMachines) {
      const ExistingSlotMachine = await SlotMachineRepo.findOneBy({
        Name: SlotMachineData.Name,
      });
      const Machine = ExistingSlotMachine ?? SlotMachineRepo.create();
      SlotMachineRepo.merge(Machine, SlotMachineData);
      await SlotMachineRepo.save(Machine);
    }
  }

  private async SeedGambitTables(Manager: EntityManager): Promise<void> {
    const GambitTableRepo = Manager.getRepository(GambitTable);
    const GambitTables = [
      {
        Name: 'Gambit 1',
        Description: 'Gambit',
        MinimumChipsRequired: 100,
        CardPrice: 10,
        TableMultiplier: 1,
        MinimumCardsPurchased: 5,
        MaxCardsPurchased: 20,
        Active: true,
      },
      {
        Name: 'Gambit 2',
        Description: 'Gambit',
        MinimumChipsRequired: 200,
        CardPrice: 15,
        TableMultiplier: 1,
        MinimumCardsPurchased: 5,
        MaxCardsPurchased: 20,
        Active: true,
      },
      {
        Name: 'Gambit 3',
        Description: 'Gambit',
        MinimumChipsRequired: 100,
        CardPrice: 20,
        TableMultiplier: 1,
        MinimumCardsPurchased: 7,
        MaxCardsPurchased: 20,
        Active: true,
      },
      {
        Name: 'High Stake Gambit',
        Description: 'Gambit',
        MinimumChipsRequired: 100,
        CardPrice: 10,
        TableMultiplier: 1,
        MinimumCardsPurchased: 5,
        MaxCardsPurchased: 25,
        Active: true,
      },
    ];

    for (const GambitTableData of GambitTables) {
      const ExistingGambitTable = await GambitTableRepo.findOneBy({
        Name: GambitTableData.Name,
      });
      const Table = ExistingGambitTable ?? GambitTableRepo.create();
      GambitTableRepo.merge(Table, GambitTableData);
      await GambitTableRepo.save(Table);
    }
  }
}

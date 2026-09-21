import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
    await this.SeedAdmin();
    await this.SeedSlotMachines();
    await this.SeedGambitTables();
    this.Logger.log('Database seed completed');
  }

  private async SeedAdmin(): Promise<void> {
    const UserRepo = this.DataSource.getRepository(User);
    const ExistingUser = await UserRepo.findOne({
      where: { Email: 'admin@admin.com' },
    });

    if (ExistingUser) return;

    const Admin = UserRepo.create({
      Name: 'Administrator',
      BirthDate: new Date('1990-01-01'),
      Nickname: 'admin',
      Email: 'admin@admin.com',
      Password: await bcrypt.hash('admin123', 10),
      UserType: UserType.ADMIN,
      Active: true,
    });

    await UserRepo.save(Admin);
  }

  private async SeedSlotMachines(): Promise<void> {
    const SlotMachineRepo = this.DataSource.getRepository(SlotMachine);
    const SlotMachines = [
      {
        Name: 'Slot 1',
        Description: 'SlotMachine',
        MinimumSpinValue: 10,
        MinimumChipsRequired: 100,
        MinimumRerollValue: 5,
        TableColor: SlotMachineColor.White,
      },
      {
        Name: 'Slot 2',
        Description: 'SlotMachine',
        MinimumSpinValue: 20,
        MinimumChipsRequired: 500,
        MinimumRerollValue: 10,
        TableColor: SlotMachineColor.White,
      },
      {
        Name: 'Slot 3',
        Description: 'SlotMachine',
        MinimumSpinValue: 30,
        MinimumChipsRequired: 600,
        MinimumRerollValue: 15,
        TableColor: SlotMachineColor.White,
      },
    ];

    for (const SlotMachineData of SlotMachines) {
      const ExistingSlotMachine = await SlotMachineRepo.findOneBy({
        Name: SlotMachineData.Name,
      });
      if (!ExistingSlotMachine) {
        await SlotMachineRepo.save(SlotMachineRepo.create(SlotMachineData));
      }
    }
  }

  private async SeedGambitTables(): Promise<void> {
    const GambitTableRepo = this.DataSource.getRepository(GambitTable);
    const GambitTables = [
      {
        Name: 'Gambit 1',
        Description: 'Gambit',
        MinimumChipsRequired: 100,
        CardPrice: 10,
        TableMultiplier: 1,
        MinimumCardsPurchased: 5,
        MaxCardsPurchased: 20,
      },
      {
        Name: 'Gambit 2',
        Description: 'Gambit',
        MinimumChipsRequired: 200,
        CardPrice: 15,
        TableMultiplier: 1,
        MinimumCardsPurchased: 5,
        MaxCardsPurchased: 20,
      },
      {
        Name: 'High Stake Gambit',
        Description: 'Gambit',
        MinimumChipsRequired: 100,
        CardPrice: 10,
        TableMultiplier: 1,
        MinimumCardsPurchased: 5,
        MaxCardsPurchased: 25,
      },
    ];

    for (const GambitTableData of GambitTables) {
      const ExistingGambitTable = await GambitTableRepo.findOneBy({
        Name: GambitTableData.Name,
      });
      if (!ExistingGambitTable) {
        await GambitTableRepo.save(GambitTableRepo.create(GambitTableData));
      }
    }
  }
}

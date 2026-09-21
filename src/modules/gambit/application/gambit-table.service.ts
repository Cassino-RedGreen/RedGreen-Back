import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GambitTable } from '../domain/gambit-table.entity';
import { CreateGambitTableDto } from '../domain/dto/create-gambit-table.dto';
import { UpdateGambitTableDto } from '../domain/dto/update-gambit-table.dto';
import {
  GambitSession,
  GambitSessionStatus,
} from '../sessions/domain/gambit-session.entity';
import { User } from '../../auth/domain/user.entity';
import { SessionRegistryService } from '../../sessions/application/session-registry.service';
import { ActiveSessionResponseDto } from '../../sessions/domain/dto/active-session-response.dto';

@Injectable()
export class GambitTableService {
  constructor(
    @InjectRepository(GambitTable)
    private readonly GambitTableRepo: Repository<GambitTable>,
    @InjectRepository(GambitSession)
    private readonly GambitSessionRepo: Repository<GambitSession>,
    private readonly dataSource: DataSource,
    private readonly sessionRegistryService: SessionRegistryService
  ) {}

  async Create(DTO: CreateGambitTableDto): Promise<GambitTable> {
    const GambitTable = this.GambitTableRepo.create(DTO);
    return this.GambitTableRepo.save(GambitTable);
  }

  async FindAll(): Promise<GambitTable[]> {
    return this.GambitTableRepo.find();
  }

  async FindOne(Id: number): Promise<GambitTable> {
    const GambitTable = await this.GambitTableRepo.findOneBy({
      GambitTableId: Id,
    });
    if (!GambitTable) {
      throw new NotFoundException(`GambitTable with ID ${Id} not found`);
    }
    return GambitTable;
  }

  async Update(Id: number, DTO: UpdateGambitTableDto): Promise<GambitTable> {
    const GambitTable = await this.FindOne(Id);

    if (DTO.Name !== undefined) GambitTable.Name = DTO.Name;
    if (DTO.Description !== undefined)
      GambitTable.Description = DTO.Description;
    if (DTO.MinimumChipsRequired !== undefined)
      GambitTable.MinimumChipsRequired = DTO.MinimumChipsRequired;
    if (DTO.CardPrice !== undefined) GambitTable.CardPrice = DTO.CardPrice;
    if (DTO.TableMultiplier !== undefined)
      GambitTable.TableMultiplier = DTO.TableMultiplier;
    if (DTO.MinimumCardsPurchased !== undefined)
      GambitTable.MinimumCardsPurchased = DTO.MinimumCardsPurchased;
    if (DTO.MaxCardsPurchased !== undefined)
      GambitTable.MaxCardsPurchased = DTO.MaxCardsPurchased;

    return this.GambitTableRepo.save(GambitTable);
  }

  async Deactivate(Id: number): Promise<GambitTable> {
    const GambitTable = await this.FindOne(Id);
    GambitTable.Active = !GambitTable.Active;
    return this.GambitTableRepo.save(GambitTable);
  }

  async Remove(Id: number): Promise<void> {
    const GambitTable = await this.FindOne(Id);

    const ActiveSession = await this.GambitSessionRepo.findOne({
      where: { GambitTableId: Id, Status: GambitSessionStatus.InProgress },
    });

    if (ActiveSession) {
      throw new BadRequestException(
        `Cannot delete GambitTable ${Id} while there are active sessions`
      );
    }

    await this.GambitTableRepo.remove(GambitTable);
  }

  async FindActiveSessions(Id: number): Promise<ActiveSessionResponseDto[]> {
    await this.FindOne(Id);
    const Sessions = await this.GambitSessionRepo.find({
      where: { GambitTableId: Id, Status: GambitSessionStatus.InProgress },
      relations: { GambitTable: true, User: true },
    });
    return Sessions.map((s) => ({
      UserId: s.UserId,
      Nickname: s.User.Nickname,
      Status: s.Status,
      PotentialPayout:
        s.Result !== null
          ? s.Result
          : s.CardsPurchased * s.GambitTable.CardPrice,
    }));
  }

  async AdminDeactivate(
    Id: number
  ): Promise<{ ClosedSessions: number; ChipsReturned: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      const FoundTable = await manager.findOne(GambitTable, {
        where: { GambitTableId: Id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!FoundTable) {
        throw new NotFoundException(`GambitTable with ID ${Id} not found`);
      }

      FoundTable.Active = false;
      await manager.save(GambitTable, FoundTable);

      const ActiveSessions = await manager.find(GambitSession, {
        where: { GambitTableId: Id, Status: GambitSessionStatus.InProgress },
        lock: { mode: 'pessimistic_write' },
      });

      let ChipsReturned = 0;
      const Now = new Date();

      for (const Session of ActiveSessions) {
        const Valor =
          Session.Result !== null
            ? Session.Result
            : Session.CardsPurchased * FoundTable.CardPrice;

        await manager.increment(
          User,
          { UserId: Session.UserId },
          'ChipBalance',
          Valor
        );

        Session.Status = GambitSessionStatus.CashedOut;
        Session.UpdatedAt = Now;
        await manager.save(GambitSession, Session);

        await this.sessionRegistryService.release(manager, Session.UserId);

        ChipsReturned += Valor;
      }

      await queryRunner.commitTransaction();

      return { ClosedSessions: ActiveSessions.length, ChipsReturned };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

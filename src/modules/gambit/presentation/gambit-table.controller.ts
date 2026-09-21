import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '@core/guards/admin.guard';
import { GambitTableService } from '../application/gambit-table.service';
import { CreateGambitTableDto } from '../domain/dto/create-gambit-table.dto';
import { UpdateGambitTableDto } from '../domain/dto/update-gambit-table.dto';
import { GambitTableResponseDto } from '../domain/dto/gambit-table-response.dto';

@ApiTags('GambitTable')
@Controller('gambit-table')
export class GambitTableController {
  constructor(private readonly GambitTableService: GambitTableService) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a new gambit table' })
  @ApiCreatedResponse({ type: GambitTableResponseDto })
  async Create(@Body() DTO: CreateGambitTableDto) {
    return this.GambitTableService.Create(DTO);
  }

  @Get()
  @ApiOperation({ summary: 'Get all gambit tables' })
  @ApiOkResponse({ type: GambitTableResponseDto, isArray: true })
  async FindAll() {
    return this.GambitTableService.FindAll();
  }

  @Get(':Id')
  @ApiOperation({ summary: 'Get a gambit table by ID' })
  @ApiOkResponse({ type: GambitTableResponseDto })
  async FindOne(@Param('Id') Id: string) {
    return this.GambitTableService.FindOne(+Id);
  }

  @Patch(':Id')
  @UseGuards(AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a gambit table by ID' })
  @ApiOkResponse({ type: GambitTableResponseDto })
  async Update(@Param('Id') Id: string, @Body() DTO: UpdateGambitTableDto) {
    return this.GambitTableService.Update(+Id, DTO);
  }

  @Patch(':Id/deactivate')
  @UseGuards(AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Toggle activation status of a gambit table by ID' })
  @ApiOkResponse({ type: GambitTableResponseDto })
  async Deactivate(@Param('Id') Id: string) {
    return this.GambitTableService.Deactivate(+Id);
  }

  @Delete(':Id')
  @UseGuards(AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete a gambit table by ID' })
  async Remove(@Param('Id') Id: string) {
    await this.GambitTableService.Remove(+Id);
    return { message: 'Gambit table removed successfully' };
  }
}

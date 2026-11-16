import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { User, UserType } from '../src/modules/auth/domain/user.entity';

jest.mock('bcrypt');
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let MockUserRepo: {
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let MockJwtService: Partial<JwtService>;

  const ValidUser: User = {
    UserId: 'user-123',
    Name: 'Jane Doe',
    BirthDate: new Date('1990-12-29'),
    Nickname: 'janed',
    Email: 'jane.doe@example.com',
    Password: 'hashed-password',
    ChipBalance: 1000,
    DailyLoginStreak: 3,
    LastLoginDate: new Date('2026-04-08T00:00:00Z'),
    CreatedAt: new Date('2025-10-01T12:00:00Z'),
    Active: true,
    UserType: UserType.USER,
  };

  beforeEach(async () => {
    MockUserRepo = {
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };

    MockJwtService = {
      signAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: MockUserRepo,
        },
        {
          provide: JwtService,
          useValue: MockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const SetupLoginQuery = (FoundUser: User | null) => {
    const QueryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(FoundUser),
    };
    MockUserRepo.createQueryBuilder.mockReturnValue(QueryBuilder);
    return QueryBuilder;
  };

  describe('Register', () => {
    const CreateUserDto = {
      Name: 'Jane Doe',
      BirthDate: '1990-12-29',
      Nickname: 'janed',
      Email: 'jane.doe@example.com',
      Password: 'plain-password',
    };

    it('should reject an already registered email before checking nickname', async () => {
      MockUserRepo.findOne.mockResolvedValue(ValidUser);

      await expect(service.Register(CreateUserDto)).rejects.toThrow(
        'Email already registered'
      );

      expect(MockUserRepo.findOne).toHaveBeenCalledTimes(1);
      expect(MockUserRepo.findOne).toHaveBeenCalledWith({
        where: { Email: CreateUserDto.Email },
      });
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(MockUserRepo.save).not.toHaveBeenCalled();
    });

    it('should reject an already used nickname', async () => {
      MockUserRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(ValidUser);

      await expect(service.Register(CreateUserDto)).rejects.toThrow(
        'Nickname already taken'
      );

      expect(MockUserRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { Nickname: CreateUserDto.Nickname },
      });
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(MockUserRepo.save).not.toHaveBeenCalled();
    });

    it('should hash the password, apply defaults, and return a sanitized user', async () => {
      const SavedUser = {
        ...ValidUser,
        Password: 'hashed-password',
        ChipBalance: 0,
        DailyLoginStreak: 0,
      };
      MockUserRepo.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      MockUserRepo.create.mockReturnValue(SavedUser);
      MockUserRepo.save.mockResolvedValue(SavedUser);

      const Result = await service.Register(CreateUserDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(CreateUserDto.Password, 10);
      expect(MockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          Email: CreateUserDto.Email,
          Nickname: CreateUserDto.Nickname,
          Name: CreateUserDto.Name,
          BirthDate: CreateUserDto.BirthDate,
          Password: 'hashed-password',
          ChipBalance: 0,
          DailyLoginStreak: 0,
          Active: true,
        })
      );
      expect(MockUserRepo.save).toHaveBeenCalledWith(SavedUser);
      expect(Result).not.toHaveProperty('Password');
    });
  });

  describe('Login', () => {
    const LoginDto = {
      Email: ValidUser.Email,
      Password: 'plain-password',
    };

    it('should reject when the email is not registered', async () => {
      const QueryBuilder = SetupLoginQuery(null);

      await expect(service.Login(LoginDto)).rejects.toThrow(
        UnauthorizedException
      );

      expect(QueryBuilder.addSelect).toHaveBeenCalledWith('user.Password');
      expect(QueryBuilder.where).toHaveBeenCalledWith('user.Email = :email', {
        email: LoginDto.Email,
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should reject inactive accounts without checking their password', async () => {
      SetupLoginQuery({ ...ValidUser, Active: false });

      await expect(service.Login(LoginDto)).rejects.toThrow(
        'User is not active'
      );

      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should reject an incorrect password', async () => {
      SetupLoginQuery(ValidUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.Login(LoginDto)).rejects.toThrow(
        'Invalid credentials'
      );

      expect(bcrypt.compare).toHaveBeenCalledWith(
        LoginDto.Password,
        ValidUser.Password
      );
    });

    it('should return the authenticated user without the password', async () => {
      SetupLoginQuery(ValidUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const Result = await service.Login(LoginDto);

      expect(Result).toEqual(
        expect.objectContaining({ UserId: ValidUser.UserId })
      );
      expect(Result).not.toHaveProperty('Password');
    });
  });

  it('should return the user profile without Password', async () => {
    MockUserRepo.findOne.mockResolvedValue(ValidUser);

    const Result = await service.GetProfile(ValidUser.UserId);

    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: ValidUser.UserId },
    });
    expect(Result).toEqual(
      expect.objectContaining({
        UserId: ValidUser.UserId,
        Name: ValidUser.Name,
        Email: ValidUser.Email,
        Active: ValidUser.Active,
        UserType: ValidUser.UserType,
      })
    );
    expect(Result).not.toHaveProperty('Password');
  });

  it('should throw BadRequestException when user does not exist', async () => {
    MockUserRepo.findOne.mockResolvedValue(null);

    const ProfilePromise = service.GetProfile('MissingUser');

    await expect(ProfilePromise).rejects.toThrow(BadRequestException);
    await expect(ProfilePromise).rejects.toThrow('User not found');
    expect(MockUserRepo.findOne).toHaveBeenCalledTimes(1);
    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: 'MissingUser' },
    });
  });

  describe('Chip balance', () => {
    it('should return a user chip balance', async () => {
      MockUserRepo.findOne.mockResolvedValue(ValidUser);

      await expect(service.GetChipBalance(ValidUser.UserId)).resolves.toEqual({
        ChipBalance: ValidUser.ChipBalance,
      });
    });

    it('should reject when reading a missing user balance', async () => {
      MockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.GetChipBalance('missing')).rejects.toThrow(
        'User not found'
      );
    });

    it('should update the balance when the resulting amount is non-negative', async () => {
      const ExistingUser = { ...ValidUser, ChipBalance: 100 };
      MockUserRepo.findOne.mockResolvedValue(ExistingUser);
      MockUserRepo.save.mockImplementation((UserToSave) =>
        Promise.resolve(UserToSave)
      );

      await expect(
        service.UpdateChipBalance(ExistingUser.UserId, -40)
      ).resolves.toEqual({ ChipBalance: 60 });
      expect(MockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ChipBalance: 60 })
      );
    });

    it('should reject a balance update that would make the balance negative', async () => {
      const ExistingUser = { ...ValidUser, ChipBalance: 10 };
      MockUserRepo.findOne.mockResolvedValue(ExistingUser);

      await expect(
        service.UpdateChipBalance(ExistingUser.UserId, -11)
      ).rejects.toThrow('Insufficient chips');
      expect(MockUserRepo.save).not.toHaveBeenCalled();
    });

    it('should reject a balance update for a missing user', async () => {
      MockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.UpdateChipBalance('missing', 10)).rejects.toThrow(
        'User not found'
      );
    });
  });

  describe('IsEmailTaken', () => {
    it('should report when an email is already registered', async () => {
      MockUserRepo.findOne.mockResolvedValue(ValidUser);

      await expect(service.IsEmailTaken(ValidUser.Email)).resolves.toEqual({
        Email: ValidUser.Email,
        taken: true,
      });
    });

    it('should report when an email is available', async () => {
      MockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.IsEmailTaken('new@example.com')).resolves.toEqual({
        Email: 'new@example.com',
        taken: false,
      });
    });
  });

  describe('CheckDailyLogin', () => {
    const Today = new Date(2026, 3, 10, 12, 0, 0);

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(Today);
    });

    it('should grant the first-day reward when the user has never logged in', async () => {
      const ExistingUser = {
        ...ValidUser,
        ChipBalance: 100,
        DailyLoginStreak: 0,
        LastLoginDate: null,
      };
      MockUserRepo.findOne.mockResolvedValue(ExistingUser);
      MockUserRepo.save.mockImplementation((UserToSave) =>
        Promise.resolve(UserToSave)
      );

      await expect(
        service.CheckDailyLogin(ExistingUser.UserId)
      ).resolves.toEqual({
        FirstLoginToday: true,
        DailyStreak: 1,
        Reward: 50,
        ChipBalance: 150,
      });
      expect(ExistingUser.LastLoginDate).toEqual(Today);
      expect(MockUserRepo.save).toHaveBeenCalledWith(ExistingUser);
    });

    it('should not grant a second reward on the same calendar day', async () => {
      const ExistingUser = {
        ...ValidUser,
        LastLoginDate: new Date(2026, 3, 10, 0, 1, 0),
      };
      MockUserRepo.findOne.mockResolvedValue(ExistingUser);

      await expect(
        service.CheckDailyLogin(ExistingUser.UserId)
      ).resolves.toEqual({
        FirstLoginToday: false,
        DailyStreak: ExistingUser.DailyLoginStreak,
        ChipBalance: ExistingUser.ChipBalance,
        Reward: 0,
      });
      expect(MockUserRepo.save).not.toHaveBeenCalled();
    });

    it('should continue a consecutive streak and cap its reward at seven days', async () => {
      const ExistingUser = {
        ...ValidUser,
        ChipBalance: 100,
        DailyLoginStreak: 7,
        LastLoginDate: new Date(2026, 3, 9, 23, 59, 0),
      };
      MockUserRepo.findOne.mockResolvedValue(ExistingUser);
      MockUserRepo.save.mockImplementation((UserToSave) =>
        Promise.resolve(UserToSave)
      );

      await expect(
        service.CheckDailyLogin(ExistingUser.UserId)
      ).resolves.toEqual({
        FirstLoginToday: true,
        DailyStreak: 7,
        Reward: 350,
        ChipBalance: 450,
      });
    });

    it('should reset the streak after a missed day', async () => {
      const ExistingUser = {
        ...ValidUser,
        ChipBalance: 100,
        DailyLoginStreak: 5,
        LastLoginDate: new Date(2026, 3, 8, 12, 0, 0),
      };
      MockUserRepo.findOne.mockResolvedValue(ExistingUser);
      MockUserRepo.save.mockImplementation((UserToSave) =>
        Promise.resolve(UserToSave)
      );

      await expect(
        service.CheckDailyLogin(ExistingUser.UserId)
      ).resolves.toEqual({
        FirstLoginToday: true,
        DailyStreak: 1,
        Reward: 50,
        ChipBalance: 150,
      });
    });

    it('should reject when checking a missing user', async () => {
      MockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.CheckDailyLogin('missing')).rejects.toThrow(
        'User not found'
      );
    });
  });

  it('should sign a token with the user id and configured claims', async () => {
    (MockJwtService.signAsync as jest.Mock).mockResolvedValue('signed-token');

    await expect(service.SignToken(ValidUser.UserId)).resolves.toBe(
      'signed-token'
    );
    expect(MockJwtService.signAsync).toHaveBeenCalledWith(
      { UserId: ValidUser.UserId },
      { algorithm: 'HS256', expiresIn: '1h' }
    );
  });

  it('should update allowed user fields correctly', async () => {
    const ExistingUser = { ...ValidUser };
    const UpdateDto = {
      Name: 'Jane Smith',
      BirthDate: '1991-01-15',
    };
    const UpdatedUser = {
      ...ExistingUser,
      Name: UpdateDto.Name,
      BirthDate: new Date(UpdateDto.BirthDate),
    };

    MockUserRepo.findOne.mockResolvedValue(ExistingUser);
    MockUserRepo.save.mockResolvedValue(UpdatedUser);

    const Result = await service.UpdateProfile(ExistingUser.UserId, UpdateDto);

    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: ExistingUser.UserId },
    });
    expect(Result).toEqual(
      expect.objectContaining({
        UserId: ExistingUser.UserId,
        Name: UpdateDto.Name,
        BirthDate: new Date(UpdateDto.BirthDate),
      })
    );
    expect(Result).not.toHaveProperty('Password');
  });

  it('should ignore sensitive fields when updating profile', async () => {
    const ExistingUser = { ...ValidUser };

    const UpdateDto: {
      Name: string;
      BirthDate: string;
      ChipBalance: number;
      UserType: UserType;
    } = {
      Name: 'Jane Smith',
      BirthDate: '1991-01-15',
      ChipBalance: 9999,
      UserType: UserType.ADMIN,
    };

    const UpdatedUser = {
      ...ExistingUser,
      Name: UpdateDto.Name,
      BirthDate: new Date(UpdateDto.BirthDate),
    };

    MockUserRepo.findOne.mockResolvedValue(ExistingUser);
    MockUserRepo.save.mockResolvedValue(UpdatedUser);

    const Result = await service.UpdateProfile(ExistingUser.UserId, UpdateDto);

    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: ExistingUser.UserId },
    });
    expect(MockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        UserId: ExistingUser.UserId,
        Name: UpdateDto.Name,
        BirthDate: new Date(UpdateDto.BirthDate),
        ChipBalance: ExistingUser.ChipBalance,
        UserType: ExistingUser.UserType,
        Password: ExistingUser.Password,
      })
    );
    expect(Result).toEqual(
      expect.objectContaining({
        UserId: ExistingUser.UserId,
        Name: UpdateDto.Name,
        BirthDate: new Date(UpdateDto.BirthDate),
      })
    );
    expect(Result).not.toHaveProperty('Password');
  });

  it('should throw BadRequestException when updating profile for missing user', async () => {
    const UpdateDto = {
      Name: 'Jane Smith',
      BirthDate: '1991-01-15',
    };

    MockUserRepo.findOne.mockResolvedValue(null);

    const UpdatePromise = service.UpdateProfile('MissingUser', UpdateDto);

    await expect(UpdatePromise).rejects.toThrow(BadRequestException);
    await expect(UpdatePromise).rejects.toThrow('User not found');
    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: 'MissingUser' },
    });
    expect(MockUserRepo.save).not.toHaveBeenCalled();
  });

  it('should keep non-updated fields unchanged when updating profile', async () => {
    const ExistingUser = { ...ValidUser };
    const UpdateDto = {
      Name: 'Updated Name',
    };
    const UpdatedUser = {
      ...ExistingUser,
      Name: UpdateDto.Name,
    };

    MockUserRepo.findOne.mockResolvedValue(ExistingUser);
    MockUserRepo.save.mockResolvedValue(UpdatedUser);

    const Result = await service.UpdateProfile(ExistingUser.UserId, UpdateDto);

    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: ExistingUser.UserId },
    });
    expect(MockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        UserId: ExistingUser.UserId,
        Name: UpdateDto.Name,
        Email: ExistingUser.Email,
        Nickname: ExistingUser.Nickname,
        ChipBalance: ExistingUser.ChipBalance,
        DailyLoginStreak: ExistingUser.DailyLoginStreak,
        Active: ExistingUser.Active,
        UserType: ExistingUser.UserType,
        Password: ExistingUser.Password,
      })
    );
    expect(Result).toEqual(
      expect.objectContaining({
        UserId: ExistingUser.UserId,
        Name: UpdateDto.Name,
        Email: ExistingUser.Email,
        Nickname: ExistingUser.Nickname,
        ChipBalance: ExistingUser.ChipBalance,
        DailyLoginStreak: ExistingUser.DailyLoginStreak,
        Active: ExistingUser.Active,
        UserType: ExistingUser.UserType,
      })
    );
    expect(Result).not.toHaveProperty('Password');
  });

  it('should hash Password when updating profile with new Password', async () => {
    const ExistingUser = { ...ValidUser };
    const UpdateDto = {
      Password: 'plaintext-password',
    };
    const UpdatedUser = {
      ...ExistingUser,
      Password: 'new-hashed-password',
    };

    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');
    MockUserRepo.findOne.mockResolvedValue(ExistingUser);
    MockUserRepo.save.mockResolvedValue(UpdatedUser);

    const Result = await service.UpdateProfile(ExistingUser.UserId, UpdateDto);

    expect(bcrypt.hash).toHaveBeenCalledWith('plaintext-password', 10);
    expect(MockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        Password: 'new-hashed-password',
      })
    );
    expect(Result).not.toHaveProperty('Password');
  });

  it('should deactivate the user account', async () => {
    const ExistingUser = { ...ValidUser, Active: true };
    const DeactivatedUser = { ...ExistingUser, Active: false };

    MockUserRepo.findOne.mockResolvedValue(ExistingUser);
    MockUserRepo.save.mockResolvedValue(DeactivatedUser);

    const Result = await service.DeleteAccount(ExistingUser.UserId);

    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: ExistingUser.UserId },
    });
    expect(MockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        UserId: ExistingUser.UserId,
        Active: false,
      })
    );
    expect(Result).toEqual({ message: 'Account deleted successfully' });
  });

  it('should throw BadRequestException when deleting missing user account', async () => {
    MockUserRepo.findOne.mockResolvedValue(null);

    const DeletePromise = service.DeleteAccount('MissingUser');

    await expect(DeletePromise).rejects.toThrow(BadRequestException);
    await expect(DeletePromise).rejects.toThrow('User not found');
    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: 'MissingUser' },
    });
    expect(MockUserRepo.save).not.toHaveBeenCalled();
  });

  it('should return top 10 users ordered by ChipBalance', async () => {
    const TopUsers: User[] = [
      { ...ValidUser, UserId: 'user-1', ChipBalance: 5000, Active: true },
      { ...ValidUser, UserId: 'user-2', ChipBalance: 4500, Active: true },
      { ...ValidUser, UserId: 'user-3', ChipBalance: 4000, Active: true },
    ];

    MockUserRepo.find.mockResolvedValue(TopUsers);

    const Result = await service.GetRank();

    expect(MockUserRepo.find).toHaveBeenCalledWith({
      where: { Active: true },
      order: { ChipBalance: 'DESC' },
      take: 10,
    });
    expect(Result).toHaveLength(3);
    expect(Result[0]).toEqual(
      expect.objectContaining({
        Position: 1,
        UserId: 'user-1',
        ChipBalance: 5000,
      })
    );
    expect(Result[0]).not.toHaveProperty('Password');
    expect(Result[1]).toEqual(
      expect.objectContaining({
        Position: 2,
        UserId: 'user-2',
        ChipBalance: 4500,
      })
    );
    expect(Result[2]).toEqual(
      expect.objectContaining({
        Position: 3,
        UserId: 'user-3',
        ChipBalance: 4000,
      })
    );
  });

  it('should reactivate a user account', async () => {
    const InactiveUser = { ...ValidUser, Active: false };
    const ReactivatedUser = { ...ValidUser, Active: true };

    MockUserRepo.findOne.mockResolvedValue(InactiveUser);
    MockUserRepo.save.mockResolvedValue(ReactivatedUser);

    const Result = await service.ReactivateAccount(InactiveUser.UserId);

    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: InactiveUser.UserId },
    });
    expect(MockUserRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        UserId: InactiveUser.UserId,
        Active: true,
      })
    );
    expect(Result).toEqual({ message: 'Account reactivated successfully' });
  });

  it('should throw BadRequestException when reactivating missing user', async () => {
    MockUserRepo.findOne.mockResolvedValue(null);

    const ReactivatePromise = service.ReactivateAccount('MissingUser');

    await expect(ReactivatePromise).rejects.toThrow(BadRequestException);
    await expect(ReactivatePromise).rejects.toThrow('User not found');
    expect(MockUserRepo.findOne).toHaveBeenCalledWith({
      where: { UserId: 'MissingUser' },
    });
    expect(MockUserRepo.save).not.toHaveBeenCalled();
  });
});

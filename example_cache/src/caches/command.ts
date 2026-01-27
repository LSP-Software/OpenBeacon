import { calculatePermissions } from '@discordeno/bot';
import { branding } from 'branding';
import type { CommandName, PrismaClient } from 'database';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import { type CachedCommand, CachedCommandSchema } from '../types/command';
import { convertWordWithUnderscoresToStandardFormat } from '../utils/text';

export class CommandCache {
  private prefix: string;
  private redis: Redis;
  private db: PrismaClient;

  private ttl = 60 * 60 * 24; // 1 day

  constructor(redis: Redis, db: PrismaClient, variant: VARIANTS, botId: string) {
    this.prefix = `${variant}:${botId}`;
    this.redis = redis;
    this.db = db;
  }

  getKey = (guildId: string, commandName: CommandName) => `${this.prefix}:guild:${guildId}:commands:${commandName}`;

  update = async (guildId: string, updatingUserId: string, command: CachedCommand) => {
    const oldCommand = await this.get(guildId, command.name);

    const upsertedCommand = await this.db.command.upsert({
      create: {
        name: command.name,
        enabled: command.enabled,
        permissions: command.permissions,
        guildId,
        lastUpdatedById: updatingUserId,
      },
      update: {
        enabled: command.enabled,
        permissions: command.permissions,
        lastUpdatedById: updatingUserId,
      },
      where: {
        guildId_name: {
          guildId: guildId,
          name: command.name,
        },
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        permissions: true,
        updatedAt: true,
        User: {
          select: {
            name: true,
            image: true,
          },
        },
      },
    });

    const logs = [];
    if (oldCommand.enabled !== command.enabled) {
      logs.push(
        `%userName% ${command.enabled ? 'enabled' : 'disabled'} the command ${convertWordWithUnderscoresToStandardFormat(command.name)}`,
      );
    }
    if (oldCommand.permissions !== command.permissions) {
      logs.push(
        `%userName% updated ${convertWordWithUnderscoresToStandardFormat(command.name)}'s permissions from ${
          !oldCommand.permissions
            ? 'N/A'
            : calculatePermissions(BigInt(oldCommand.permissions))
                .sort()
                .map((p) => convertWordWithUnderscoresToStandardFormat(p))
                .join(', ')
        } to ${
          !command.permissions
            ? 'N/A'
            : calculatePermissions(BigInt(command.permissions))
                .sort()
                .map((p) => convertWordWithUnderscoresToStandardFormat(p))
                .join(', ')
        }`,
      );
    }

    await this.db.dashboardLogEvent.create({
      data: {
        guildId: guildId,
        userId: updatingUserId,
        description: `%userName% updated the command ${convertWordWithUnderscoresToStandardFormat(command.name)}`,
        Logs: {
          createMany: {
            data: logs.map((description) => ({ description })),
          },
        },
      },
    });

    await this.create(guildId, {
      id: upsertedCommand.id,
      name: upsertedCommand.name,
      enabled: upsertedCommand.enabled,
      permissions: upsertedCommand.permissions,
      updatedByName: upsertedCommand.User?.name ?? undefined,
      updatedByImage: upsertedCommand.User?.image ?? undefined,
      updatedAt: upsertedCommand.updatedAt,
    });
  };

  create = async (guildId: string, command: CachedCommand) => {
    const data = await CachedCommandSchema.parseAsync(command);
    const value = JSON.stringify(data);
    const key = this.getKey(guildId, command.name);

    await this.redis.call('JSON.SET', key, '.', value);
    await this.redis.expire(key, this.ttl);
  };

  get = async (guildId: string, commandName: CommandName) => {
    const value = await this.redis.call('JSON.GET', this.getKey(guildId, commandName));
    if (value) return JSON.parse(value as string) as CachedCommand;

    const dbCommand = await this.db.command.findFirst({
      where: {
        name: commandName,
        guildId: guildId,
      },
      select: {
        id: true,
        guildId: true,
        name: true,
        enabled: true,
        permissions: true,
        updatedAt: true,
        User: {
          select: {
            name: true,
            image: true,
          },
        },
      },
    });

    const defaultCommand = branding.commands[commandName];
    const commandToCreate: CachedCommand = {
      name: commandName,
      enabled: defaultCommand.defaults.enabled,
      permissions: defaultCommand.defaults.permissions,
    };

    if (dbCommand?.guildId === guildId) {
      commandToCreate.id = dbCommand.id;
      commandToCreate.name = dbCommand.name;
      commandToCreate.enabled = dbCommand.enabled;
      commandToCreate.permissions = dbCommand.permissions;
      commandToCreate.updatedByName = dbCommand.User?.name ?? undefined;
      commandToCreate.updatedByImage = dbCommand.User?.image ?? undefined;
      commandToCreate.updatedAt = dbCommand.updatedAt;
    }

    this.create(guildId, commandToCreate);

    return commandToCreate;
  };

  getAll = async (guildId: string) => {
    const commandNames = Object.keys(branding.commands) as CommandName[];

    const redisKeys = commandNames.map((commandName) => this.getKey(guildId, commandName));

    const pipeline = this.redis.pipeline();
    for (const key of redisKeys) pipeline.call('JSON.GET', key);
    const redisResults = await pipeline.exec();

    const uncachedCommands: CommandName[] = [];
    const results: CachedCommand[] = [];

    redisResults?.forEach((result, index) => {
      const [err, value] = result as [Error | null, string | null];
      if (err || typeof value !== 'string') {
        const toPush = commandNames[index];
        if (toPush) uncachedCommands.push(toPush);
      } else {
        results.push(JSON.parse(value) as CachedCommand);
      }
    });

    if (uncachedCommands.length > 0) {
      const dbCommands = await this.db.command.findMany({
        where: {
          guildId,
          name: { in: uncachedCommands },
        },
        select: {
          id: true,
          guildId: true,
          name: true,
          enabled: true,
          permissions: true,
          updatedAt: true,
          User: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      });

      const dbCommandMap = new Map(dbCommands.map((cmd) => [cmd.name, cmd]));

      const pipelineCreate = this.redis.pipeline();
      for (const commandName of uncachedCommands) {
        const dbCommand = dbCommandMap.get(commandName);
        const defaultCommand = branding.commands[commandName];
        const commandToCreate: CachedCommand = {
          name: commandName,
          enabled: defaultCommand.defaults.enabled,
          permissions: defaultCommand.defaults.permissions,
        };

        if (dbCommand) {
          commandToCreate.id = dbCommand.id;
          commandToCreate.enabled = dbCommand.enabled;
          commandToCreate.permissions = dbCommand.permissions;
          commandToCreate.updatedByName = dbCommand.User?.name ?? undefined;
          commandToCreate.updatedByImage = dbCommand.User?.image ?? undefined;
          commandToCreate.updatedAt = dbCommand.updatedAt;
        }

        pipelineCreate.call('JSON.SET', this.getKey(guildId, commandName), '$', JSON.stringify(commandToCreate));

        results.push(commandToCreate);
      }

      await pipelineCreate.exec();
    }

    return results;
  };
}

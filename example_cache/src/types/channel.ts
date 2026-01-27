import type { ChannelTypes } from '@discordeno/types';

export interface CachedChannel {
  id: string;
  name: string | null;
  type: ChannelTypes;
  internalOverwrites: string[];
}

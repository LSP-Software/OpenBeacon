import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CacheService } from "./cache.service.ts";
import { RateLimitGuard } from "./rate-limit.guard.ts";

@Module({
  providers: [
    CacheService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [CacheService],
})
export class CacheModule {}

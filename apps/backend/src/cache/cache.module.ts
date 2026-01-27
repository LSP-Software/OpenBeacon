import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CacheService } from "./cache.service.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

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

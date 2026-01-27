import { Module } from "@nestjs/common";
import { CacheModule } from "@openbeacon/cache";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [AuthModule.forRoot({ auth }), CacheModule, HealthModule],
})
export class AppModule {}

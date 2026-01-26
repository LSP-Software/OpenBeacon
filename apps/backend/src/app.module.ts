import { Module } from "@nestjs/common";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [AuthModule.forRoot({ auth }), HealthModule],
})
export class AppModule {}

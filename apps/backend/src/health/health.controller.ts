import { Controller, Get } from "@nestjs/common";
import { RateLimit } from "@openbeacon/cache";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

@Controller("health")
export class HealthController {
  @Get()
  @AllowAnonymous()
  @RateLimit({ limit: 10, windowSeconds: 60 })
  getHealth(): { status: "ok" } {
    return { status: "ok" };
  }
}

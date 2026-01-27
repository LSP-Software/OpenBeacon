import { Controller, Get } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { RateLimit } from "../cache/rate-limit.decorator.js";

@Controller("health")
export class HealthController {
  @Get()
  @AllowAnonymous()
  @RateLimit({ limit: 10, windowSeconds: 60 })
  getHealth(): { status: "ok" } {
    return { status: "ok" };
  }
}

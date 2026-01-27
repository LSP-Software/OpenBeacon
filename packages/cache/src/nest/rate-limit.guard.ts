import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { CacheService } from "./cache.service.ts";
import { RATE_LIMIT_METADATA_KEY, type RateLimitOptions } from "./rate-limit.decorator.ts";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(this.reflector instanceof Reflector)) {
      throw new Error("Reflector unavailable");
    }
    if (!(this.cacheService instanceof CacheService)) {
      throw new Error("Cache service unavailable");
    }

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ip = this.getClientIp(request);
    const route = `${request.method}:${request.baseUrl}${request.route?.path ?? request.path}`;
    const keyPrefix = options.keyPrefix ?? "ratelimit";

    const result = await this.cacheService.rateLimit({
      ip: `${keyPrefix}:${ip}`,
      path: route,
      limit: options.limit,
      windowSeconds: options.windowSeconds,
    });

    response.setHeader("X-RateLimit-Limit", result.limit.toString());
    response.setHeader("X-RateLimit-Remaining", result.remaining.toString());
    response.setHeader("X-RateLimit-Reset", result.resetSeconds.toString());

    if (!result.allowed) {
      response.setHeader("Retry-After", result.resetSeconds.toString());
      throw new HttpException("Rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private getClientIp(request: Request): string {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return first;
      }
    }

    return request.ip ?? "unknown";
  }
}

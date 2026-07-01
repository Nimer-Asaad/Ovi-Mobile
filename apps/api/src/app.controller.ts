import { Controller, Get } from "@nestjs/common";
import type { HealthCheckResponse } from "@ovi/contracts";

@Controller()
export class AppController {
  @Get("health")
  getHealth(): HealthCheckResponse {
    return {
      service: "ovi-mobile-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}

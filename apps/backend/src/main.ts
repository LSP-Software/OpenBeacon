import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.ts";
import { env } from "./env.ts";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    bodyParser: false,
  });
  await app.listen(env.PORT);
}

void bootstrap();

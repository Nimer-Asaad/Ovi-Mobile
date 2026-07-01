import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    credentials: true,
    origin: corsOrigin
      ? corsOrigin.split(",").map((origin) => origin.trim())
      : true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Ovi Mobile API")
    .setDescription("REST API foundation for Ovi Mobile.")
    .setVersion("0.1.0")
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();

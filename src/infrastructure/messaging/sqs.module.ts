import { SQSClient } from '@aws-sdk/client-sqs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const SQS_CLIENT = Symbol('SQS_CLIENT');

@Module({
  providers: [
    {
      inject: [ConfigService],
      provide: SQS_CLIENT,
      useFactory: (config: ConfigService): SQSClient =>
        new SQSClient({
          credentials: {
            accessKeyId: config.get('AWS_ACCESS_KEY_ID', 'test'),
            secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY', 'test'),
          },
          endpoint: config.get('SQS_ENDPOINT', 'http://localhost:4566'),
          region: config.get('AWS_REGION', 'us-east-1'),
        }),
    },
  ],
  exports: [SQS_CLIENT],
})
export class SqsModule {}

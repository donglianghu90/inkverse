import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageEventEntity } from './entities/usage-event.entity';
import { UsageLedgerService } from './usage-ledger.service';
import { UsageController } from './usage.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UsageEventEntity])],
  controllers: [UsageController],
  providers: [UsageLedgerService],
  exports: [UsageLedgerService],
})
export class UsageModule {}

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageEventEntity } from './entities/usage-event.entity';
import { UsageLedgerService } from './usage-ledger.service';
import { UsageController } from './usage.controller';
import { BillingResolverService } from './billing-resolver.service';
import { UsageAccessService } from './usage-access.service';
import { BookEntity } from '../novel/entities/book.entity';
import { DramaEntity } from '../drama/entities/drama.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([UsageEventEntity, BookEntity, DramaEntity]),
  ],
  controllers: [UsageController],
  providers: [UsageLedgerService, BillingResolverService, UsageAccessService],
  exports: [UsageLedgerService, BillingResolverService],
})
export class UsageModule {}

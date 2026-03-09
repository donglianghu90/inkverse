import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { UsageLedgerService } from './usage-ledger.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly ledger: UsageLedgerService) {}

  @Get('me/dashboard')
  async dashboard(@Req() req: any) {
    const userId = req.user?.userId ?? req.user?.id ?? '';
    return this.ledger.userDashboard(userId);
  }

  @Get('me/events')
  async myEvents(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.userId ?? req.user?.id ?? '';
    return this.ledger.userEvents(userId, +(page ?? 1), +(limit ?? 20));
  }

  @Get('novel/:bookId')
  async novelBookUsage(@Param('bookId') bookId: string) {
    return this.ledger.resourceDetail('novel', bookId);
  }

  @Get('drama/:dramaId')
  async dramaUsage(@Param('dramaId') dramaId: string) {
    return this.ledger.resourceDetail('drama', dramaId);
  }
}

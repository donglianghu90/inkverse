import { Controller, Get, Param, Query, Req, UnauthorizedException } from '@nestjs/common';
import { UsageLedgerService } from './usage-ledger.service';
import { UsageAccessService } from './usage-access.service';

@Controller('usage')
export class UsageController {
  constructor(
    private readonly ledger: UsageLedgerService,
    private readonly accessService: UsageAccessService,
  ) {}

  private getUserId(req: any): string {
    const userId = req.user?.userId ?? req.user?.id ?? '';
    if (!userId) throw new UnauthorizedException('未登录或用户信息缺失');
    return userId;
  }

  @Get('me/dashboard')
  async dashboard(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.ledger.userDashboard(userId);
  }

  @Get('me/events')
  async myEvents(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.getUserId(req);
    return this.ledger.userEvents(userId, +(page ?? 1), +(limit ?? 20));
  }

  @Get('novel/:bookId')
  async novelBookUsage(@Param('bookId') bookId: string, @Req() req: any) {
    const userId = this.getUserId(req);
    await this.accessService.assertNovelAccess(bookId, userId);
    return this.ledger.resourceDetail('novel', bookId);
  }

  @Get('drama/:dramaId')
  async dramaUsage(@Param('dramaId') dramaId: string, @Req() req: any) {
    const userId = this.getUserId(req);
    await this.accessService.assertDramaAccess(dramaId, userId);
    return this.ledger.resourceDetail('drama', dramaId);
  }
}

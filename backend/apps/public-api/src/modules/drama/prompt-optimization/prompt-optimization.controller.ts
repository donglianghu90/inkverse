import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { PromptOptimizationService } from './prompt-optimization.service';

@Controller('drama/prompt-optimization')
export class PromptOptimizationController {
  constructor(private readonly optService: PromptOptimizationService) {}

  @Get('proposals/pending')
  async listPending() {
    return this.optService.listPendingProposals();
  }

  @Post('proposals/:id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT', modifiedRule?: string, userId: string },
  ) {
    return this.optService.resolveProposal(id, body.userId, body.action, body.modifiedRule);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromptOptimizationProposalEntity, ProposalStatus } from '../entities/prompt-optimization-proposal.entity';
import { SystemPromptOptimizerAgent } from '../agents/review/system-prompt-optimizer.agent';
import { DramaGenreTemplateService } from '../../template/genre/drama-genre-template.service';

@Injectable()
export class PromptOptimizationService {
  private readonly logger = new Logger(PromptOptimizationService.name);

  constructor(
    @InjectRepository(PromptOptimizationProposalEntity)
    private readonly proposalRepo: Repository<PromptOptimizationProposalEntity>,
    private readonly optimizerAgent: SystemPromptOptimizerAgent,
    private readonly genreTemplateService: DramaGenreTemplateService,
  ) {}

  async triggerOptimizationAnalysis(
    dramaId: string,
    episodeNumber: number,
    genreKey: string | null,
    targetAgentKey: string,
    failureDetails: string,
    stateContext: any,
    evidenceLink: string,
  ) {
    if (!genreKey) {
      this.logger.warn(`Skip optimization: No genreKey found for drama ${dramaId}`);
      return;
    }
    
    // Async execution to avoid blocking the workflow
    setTimeout(async () => {
      try {
        const result = await this.optimizerAgent.generateProposal(targetAgentKey, failureDetails, stateContext);
        if (result) {
          const entity = this.proposalRepo.create({
            dramaId,
            episodeNumber,
            genreKey,
            targetAgentKey,
            targetConfigArea: result.targetConfigArea,
            suggestedRule: result.suggestedRule,
            rootCause: result.rootCause,
            evidenceLinks: [evidenceLink],
            status: ProposalStatus.PENDING,
          });
          await this.proposalRepo.save(entity);
          this.logger.log(`Created optimization proposal for ${targetAgentKey}`);
        }
      } catch (err) {
        this.logger.error(`Error generating proposal: ${(err as Error).message}`);
      }
    }, 0);
  }

  async listPendingProposals() {
    return this.proposalRepo.find({ where: { status: ProposalStatus.PENDING }, order: { createdAt: 'DESC' } });
  }

  async resolveProposal(id: string, userId: string, action: 'APPROVE' | 'REJECT', modifiedRule?: string) {
    const proposal = await this.proposalRepo.findOne({ where: { id } });
    if (!proposal) throw new Error('Proposal not found');

    if (action === 'REJECT') {
      proposal.status = ProposalStatus.REJECTED;
      return this.proposalRepo.save(proposal);
    }

    // Approve
    const finalRule = modifiedRule || proposal.suggestedRule;
    if (proposal.genreKey) {
       const userGenres = await this.genreTemplateService.list(userId);
       const genre = userGenres.find(t => t.genreKey === proposal.genreKey);
       if (genre) {
         let currentPrompt = '';
         if (genre.profileJson && (genre.profileJson.agentSystemPrompts as any)?.[proposal.targetAgentKey]) {
           currentPrompt = (genre.profileJson.agentSystemPrompts as any)[proposal.targetAgentKey];
         }
         
         const newPrompt = currentPrompt + `\n\n【系统学习防雷规则】：${finalRule}`;
         await this.genreTemplateService.updateAgentPrompt(genre.id, userId, proposal.targetAgentKey, newPrompt);
       } else {
         this.logger.warn(`Could not find active genre template for user ${userId} and genreKey ${proposal.genreKey}`);
       }
    }
    
    proposal.suggestedRule = finalRule;
    proposal.status = ProposalStatus.APPROVED;
    return this.proposalRepo.save(proposal);
  }
}

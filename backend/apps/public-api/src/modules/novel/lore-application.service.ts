/**
 * Applies LoreRecord deltas to StoryState — characters, relations,
 * timeline, plot threads, facts, aliases.
 * Also creates new world elements (characters, locations, items).
 */
import { Injectable } from '@nestjs/common';
import {
  BootstrapRelationSeed,
  ChapterContract,
  CharacterFact,
  LoreRecord,
  PlotThread,
  RelationshipEdge,
  TimelineEvent,
} from './schemas/novel.schemas';
import {
  StoryState,
  ChapterIntent,
} from './schemas/novel-state.schemas';

@Injectable()
export class LoreApplicationService {
  constructor() {}

  /**
   * Lore application: creates new entities + applies deltas.
   */
  applyLore(
    state: StoryState,
    lore: LoreRecord,
    intent: ChapterIntent,
  ): StoryState {
    const chapterNumber = lore.chapterNumber;

    // Step 1: Register new world elements BEFORE applying deltas.
    let locations = [...state.locations];
    let items = [...state.items];
    let characters = [...state.characters];

    const knownLocationIds = new Set(locations.map((l) => l.id));
    const knownItemIds = new Set(items.map((i) => i.id));
    const knownCharacterIds = new Set(characters.map((c) => c.id));

    for (const newLoc of lore.newLocations ?? []) {
      if (!knownLocationIds.has(newLoc.id)) {
        locations.push({
          id: newLoc.id,
          name: newLoc.name,
          description: newLoc.description,
          dangerLevel: newLoc.dangerLevel ?? 'low',
        });
        knownLocationIds.add(newLoc.id);
      }
    }

    for (const newItem of lore.newItems ?? []) {
      if (!knownItemIds.has(newItem.id)) {
        items.push({
          id: newItem.id,
          name: newItem.name,
          type: newItem.type,
          effect: newItem.effect,
          ownerId: newItem.ownerId && knownCharacterIds.has(newItem.ownerId) ? newItem.ownerId : null,
          locationId: newItem.locationId && knownLocationIds.has(newItem.locationId) ? newItem.locationId : null,
        });
        knownItemIds.add(newItem.id);
      }
    }

    for (const newChar of lore.newCharacters ?? []) {
      if (!knownCharacterIds.has(newChar.id)) {
        characters.push({
          id: newChar.id,
          name: newChar.name,
          aliases: newChar.aliases ?? [],
          role: newChar.role,
          archetype: newChar.archetype,
          personalityTags: newChar.personalityTags,
          profile: {
            nameOrigin: newChar.nameOrigin,
            age: newChar.age,
            gender: newChar.gender,
            ...(newChar.appearance ? {
              facialFeatures: newChar.appearance,
            } : {}),
            ...(newChar.outfit ? {
              typicalOutfit: newChar.outfit,
            } : {}),
            ...(newChar.ability ? {
              abilities: [{ name: newChar.ability, level: '初始', description: newChar.ability }],
            } : {}),
          },
          status: {
            locationId: newChar.locationId && knownLocationIds.has(newChar.locationId) ? newChar.locationId : null,
            state: newChar.state ?? '',
            level: 0,
            inventory: [],
            lifecycleStatus: 'active',
            firstSeenChapter: chapterNumber,
            lastSeenChapter: chapterNumber,
            plannedReturnChapter: null,
            narrativeImportance: newChar.role === 'protagonist' ? 'core'
              : newChar.role === 'villain' ? 'major'
              : newChar.role === 'supporting' ? 'major' : 'minor',
            dormantReference: false,
          },
        });
        knownCharacterIds.add(newChar.id);
      }
    }

    // Step 2: Build a bridge state with new entities for delta application.
    const bridgeState = {
      ...(state as any),
      characters,
      locations,
      items,
    };

    const bridgeContract: ChapterContract = {
      chapterNumber,
      chapterTitle: '',
      mission: intent.goals[0] ?? '',
      openingCarryover: intent.carryoverFromLastChapter,
      mandatoryBeats: intent.goals,
      qualityChecklist: [],
      forbiddenBeats: [],
      allowedCharacterIds: intent.characterAvailability.activeCharacterIds,
      requiredItemIds: [],
      targetEmotion: intent.emotionDirection,
      hookRequirement: intent.hookDirection,
      wordCountRange: intent.wordCountRange,
    };

    const applied = this.applyLoreDeltas(bridgeState as any, lore, bridgeContract);

    // Step 4: Apply character profile deltas.
    let profiledCharacters = applied.characters;
    if (lore.characterProfileDeltas?.length) {
      profiledCharacters = profiledCharacters.map((ch) => {
        const deltas = lore.characterProfileDeltas!.filter(
          (d) => d.characterId === ch.id,
        );
        if (!deltas.length) return ch;
        const p = ch.profile ?? {};
        const MAX_CHANGES = 20;

        for (const delta of deltas) {
          if (delta.field === 'appearance') {
            if (!p.facialFeatures) {
              p.facialFeatures = delta.description;
            } else if (delta.isChange) {
              p.appearanceChanges = [...(p.appearanceChanges ?? []),
                { chapterNumber, change: delta.description }].slice(-MAX_CHANGES);
            }
            const parts = delta.description.match(/[发髪].*?[色型]/);
            if (parts && !p.hairStyle) p.hairStyle = delta.description;
          } else if (delta.field === 'outfit') {
            if (delta.isChange) {
              p.outfitChanges = [...(p.outfitChanges ?? []),
                { chapterNumber, change: delta.description }].slice(-MAX_CHANGES);
            }
            p.typicalOutfit = delta.description;
          } else if (delta.field === 'hairstyle') {
            p.hairStyle = delta.description;
            if (delta.isChange) {
              p.appearanceChanges = [...(p.appearanceChanges ?? []),
                { chapterNumber, change: `发型变化：${delta.description}` }].slice(-MAX_CHANGES);
            }
          } else if (delta.field === 'ability_gain') {
            p.abilities = [...(p.abilities ?? []),
              { name: delta.description, level: '初始', description: delta.description, acquiredAtChapter: chapterNumber }];
            p.abilityChanges = [...(p.abilityChanges ?? []),
              { chapterNumber, change: `获得：${delta.description}` }].slice(-MAX_CHANGES);
          } else if (delta.field === 'ability_upgrade') {
            p.abilityChanges = [...(p.abilityChanges ?? []),
              { chapterNumber, change: `升级：${delta.description}` }].slice(-MAX_CHANGES);
          } else if (delta.field === 'injury') {
            p.distinguishingMarks = [...(p.distinguishingMarks ?? []), delta.description];
            p.appearanceChanges = [...(p.appearanceChanges ?? []),
              { chapterNumber, change: `受伤：${delta.description}` }].slice(-MAX_CHANGES);
          } else if (delta.field === 'personality_shift') {
            p.personalityShifts = [...(p.personalityShifts ?? []),
              { chapterNumber, change: delta.description }].slice(-MAX_CHANGES);
          } else if (delta.field === 'hobby_discovered') {
            p.hobbies = [...(p.hobbies ?? []), delta.description];
          } else if (delta.field === 'backstory_revealed') {
            p.backstory = p.backstory
              ? `${p.backstory}；${delta.description}`
              : delta.description;
          }
        }

        return { ...ch, profile: p };
      });
    }

    // Step 4b: Apply character voice deltas.
    const MAX_VOICE_SAMPLES = 5;
    let finalCharacters = profiledCharacters;
    if (lore.characterVoiceDeltas?.length) {
      finalCharacters = finalCharacters.map((ch) => {
        const deltas = lore.characterVoiceDeltas!.filter(
          (d) => d.characterId === ch.id,
        );
        if (!deltas.length) return ch;
        const existing = ch.voice ?? {
          speechPattern: '',
          verbalTics: [],
          vocabularyLevel: 'neutral' as const,
          sampleDialogues: [],
        };
        const newSamples = [
          ...existing.sampleDialogues,
          ...deltas.map((d) => d.sampleDialogue),
        ].slice(-MAX_VOICE_SAMPLES);
        const newTics = [
          ...existing.verbalTics,
          ...deltas.filter((d) => d.verbalTic).map((d) => d.verbalTic!),
        ].filter((v, i, a) => a.indexOf(v) === i);
        const latestPattern = deltas.find((d) => d.speechPatternNote);
        return {
          ...ch,
          voice: {
            ...existing,
            speechPattern: latestPattern?.speechPatternNote ?? existing.speechPattern,
            verbalTics: newTics,
            sampleDialogues: newSamples,
          },
        };
      });
    }

    // Step 4c: Apply emotional imprints to character psychology.
    if (lore.emotionalImprints?.length) {
      const INTENSITY_MAP: Record<string, number> = {
        subtle: 0.3, moderate: 0.5, intense: 0.8, overwhelming: 1.0,
      };
      finalCharacters = finalCharacters.map((ch) => {
        const imprints = lore.emotionalImprints!.filter((e) => e.characterId === ch.id);
        if (!imprints.length) return ch;
        const psych = ch.psychology ?? {
          emotionalBaseline: 'stoic' as const,
          currentMood: '平静',
          emotionalMemories: [],
          decisionPattern: 'rational_first' as const,
          stressResponse: 'fight' as const,
          trustThreshold: 'cautious' as const,
          interactionPatterns: [],
        };
        const newMemories = [
          ...(psych.emotionalMemories ?? []),
          ...imprints.map((e) => ({
            chapterNumber,
            trigger: e.trigger,
            emotion: e.emotion,
            intensity: INTENSITY_MAP[e.intensity] ?? 0.5,
            unresolved: e.intensity !== 'subtle',
          })),
        ].slice(-20); // 保留最近20条
        const latestIntense = imprints.find((e) => e.intensity === 'intense' || e.intensity === 'overwhelming');
        return {
          ...ch,
          psychology: {
            ...psych,
            emotionalMemories: newMemories,
            currentMood: latestIntense?.emotion ?? psych.currentMood,
          },
        };
      });
    }

    // Step 4d: Update character knowledge state from informationGapDeltas + characterFact changes.
    if (lore.informationGapDeltas?.length) {
      finalCharacters = finalCharacters.map((ch) => {
        const ks = ch.knowledgeState ?? { knownFacts: [], falseBeliefs: [], blindSpots: [] };
        const knownFacts = [...(ks.knownFacts ?? [])];
        const blindSpots = [...(ks.blindSpots ?? [])];

        for (const delta of lore.informationGapDeltas!) {
          if (delta.action === 'create' && delta.secret) {
            const knowers = delta.knownBy ?? [];
            if (!knowers.includes(ch.id)) {
              if (!blindSpots.includes(delta.secret.slice(0, 50))) blindSpots.push(delta.secret.slice(0, 50));
            }
          }
          if (delta.action === 'reveal' && delta.gapId) {
            const existing = knownFacts.find((f) => f.factId === delta.gapId);
            if (!existing) {
              knownFacts.push({
                factId: delta.gapId,
                subject: delta.gapId,
                content: `信息差已揭露(ch${chapterNumber})`,
                source: 'witnessed' as const,
                confidence: 'certain' as const,
                acquiredAtChapter: chapterNumber,
                isSecret: false,
              });
              const idx = blindSpots.findIndex((b) => delta.gapId && b.includes(delta.gapId.slice(0, 10)));
              if (idx >= 0) blindSpots.splice(idx, 1);
            }
          }
        }

        return { ...ch, knowledgeState: { knownFacts, falseBeliefs: ks.falseBeliefs ?? [], blindSpots } };
      });
    }

    // Step 5: Apply curiosity deltas to reader tension model.
    let readerTension = state.readerTension ?? {
      activeCuriosities: [],
      recentPayoffs: [],
      chaptersSinceLastPayoff: 0,
    };
    if (lore.curiosityDeltas?.length) {
      const curiosities = [...readerTension.activeCuriosities];
      const payoffs = [...readerTension.recentPayoffs];
      let sincePayoff = readerTension.chaptersSinceLastPayoff + 1;

      for (const delta of lore.curiosityDeltas) {
        if (delta.action === 'seed' && delta.question) {
          curiosities.push({
            id: delta.curiosityId,
            question: delta.question,
            seededAtChapter: chapterNumber,
            lastTeaseAtChapter: 0,
            urgency: 'simmering',
            relatedThreadId: undefined,
            payoffDelivered: false,
          });
        } else if (delta.action === 'tease') {
          const idx = curiosities.findIndex((c) => c.id === delta.curiosityId);
          if (idx >= 0) {
            curiosities[idx] = {
              ...curiosities[idx],
              lastTeaseAtChapter: chapterNumber,
              urgency: this.escalateUrgency(curiosities[idx].urgency),
            };
          }
        } else if (delta.action === 'payoff') {
          const idx = curiosities.findIndex((c) => c.id === delta.curiosityId);
          if (idx >= 0) {
            payoffs.push({
              curiosityId: delta.curiosityId,
              question: curiosities[idx].question,
              payoffAtChapter: chapterNumber,
              satisfactionType: delta.satisfactionType ?? 'full_answer',
            });
            curiosities.splice(idx, 1);
            sincePayoff = 0;
          }
        }
      }

      readerTension = {
        activeCuriosities: curiosities,
        recentPayoffs: payoffs.slice(-10),
        chaptersSinceLastPayoff: sincePayoff,
      };
    } else {
      readerTension = {
        ...readerTension,
        chaptersSinceLastPayoff: readerTension.chaptersSinceLastPayoff + 1,
        activeCuriosities: readerTension.activeCuriosities.map((c) => ({
          ...c,
          urgency: this.decayUrgency(c, chapterNumber),
        })),
      };
    }

    // Step 6: Apply information gap deltas.
    let informationLedger = state.informationLedger ?? {
      activeGaps: [],
      resolvedGaps: [],
    };
    if (lore.informationGapDeltas?.length) {
      const active = [...informationLedger.activeGaps];
      const resolved = [...informationLedger.resolvedGaps];
      for (const delta of lore.informationGapDeltas) {
        if (delta.action === 'create' && delta.secret) {
          active.push({
            id: delta.gapId,
            secret: delta.secret,
            knownBy: delta.knownBy ?? [],
            unknownTo: delta.unknownTo ?? [],
            dramaticPotential: delta.dramaticPotential ?? 'medium',
            seededAtChapter: chapterNumber,
            type: delta.type ?? 'mystery',
            resolved: false,
          });
        } else if (delta.action === 'reveal') {
          const idx = active.findIndex((g) => g.id === delta.gapId);
          if (idx >= 0) {
            resolved.push({ ...active[idx], resolved: true, resolvedAtChapter: chapterNumber });
            active.splice(idx, 1);
          }
        } else if (delta.action === 'expand') {
          const idx = active.findIndex((g) => g.id === delta.gapId);
          if (idx >= 0) {
            const g = active[idx];
            active[idx] = {
              ...g,
              knownBy: [...new Set([...g.knownBy, ...(delta.knownBy ?? [])])],
              unknownTo: [...new Set([...g.unknownTo, ...(delta.unknownTo ?? [])])],
              dramaticPotential: delta.dramaticPotential ?? g.dramaticPotential,
            };
          }
        }
      }
      informationLedger = { activeGaps: active, resolvedGaps: resolved.slice(-20) };
    }

    // Step 7: Apply dopamine schedule.
    let dopamineSchedule = state.dopamineSchedule ?? {
      history: [],
      chaptersSinceMinor: 0,
      chaptersSinceMedium: 0,
      chaptersSinceMajor: 0,
    };
    const SCALE_RANK: Record<string, number> = {
      personal: 0, group: 1, faction: 2, regional: 3,
      national: 4, continental: 5, world: 6,
    };
    const events = lore.satisfactionEvents ?? [];
    if (events.length > 0) {
      const newHistory = [
        ...dopamineSchedule.history,
        ...events.map((e) => ({ ...e, deliveredAtChapter: chapterNumber })),
      ].slice(-50);
      const hasMinor = events.some((e) => e.intensity === 'minor' || e.intensity === 'medium' || e.intensity === 'major' || e.intensity === 'climactic');
      const hasMedium = events.some((e) => e.intensity === 'medium' || e.intensity === 'major' || e.intensity === 'climactic');
      const hasMajor = events.some((e) => e.intensity === 'major' || e.intensity === 'climactic');
      const maxScale = events.reduce((max, e) => {
        const rank = SCALE_RANK[e.scale ?? 'personal'] ?? 0;
        return rank > (SCALE_RANK[max] ?? 0) ? (e.scale ?? 'personal') : max;
      }, dopamineSchedule.currentStageScale ?? 'personal');
      const peakRank = SCALE_RANK[maxScale] ?? 0;
      const currentPeakRank = SCALE_RANK[dopamineSchedule.peakScaleReached ?? 'personal'] ?? 0;
      dopamineSchedule = {
        history: newHistory,
        chaptersSinceMinor: hasMinor ? 0 : dopamineSchedule.chaptersSinceMinor + 1,
        chaptersSinceMedium: hasMedium ? 0 : dopamineSchedule.chaptersSinceMedium + 1,
        chaptersSinceMajor: hasMajor ? 0 : dopamineSchedule.chaptersSinceMajor + 1,
        currentStageScale: maxScale as any,
        peakScaleReached: (peakRank > currentPeakRank ? maxScale : dopamineSchedule.peakScaleReached ?? 'personal') as any,
      };
    } else {
      dopamineSchedule = {
        ...dopamineSchedule,
        chaptersSinceMinor: dopamineSchedule.chaptersSinceMinor + 1,
        chaptersSinceMedium: dopamineSchedule.chaptersSinceMedium + 1,
        chaptersSinceMajor: dopamineSchedule.chaptersSinceMajor + 1,
      };
    }

    // Step 8: Collect foreshadowing seeds.
    const pendingSeeds = [...(state.pendingForeshadowingSeeds ?? [])];
    if (lore.foreshadowingOpportunities?.length) {
      for (const opp of lore.foreshadowingOpportunities) {
        pendingSeeds.push({
          id: `fs_${chapterNumber}_${opp.targetChapterNumber}`,
          targetChapterNumber: opp.targetChapterNumber,
          insertionType: opp.insertionType,
          content: opp.suggestedContent,
          insertAfterParagraph: opp.insertAfterParagraph,
          reason: opp.reason,
          triggeredByChapter: chapterNumber,
          applied: false,
        });
      }
    }

    // Step 9: Apply story clock.
    let storyClock = state.storyClock ?? {
      currentDay: 1, currentTimeOfDay: 'morning' as const,
      season: 'unknown' as const, daysSinceStoryStart: 0,
    };
    if (lore.timeDelta) {
      storyClock = {
        ...storyClock,
        currentDay: storyClock.currentDay + (lore.timeDelta.daysElapsed ?? 0),
        daysSinceStoryStart: storyClock.daysSinceStoryStart + (lore.timeDelta.daysElapsed ?? 0),
        currentTimeOfDay: lore.timeDelta.endTimeOfDay ?? storyClock.currentTimeOfDay,
        season: lore.timeDelta.seasonChange ?? storyClock.season,
        calendarNote: lore.timeDelta.calendarNote ?? storyClock.calendarNote,
        lastUpdatedAtChapter: chapterNumber,
      };
    }

    // Step 10: Apply address deltas.
    let addressMatrix = [...(state.addressMatrix ?? [])];
    if (lore.addressDeltas?.length) {
      for (const ad of lore.addressDeltas) {
        const existing = addressMatrix.findIndex(
          (a) => a.fromCharacterId === ad.fromCharacterId && a.toCharacterId === ad.toCharacterId,
        );
        if (existing >= 0) {
          addressMatrix[existing] = { ...addressMatrix[existing], address: ad.address };
        } else {
          addressMatrix.push({
            fromCharacterId: ad.fromCharacterId,
            toCharacterId: ad.toCharacterId,
            address: ad.address,
            context: ad.context,
            firstUsedChapter: chapterNumber,
          });
        }
      }
    }

    // Step 11: Apply scene snapshot.
    const lastSceneSnapshot = lore.sceneSnapshot
      ? { ...lore.sceneSnapshot, chapterNumber }
      : state.lastSceneSnapshot;

    // Step 12: Apply location profile deltas.
    let finalLocations = applied.locations ?? locations;
    if (lore.locationProfileDeltas?.length) {
      finalLocations = finalLocations.map((loc) => {
        const deltas = lore.locationProfileDeltas!.filter((d) => d.locationId === loc.id);
        if (!deltas.length) return loc;
        const p = loc.profile ?? {};
        for (const d of deltas) {
          if (d.field === 'terrain') p.terrain = d.description;
          else if (d.field === 'climate') p.climate = d.description;
          else if (d.field === 'architecture') p.architecture = d.description;
          else if (d.field === 'culture') p.culture = d.description;
          else if (d.field === 'history') p.history = d.description;
          else if (d.field === 'sensory') {
            p.sensoryDetails = { ...(p.sensoryDetails ?? {}), atmosphere: d.description };
          }
        }
        return { ...loc, profile: p };
      });
    }

    // Step 13: Apply item profile deltas.
    let finalItems = applied.items ?? items;
    if (lore.itemProfileDeltas?.length) {
      finalItems = finalItems.map((item) => {
        const deltas = lore.itemProfileDeltas!.filter((d) => d.itemId === item.id);
        if (!deltas.length) return item;
        const p = item.profile ?? {};
        for (const d of deltas) {
          if (d.field === 'appearance') p.appearance = d.description;
          else if (d.field === 'origin') p.origin = d.description;
          else if (d.field === 'limitation') p.limitations = d.description;
          else if (d.field === 'evolution') {
            p.evolutionStages = [...(p.evolutionStages ?? []),
              { stage: d.description, description: d.description, unlockedAtChapter: chapterNumber }];
          }
        }
        return { ...item, profile: p };
      });
    }

    // Step 14: Apply faction deltas.
    let factions = [...(state.factions ?? [])];
    if (lore.factionDeltas?.length) {
      for (const fd of lore.factionDeltas) {
        if (fd.action === 'create' && fd.factionName) {
          const exists = factions.some((f) => f.id === fd.factionId);
          if (!exists) {
            factions.push({
              id: fd.factionId,
              name: fd.factionName,
              type: fd.factionType ?? 'other',
              description: fd.description ?? '',
              hierarchy: [],
              leaderId: null,
              headquartersLocationId: null,
              territory: [],
              members: fd.characterId ? [{ characterId: fd.characterId, rank: fd.rank ?? '成员' }] : [],
              relations: [],
              rules: [],
              firstSeenChapter: chapterNumber,
            });
          }
        } else if (fd.action === 'member_join' && fd.characterId) {
          const fi = factions.findIndex((f) => f.id === fd.factionId);
          if (fi >= 0) {
            const existing = factions[fi].members.find((m) => m.characterId === fd.characterId);
            if (!existing) {
              factions[fi] = {
                ...factions[fi],
                members: [...factions[fi].members, {
                  characterId: fd.characterId,
                  rank: fd.rank ?? '成员',
                  joinedAtChapter: chapterNumber,
                }],
              };
            }
            const char = finalCharacters.find((c) => c.id === fd.characterId);
            if (char) {
              finalCharacters = finalCharacters.map((c) =>
                c.id === fd.characterId ? { ...c, factionId: fd.factionId, factionRank: fd.rank } : c,
              );
            }
          }
        } else if (fd.action === 'member_leave' && fd.characterId) {
          const fi = factions.findIndex((f) => f.id === fd.factionId);
          if (fi >= 0) {
            factions[fi] = {
              ...factions[fi],
              members: factions[fi].members.filter((m) => m.characterId !== fd.characterId),
            };
            finalCharacters = finalCharacters.map((c) =>
              c.id === fd.characterId && c.factionId === fd.factionId
                ? { ...c, factionId: null, factionRank: undefined }
                : c,
            );
          }
        } else if (fd.action === 'rank_change' && fd.characterId && fd.rank) {
          const fi = factions.findIndex((f) => f.id === fd.factionId);
          if (fi >= 0) {
            factions[fi] = {
              ...factions[fi],
              members: factions[fi].members.map((m) =>
                m.characterId === fd.characterId ? { ...m, rank: fd.rank! } : m,
              ),
            };
            finalCharacters = finalCharacters.map((c) =>
              c.id === fd.characterId ? { ...c, factionRank: fd.rank } : c,
            );
          }
        } else if (fd.action === 'relation_change' && fd.targetFactionId && fd.relationType) {
          const fi = factions.findIndex((f) => f.id === fd.factionId);
          if (fi >= 0) {
            const rels = [...factions[fi].relations];
            const ri = rels.findIndex((r) => r.targetFactionId === fd.targetFactionId);
            const entry = {
              targetFactionId: fd.targetFactionId,
              relationType: fd.relationType!,
              strength: fd.relationStrength ?? 0,
              notes: fd.description,
            };
            if (ri >= 0) rels[ri] = entry;
            else rels.push(entry);
            factions[fi] = { ...factions[fi], relations: rels };
          }
        } else if (fd.action === 'update') {
          const fi = factions.findIndex((f) => f.id === fd.factionId);
          if (fi >= 0 && fd.description) {
            factions[fi] = { ...factions[fi], description: fd.description };
          }
        }
      }
    }

    // Step 15: Apply commitment deltas.
    let commitments = [...(state.activeCommitments ?? [])];
    if (lore.commitmentDeltas?.length) {
      for (const cd of lore.commitmentDeltas) {
        if (cd.action === 'create' && cd.content && cd.type) {
          const exists = commitments.some((c) => c.id === cd.commitmentId);
          if (!exists) {
            commitments.push({
              id: cd.commitmentId,
              characterId: cd.characterId,
              type: cd.type,
              content: cd.content,
              targetCharacterId: cd.targetCharacterId,
              deadline: cd.deadline,
              status: 'active',
              seededAtChapter: chapterNumber,
              urgency: 'background',
            });
          }
        } else if (cd.action === 'fulfill') {
          commitments = commitments.map((c) =>
            c.id === cd.commitmentId ? { ...c, status: 'fulfilled' as const, resolvedAtChapter: chapterNumber } : c,
          );
        } else if (cd.action === 'break') {
          commitments = commitments.map((c) =>
            c.id === cd.commitmentId ? { ...c, status: 'broken' as const, resolvedAtChapter: chapterNumber } : c,
          );
        } else if (cd.action === 'progress') {
          commitments = commitments.map((c) =>
            c.id === cd.commitmentId ? { ...c, urgency: 'active' as const } : c,
          );
        } else if (cd.action === 'expire') {
          commitments = commitments.map((c) =>
            c.id === cd.commitmentId ? { ...c, status: 'expired' as const, resolvedAtChapter: chapterNumber } : c,
          );
        }
      }
    }
    for (const c of commitments) {
      if (c.status !== 'active') continue;
      if (c.deadlineChapter && chapterNumber > c.deadlineChapter) {
        c.urgency = 'overdue';
      } else if (c.deadlineChapter && chapterNumber >= c.deadlineChapter - 3) {
        c.urgency = 'imminent';
      } else if (chapterNumber - c.seededAtChapter >= 10) {
        c.urgency = c.urgency === 'background' ? 'active' : c.urgency;
      }
    }

    // Step 16: Track hook type for variety enforcement.
    const recentHookTypes = [...(state.recentHookTypes ?? [])];
    if (lore.hookClassification) {
      recentHookTypes.push({
        chapterNumber,
        hookType: lore.hookClassification.hookType,
      });
      while (recentHookTypes.length > 10) recentHookTypes.shift();
    }

    // Merge back into state.
    return {
      ...state,
      characters: finalCharacters,
      locations: finalLocations,
      items: finalItems,
      factions,
      activeCommitments: commitments,
      chapterSummaries: applied.chapterSummaries,
      openPlotThreads: applied.openPlotThreads,
      relationGraph: applied.relationGraph ?? state.relationGraph,
      timelineEvents: applied.timelineEvents ?? state.timelineEvents,
      plotThreadLedger: applied.plotThreadLedger ?? state.plotThreadLedger,
      characterFactLedger: applied.characterFactLedger ?? state.characterFactLedger,
      lastHook: applied.lastHook,
      recentHookTypes,
      readerTension,
      informationLedger,
      dopamineSchedule,
      pendingForeshadowingSeeds: pendingSeeds.filter((s) => !s.applied),
      foreshadowingBank: this.updateForeshadowingBank(state, lore, chapterNumber),
      storyClock,
      addressMatrix,
      lastSceneSnapshot,
      recentEmotionalImprints: [
        ...(state.recentEmotionalImprints ?? []),
        ...(lore.emotionalImprints ?? []).map((e) => ({ ...e, chapterNumber })),
      ].slice(-30), // 保留最近30条情感印记
    };
  }

  private escalateUrgency(
    current: 'simmering' | 'building' | 'boiling' | 'overdue',
  ): 'simmering' | 'building' | 'boiling' | 'overdue' {
    const levels = ['simmering', 'building', 'boiling', 'overdue'] as const;
    const idx = levels.indexOf(current);
    return levels[Math.min(idx + 1, levels.length - 1)];
  }

  private decayUrgency(
    curiosity: { seededAtChapter?: number; urgency?: string },
    currentChapter: number,
  ): 'simmering' | 'building' | 'boiling' | 'overdue' {
    const seeded = curiosity.seededAtChapter ?? currentChapter;
    const age = currentChapter - seeded;
    if (age >= 15) return 'overdue';
    if (age >= 8) return 'boiling';
    if (age >= 4) return 'building';
    return 'simmering';
  }

  private applyLoreDeltas(state: any, lore: LoreRecord, contract: ChapterContract): any {
    const chapterNumber = lore.chapterNumber;
    const knownLocationIds = new Set<string>(state.locations.map((x) => x.id));
    const knownItemIds = new Set<string>(state.items.map((x) => x.id));

    const lifecycleAppliedCharacters = this.applyCharacterLifecycleDeltas(
      state.characters, lore, chapterNumber, knownLocationIds, knownItemIds,
    );
    const characters = this.applyCharacterAliasDeltas(lifecycleAppliedCharacters, lore);
    const knownCharacterIds = new Set<string>(characters.map((x) => x.id));
    const characterFactLedger = this.applyCharacterFactDeltas(
      state.characterFactLedger ?? [], lore, chapterNumber, knownCharacterIds,
    );
    const relationGraph = this.applyRelationshipDeltas(
      state.relationGraph ?? [], lore, chapterNumber, knownCharacterIds,
    );
    const timelineEvents = this.applyTimelineEventDeltas(
      state.timelineEvents ?? [], lore, chapterNumber, knownCharacterIds, knownLocationIds,
    );
    const plotThreadLedger = this.applyLegacyLoopSignals(
      this.applyPlotThreadDeltas(
        state.plotThreadLedger ?? [], lore, chapterNumber,
        knownCharacterIds, knownLocationIds, knownItemIds,
      ),
      lore, chapterNumber,
    );

    const openPlotThreads = plotThreadLedger
      .filter((thread) => thread.status === 'open')
      .map((thread) => thread.label)
      .filter((label) => label.trim().length > 0)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

    const hookFromContract = contract.hookRequirement?.trim();
    const lastHook = hookFromContract && hookFromContract.length >= 4
      ? hookFromContract
      : state.lastHook;

    return {
      ...state,
      characters,
      relationGraph,
      timelineEvents,
      plotThreadLedger,
      characterFactLedger,
      chapterSummaries: [
        ...state.chapterSummaries,
        { chapterNumber: contract.chapterNumber, summary: lore.summary },
      ],
      openPlotThreads,
      lastHook,
    };
  }

  normalizeBootstrapCharacters(
    characters: StoryState['characters'],
  ): StoryState['characters'] {
    return characters.map((character) => {
      const lifecycleStatus = character.status.lifecycleStatus ?? 'active';
      const narrativeImportance =
        character.status.narrativeImportance ??
        (character.role === 'protagonist' ? 'core'
          : character.role === 'villain' ? 'major' : 'minor');
      return {
        ...character,
        aliases: this.normalizeCharacterAliases(character.aliases ?? []),
        status: {
          ...character.status,
          lifecycleStatus,
          firstSeenChapter: character.status.firstSeenChapter ?? 1,
          lastSeenChapter: character.status.lastSeenChapter ?? 1,
          plannedReturnChapter: character.status.plannedReturnChapter ?? null,
          narrativeImportance,
          dormantReference: character.status.dormantReference ?? false,
        },
      };
    });
  }

  buildInitialRelationGraph(
    characters: StoryState['characters'],
    seededRelations: BootstrapRelationSeed[],
  ): RelationshipEdge[] {
    const knownCharacterIds = new Set(characters.map((x) => x.id));
    const sanitizedSeeded: RelationshipEdge[] = seededRelations
      .filter(
        (edge) =>
          knownCharacterIds.has(edge.fromCharacterId) &&
          knownCharacterIds.has(edge.toCharacterId) &&
          edge.fromCharacterId !== edge.toCharacterId,
      )
      .map((edge) => ({
        id: this.buildStableId('rel', edge.fromCharacterId, edge.toCharacterId, edge.relationType),
        fromCharacterId: edge.fromCharacterId,
        toCharacterId: edge.toCharacterId,
        relationType: edge.relationType,
        strength: edge.strength,
        status: 'active',
        validFromChapter: 1,
        validToChapter: null,
        evidenceEventId: null,
        notes: edge.notes ?? '',
      }));

    if (sanitizedSeeded.length > 0) return sanitizedSeeded;

    const protagonist = characters.find((x) => x.role === 'protagonist') ?? characters[0];
    if (!protagonist) return [];

    return characters
      .filter((x) => x.id !== protagonist.id)
      .map((character) => {
        const relationType =
          character.role === 'villain' ? '对立'
            : character.role === 'supporting' ? '盟友' : '接触';
        const strength =
          character.role === 'villain' ? -6
            : character.role === 'supporting' ? 4 : 1;
        return {
          id: this.buildStableId('rel', protagonist.id, character.id, relationType),
          fromCharacterId: protagonist.id,
          toCharacterId: character.id,
          relationType,
          strength,
          status: 'active',
          validFromChapter: 1,
          validToChapter: null,
          evidenceEventId: null,
          notes: 'bootstrap_default',
        };
      });
  }

  // ---------------------------------------------------------------------------
  // Character lifecycle
  // ---------------------------------------------------------------------------

  private applyCharacterLifecycleDeltas(
    characters: StoryState['characters'],
    lore: LoreRecord,
    chapterNumber: number,
    knownLocationIds: Set<string>,
    knownItemIds: Set<string>,
  ): StoryState['characters'] {
    const characterMap = new Map(
      characters.map((c) => [c.id, {
        ...c,
        aliases: this.normalizeCharacterAliases(c.aliases ?? []),
        status: {
          ...c.status,
          lifecycleStatus: c.status.lifecycleStatus ?? 'active',
          firstSeenChapter: c.status.firstSeenChapter ?? 1,
          lastSeenChapter: c.status.lastSeenChapter ?? 1,
          plannedReturnChapter: c.status.plannedReturnChapter ?? null,
          narrativeImportance: c.status.narrativeImportance ?? 'major',
          dormantReference: c.status.dormantReference ?? false,
        },
      }]),
    );

    for (const delta of lore.characterLifecycleDeltas) {
      const current = characterMap.get(delta.characterId);
      if (!current) continue;

      const inventory = new Set(
        current.status.inventory.filter((itemId) => knownItemIds.has(itemId)),
      );
      delta.addInventoryItemIds
        .filter((itemId) => knownItemIds.has(itemId))
        .forEach((itemId) => inventory.add(itemId));
      delta.removeInventoryItemIds.forEach((itemId) => inventory.delete(itemId));

      const currentLifecycleStatus = current.status.lifecycleStatus ?? 'active';
      let nextLifecycleStatus = delta.lifecycleStatus ?? currentLifecycleStatus;
      if (
        (currentLifecycleStatus === 'dead' || currentLifecycleStatus === 'exited') &&
        nextLifecycleStatus === 'active'
      ) {
        nextLifecycleStatus = currentLifecycleStatus;
      }
      let plannedReturnChapter =
        delta.plannedReturnChapter !== undefined
          ? delta.plannedReturnChapter
          : current.status.plannedReturnChapter;
      if (
        nextLifecycleStatus === 'return_planned' &&
        plannedReturnChapter !== null &&
        plannedReturnChapter !== undefined &&
        plannedReturnChapter <= chapterNumber
      ) {
        plannedReturnChapter = chapterNumber + 1;
      }
      if (nextLifecycleStatus !== 'return_planned') {
        plannedReturnChapter = null;
      }
      const nextLocationId =
        delta.locationId && knownLocationIds.has(delta.locationId)
          ? delta.locationId
          : current.status.locationId;

      characterMap.set(delta.characterId, {
        ...current,
        aliases: this.normalizeCharacterAliases(current.aliases ?? []),
        status: {
          ...current.status,
          locationId: nextLocationId,
          state: delta.stateText ?? current.status.state,
          level: delta.level ?? current.status.level,
          inventory: [...inventory],
          lifecycleStatus: nextLifecycleStatus,
          lastSeenChapter: chapterNumber,
          plannedReturnChapter: plannedReturnChapter ?? null,
          narrativeImportance: delta.narrativeImportance ?? current.status.narrativeImportance,
          dormantReference: delta.dormantReference ?? current.status.dormantReference,
        },
      });
    }

    return [...characterMap.values()];
  }

  // ---------------------------------------------------------------------------
  // Character aliases
  // ---------------------------------------------------------------------------

  private applyCharacterAliasDeltas(
    characters: StoryState['characters'],
    lore: LoreRecord,
  ): StoryState['characters'] {
    const characterMap = new Map(
      characters.map((c) => [c.id, { ...c, aliases: this.normalizeCharacterAliases(c.aliases ?? []) }]),
    );
    const aliasOwner = new Map<string, string>();

    for (const character of characterMap.values()) {
      const normalizedName = this.normalizeAliasToken(character.name);
      if (normalizedName) aliasOwner.set(normalizedName, character.id);
      for (const alias of character.aliases ?? []) {
        const n = this.normalizeAliasToken(alias);
        if (n) aliasOwner.set(n, character.id);
      }
    }

    for (const delta of lore.characterAliasDeltas ?? []) {
      const character = characterMap.get(delta.characterId);
      if (!character) continue;
      const normalizedAlias = this.normalizeAliasToken(delta.alias);
      if (!normalizedAlias) continue;
      const normalizedName = this.normalizeAliasToken(character.name);
      const nextAliases = new Set(character.aliases ?? []);

      if (delta.action === 'add') {
        if (normalizedAlias === normalizedName) continue;
        const ownedBy = aliasOwner.get(normalizedAlias);
        if (ownedBy && ownedBy !== delta.characterId) continue;
        nextAliases.add(delta.alias.trim());
        aliasOwner.set(normalizedAlias, delta.characterId);
      } else {
        const removedAlias = [...nextAliases].find(
          (a) => this.normalizeAliasToken(a) === normalizedAlias,
        );
        if (removedAlias) {
          nextAliases.delete(removedAlias);
          if (aliasOwner.get(normalizedAlias) === delta.characterId) {
            aliasOwner.delete(normalizedAlias);
          }
        }
      }

      characterMap.set(delta.characterId, {
        ...character,
        aliases: this.normalizeCharacterAliases([...nextAliases]),
      });
    }

    return [...characterMap.values()];
  }

  // ---------------------------------------------------------------------------
  // Character facts
  // ---------------------------------------------------------------------------

  private applyCharacterFactDeltas(
    ledger: CharacterFact[],
    lore: LoreRecord,
    chapterNumber: number,
    knownCharacterIds: Set<string>,
  ): CharacterFact[] {
    const rumorThreshold = this.getCharacterFactRumorThreshold();
    const factKey = (cid: string, fact: string): string =>
      `${cid}::${this.normalizeFactToken(fact)}`;
    const factMap = new Map(ledger.map((f) => [factKey(f.characterId, f.fact), f]));

    for (const delta of lore.characterFactDeltas ?? []) {
      if (!knownCharacterIds.has(delta.characterId)) continue;
      const factText = delta.fact.trim();
      if (!factText) continue;

      const key = factKey(delta.characterId, factText);
      const existing = factMap.get(key);
      const requestedConfidence = delta.confidence ?? existing?.confidence ?? 0.72;
      const confidence = this.clamp01(requestedConfidence);
      const action = delta.action ?? 'add';

      if (action === 'deprecate') {
        if (!existing) continue;
        factMap.set(key, {
          ...existing,
          status: 'deprecated',
          lastConfirmedChapter: chapterNumber,
          notes: delta.evidence || existing.notes,
        });
        continue;
      }

      const mergedConfidence = Math.max(existing?.confidence ?? 0, confidence);
      const qualityStatus: CharacterFact['status'] =
        mergedConfidence < rumorThreshold ? 'rumor' : 'active';
      factMap.set(key, {
        id: existing?.id ?? this.buildStableId('fact', delta.characterId, factText),
        characterId: delta.characterId,
        fact: factText,
        category: delta.category ?? existing?.category ?? 'history',
        status: qualityStatus,
        confidence: mergedConfidence,
        firstSeenChapter: existing?.firstSeenChapter ?? chapterNumber,
        lastConfirmedChapter: chapterNumber,
        sourceChapter: existing?.sourceChapter ?? chapterNumber,
        sourceEventId: existing?.sourceEventId ?? null,
        notes: delta.evidence || existing?.notes || '',
      });
    }

    return [...factMap.values()].sort((a, b) => {
      if (a.characterId !== b.characterId) return a.characterId.localeCompare(b.characterId);
      if (b.lastConfirmedChapter !== a.lastConfirmedChapter) return b.lastConfirmedChapter - a.lastConfirmedChapter;
      return b.confidence - a.confidence;
    });
  }

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------

  private applyRelationshipDeltas(
    relationGraph: RelationshipEdge[],
    lore: LoreRecord,
    chapterNumber: number,
    knownCharacterIds: Set<string>,
  ): RelationshipEdge[] {
    const relationKey = (f: string, t: string, r: string) => `${f}::${t}::${r}`;
    const relationMap = new Map(
      relationGraph.map((e) => [relationKey(e.fromCharacterId, e.toCharacterId, e.relationType), e]),
    );

    for (const delta of lore.relationshipDeltas) {
      if (
        !knownCharacterIds.has(delta.fromCharacterId) ||
        !knownCharacterIds.has(delta.toCharacterId) ||
        delta.fromCharacterId === delta.toCharacterId
      ) continue;

      const key = relationKey(delta.fromCharacterId, delta.toCharacterId, delta.relationType);
      const existing = relationMap.get(key);
      const requestedCloseAt =
        delta.closeAtChapter !== null && delta.closeAtChapter !== undefined
          ? delta.closeAtChapter
          : existing?.validToChapter ?? null;
      const requestedStatus = delta.status ?? existing?.status ?? 'active';
      const status =
        requestedCloseAt !== null
          ? requestedCloseAt <= chapterNumber
            ? 'historical'
            : requestedStatus === 'hidden' ? 'hidden' : 'active'
          : requestedStatus;

      relationMap.set(key, {
        id: existing?.id ?? this.buildStableId('rel', delta.fromCharacterId, delta.toCharacterId, delta.relationType),
        fromCharacterId: delta.fromCharacterId,
        toCharacterId: delta.toCharacterId,
        relationType: delta.relationType,
        strength: delta.strength,
        status,
        validFromChapter: existing?.validFromChapter ?? chapterNumber,
        validToChapter: requestedCloseAt,
        evidenceEventId: existing?.evidenceEventId ?? null,
        notes: delta.evidence || existing?.notes || '',
      });
    }

    return [...relationMap.values()].sort((a, b) => a.validFromChapter - b.validFromChapter);
  }

  // ---------------------------------------------------------------------------
  // Timeline events
  // ---------------------------------------------------------------------------

  private applyTimelineEventDeltas(
    timelineEvents: TimelineEvent[],
    lore: LoreRecord,
    chapterNumber: number,
    knownCharacterIds: Set<string>,
    knownLocationIds: Set<string>,
  ): TimelineEvent[] {
    const nextEvents = [...timelineEvents];
    const knownEventIds = new Set(nextEvents.map((x) => x.id));
    let nextSequence =
      nextEvents
        .filter((x) => x.chapterNumber === chapterNumber)
        .reduce((max, x) => Math.max(max, x.sequence), -1) + 1;

    for (const delta of lore.timelineEventDeltas) {
      const baseId = this.buildStableId('evt', String(chapterNumber), String(nextSequence), delta.eventType, delta.title);
      let id = baseId;
      let suffix = 1;
      while (knownEventIds.has(id)) { id = `${baseId}_${suffix}`; suffix += 1; }

      nextEvents.push({
        id,
        chapterNumber,
        sequence: nextSequence,
        eventType: delta.eventType,
        title: delta.title,
        summary: delta.summary,
        locationId: delta.locationId && knownLocationIds.has(delta.locationId) ? delta.locationId : null,
        characterIds: [...new Set(delta.characterIds.filter((x) => knownCharacterIds.has(x)))],
        prerequisiteEventIds: delta.prerequisiteEventIds.filter((x) => knownEventIds.has(x)),
        consequenceThreadIds: [...new Set(delta.consequenceThreadIds)],
      });
      knownEventIds.add(id);
      nextSequence += 1;
    }

    return nextEvents.sort((a, b) =>
      a.chapterNumber === b.chapterNumber ? a.sequence - b.sequence : a.chapterNumber - b.chapterNumber,
    );
  }

  // ---------------------------------------------------------------------------
  // Plot threads
  // ---------------------------------------------------------------------------

  private applyPlotThreadDeltas(
    plotThreadLedger: PlotThread[],
    lore: LoreRecord,
    chapterNumber: number,
    knownCharacterIds: Set<string>,
    knownLocationIds: Set<string>,
    knownItemIds: Set<string>,
  ): PlotThread[] {
    const threadMap = new Map(plotThreadLedger.map((t) => [t.id, t]));
    const threadIdByLabel = new Map(
      plotThreadLedger
        .map((t) => [this.normalizeThreadLabel(t.label), t.id] as const)
        .filter(([l]) => l.length > 0),
    );

    for (const delta of lore.plotThreadDeltas) {
      if (!delta.threadId.trim()) continue;
      const normalizedLabel = this.normalizeThreadLabel(delta.label);
      const resolvedThreadId =
        threadMap.has(delta.threadId)
          ? delta.threadId
          : threadIdByLabel.get(normalizedLabel) ?? delta.threadId;
      const existing = threadMap.get(resolvedThreadId);
      const mergedCharacters = this.mergeUnique(
        existing?.relatedCharacterIds ?? [], delta.relatedCharacterIds.filter((x) => knownCharacterIds.has(x)),
      );
      const mergedLocations = this.mergeUnique(
        existing?.relatedLocationIds ?? [], delta.relatedLocationIds.filter((x) => knownLocationIds.has(x)),
      );
      const mergedItems = this.mergeUnique(
        existing?.relatedItemIds ?? [], delta.relatedItemIds.filter((x) => knownItemIds.has(x)),
      );
      const nextStatus =
        delta.action === 'payoff' ? 'payoff'
          : delta.action === 'expire' ? 'expired'
            : delta.action === 'touch' ? existing?.status ?? 'open'
              : delta.action === 'open' && existing && (existing.status === 'payoff' || existing.status === 'expired')
                ? existing.status
                : 'open';
      const stableLabel = delta.label || existing?.label || resolvedThreadId;
      threadMap.set(resolvedThreadId, {
        id: resolvedThreadId,
        label: stableLabel,
        status: nextStatus,
        setupChapter: existing?.setupChapter ?? chapterNumber,
        lastTouchedChapter: chapterNumber,
        plannedPayoffStartChapter: delta.plannedPayoffStartChapter ?? existing?.plannedPayoffStartChapter ?? null,
        plannedPayoffEndChapter: delta.plannedPayoffEndChapter ?? existing?.plannedPayoffEndChapter ?? null,
        relatedCharacterIds: mergedCharacters,
        relatedLocationIds: mergedLocations,
        relatedItemIds: mergedItems,
        notes: delta.notes || existing?.notes || '',
      });
      threadIdByLabel.set(this.normalizeThreadLabel(stableLabel), resolvedThreadId);
    }

    return [...threadMap.values()].sort((a, b) => a.setupChapter - b.setupChapter);
  }

  private applyLegacyLoopSignals(
    plotThreadLedger: PlotThread[],
    lore: LoreRecord,
    chapterNumber: number,
  ): PlotThread[] {
    const threadMap = new Map(plotThreadLedger.map((t) => [t.id, t]));
    const findByLabel = (label: string) => [...threadMap.values()].find((t) => t.label === label);

    for (const label of lore.openLoops) {
      const existing = findByLabel(label);
      const id = existing?.id ?? this.buildStableId('thread', label);
      threadMap.set(id, {
        id, label, status: 'open',
        setupChapter: existing?.setupChapter ?? chapterNumber,
        lastTouchedChapter: chapterNumber,
        plannedPayoffStartChapter: existing?.plannedPayoffStartChapter ?? null,
        plannedPayoffEndChapter: existing?.plannedPayoffEndChapter ?? null,
        relatedCharacterIds: existing?.relatedCharacterIds ?? [],
        relatedLocationIds: existing?.relatedLocationIds ?? [],
        relatedItemIds: existing?.relatedItemIds ?? [],
        notes: existing?.notes ?? 'legacy_loop_open_signal',
      });
    }

    for (const label of lore.closedLoops) {
      const existing = findByLabel(label);
      if (!existing) continue;
      threadMap.set(existing.id, { ...existing, status: 'payoff', lastTouchedChapter: chapterNumber });
    }

    return [...threadMap.values()].sort((a, b) => a.setupChapter - b.setupChapter);
  }

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  private mergeUnique(left: string[], right: string[]): string[] {
    return [...new Set([...left, ...right])];
  }

  buildStableId(prefix: string, ...parts: string[]): string {
    const body = parts.map((p) => this.normalizeIdToken(p)).join('_');
    return `${prefix}_${body}`.slice(0, 120);
  }

  normalizeCharacterAliases(aliases: string[]): string[] {
    const dedup = new Map<string, string>();
    for (const alias of aliases) {
      const trimmed = alias.trim();
      const normalized = this.normalizeAliasToken(trimmed);
      if (!normalized) continue;
      if (!dedup.has(normalized)) dedup.set(normalized, trimmed);
    }
    return [...dedup.values()];
  }

  private normalizeAliasToken(alias: string): string {
    return alias.trim().toLowerCase();
  }

  private normalizeFactToken(fact: string): string {
    return fact.replace(/\s+/g, '').trim().toLowerCase();
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private getCharacterFactRumorThreshold(): number {
    return 0.65;
  }

  private normalizeThreadLabel(label: string): string {
    return label.trim().toLowerCase();
  }

  private normalizeIdToken(value: string): string {
    const ascii = value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (ascii) return ascii.slice(0, 24);
    let hash = 0;
    for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return `u${hash.toString(36)}`;
  }

  /** 更新伏笔银行状态：检查本章是否命中了埋设/回收窗口。 */
  private updateForeshadowingBank(state: StoryState, lore: LoreRecord, chapterNumber: number) {
    const bank = state.foreshadowingBank ?? { deposits: [], totalPlanted: 0, totalResolved: 0 };
    if (!bank.deposits.length) return bank;

    const chapterText = lore.summary ?? '';
    const openedThreads = new Set(lore.plotThreadDeltas.filter((d) => d.action === 'open').map((d) => d.label));
    const closedThreads = new Set(lore.plotThreadDeltas.filter((d) => d.action === 'payoff').map((d) => d.label));

    let planted = bank.totalPlanted;
    let resolved = bank.totalResolved;

    const updatedDeposits = bank.deposits.map((d) => {
      if (d.status === 'pending' && chapterNumber >= d.plantWindow.earliestChapter && chapterNumber <= d.plantWindow.latestChapter) {
        const relatedOpened = d.relatedPlotThreadIds.some((id) => openedThreads.has(id));
        const mentionedInSummary = d.label && chapterText.includes(d.label.slice(0, 4));
        if (relatedOpened || mentionedInSummary) {
          planted++;
          return { ...d, status: 'planted' as const, plantedAtChapter: chapterNumber };
        }
      }
      if (d.status === 'planted' && chapterNumber >= d.payoffWindow.earliestChapter) {
        const relatedClosed = d.relatedPlotThreadIds.some((id) => closedThreads.has(id));
        if (relatedClosed) {
          resolved++;
          return { ...d, status: 'resolved' as const, resolvedAtChapter: chapterNumber };
        }
        if (chapterNumber > d.payoffWindow.latestChapter) {
          return { ...d, status: 'expired' as const };
        }
      }
      if (d.status === 'pending' && chapterNumber > d.plantWindow.latestChapter) {
        return { ...d, status: 'expired' as const };
      }
      return d;
    });

    return { deposits: updatedDeposits, totalPlanted: planted, totalResolved: resolved };
  }
}

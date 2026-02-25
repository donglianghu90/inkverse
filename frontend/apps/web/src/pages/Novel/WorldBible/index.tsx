import React, { useEffect, useState } from 'react';
import { history, useParams } from '@umijs/max';
import {
  ArrowLeft,
  BookOpen,
  Crown,
  Globe,
  Loader2,
  MapPin,
  Shield,
  Swords,
  Users,
  Zap,
  AlertCircle,
  GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getWorld, type WorldData, type CharacterInfo, type LocationInfo } from '@/services/novel';
import { RelationGraph } from './RelationGraph';

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  protagonist: { label: '主角', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200', icon: <Crown className="h-3 w-3" /> },
  supporting: { label: '配角', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', icon: <Users className="h-3 w-3" /> },
  villain: { label: '反派', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', icon: <Swords className="h-3 w-3" /> },
  npc: { label: 'NPC', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200', icon: <Users className="h-3 w-3" /> },
};

const DANGER_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: '安全', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  mid: { label: '中等', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  high: { label: '危险', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  extreme: { label: '极危', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

function CharacterCard({ char }: { char: CharacterInfo }) {
  const role = ROLE_CONFIG[char.role] ?? ROLE_CONFIG.npc;
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{char.name}</CardTitle>
          <Badge className={cn('text-xs gap-1', role.color)}>
            {role.icon}
            {role.label}
          </Badge>
        </div>
        {char.aliases && char.aliases.length > 0 && (
          <p className="text-xs text-muted-foreground">
            别名: {char.aliases.join('、')}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">原型: </span>
          <span>{char.archetype}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {char.personalityTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
          ))}
        </div>
        <Separator />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>状态: {char.status.state}</p>
          <p>等级: Lv.{char.status.level}</p>
          {char.status.narrativeImportance && (
            <p>叙事重要度: {char.status.narrativeImportance}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LocationCard({ loc }: { loc: LocationInfo }) {
  const danger = DANGER_CONFIG[loc.dangerLevel] ?? DANGER_CONFIG.low;
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            {loc.name}
          </CardTitle>
          <Badge className={cn('text-xs', danger.color)}>{danger.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{loc.description}</p>
      </CardContent>
    </Card>
  );
}

const WorldBible: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const [world, setWorld] = useState<WorldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      try {
        const data = await getWorld(bookId);
        setWorld(data);
      } catch (e: any) {
        setError(e?.message ?? '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !world) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p>{error ?? '数据不存在'}</p>
        <Button variant="outline" onClick={() => history.push(`/novel/book/${bookId}`)}>返回工作台</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => history.push(`/novel/book/${bookId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" />
            《{world.title}》世界观百科
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{world.seed.logline}</p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview" className="gap-1 text-xs">
            <BookOpen className="h-3.5 w-3.5" />
            概览
          </TabsTrigger>
          <TabsTrigger value="characters" className="gap-1 text-xs">
            <Users className="h-3.5 w-3.5" />
            角色
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-1 text-xs">
            <MapPin className="h-3.5 w-3.5" />
            地点
          </TabsTrigger>
          <TabsTrigger value="power" className="gap-1 text-xs">
            <Zap className="h-3.5 w-3.5" />
            力量体系
          </TabsTrigger>
          <TabsTrigger value="threads" className="gap-1 text-xs">
            <GitBranch className="h-3.5 w-3.5" />
            伏笔线
          </TabsTrigger>
          <TabsTrigger value="relations" className="gap-1 text-xs">
            <Shield className="h-3.5 w-3.5" />
            关系图
          </TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">故事种子</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">类型: </span>
                  <Badge variant="secondary">{world.genre}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">基调: </span>
                  <span>{world.seed.tone}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">核心冲突: </span>
                  <span>{world.seed.coreConflictDirection}</span>
                </div>
                <Separator />
                <div>
                  <p className="text-muted-foreground mb-1">主角概念:</p>
                  <p>{world.seed.protagonistConcept.name} — {world.seed.protagonistConcept.situation}</p>
                  <p className="text-xs text-muted-foreground mt-1">核心欲望: {world.seed.protagonistConcept.coreDesire}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">粗大纲</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {world.roughOutline.points.map((pt, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <Badge variant="outline" className="shrink-0 text-xs capitalize">{pt.phase}</Badge>
                    <div>
                      <p>{pt.description}</p>
                      <p className="text-xs text-muted-foreground">章节: {pt.tentativeChapterRange}</p>
                    </div>
                  </div>
                ))}
                <Separator />
                <div className="text-sm">
                  <span className="text-muted-foreground">结局方向: </span>
                  <span>{world.roughOutline.endingDirection}</span>
                </div>
              </CardContent>
            </Card>

            {world.currentArc && (
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-primary" />
                    当前卷计划
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">卷名: </span>
                    <span>{world.currentArc.arcTitle}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">章节范围: </span>
                    <span>{world.currentArc.startChapter}-{world.currentArc.plannedEndChapter}（高潮第 {world.currentArc.climaxChapter} 章）</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">核心张力: </span>
                    <span>{world.currentArc.coreTension}</span>
                  </div>
                  {world.currentArc.emotionalTheme && (
                    <div>
                      <span className="text-muted-foreground">情感主题: </span>
                      <span>{world.currentArc.emotionalTheme}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-muted-foreground">章节节拍:</p>
                    {world.currentArc.chapterBeats.map((beat) => (
                      <div key={beat.chapterNumber} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline">第 {beat.chapterNumber} 章</Badge>
                        <span>{beat.role}</span>
                        <span className="text-muted-foreground">张力 {beat.tensionLevel}/10</span>
                        <span className="text-muted-foreground">· {beat.briefGoal}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {world.bible && (
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    IP 圣经 (已结晶)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">主线冲突: </span>
                    <span>{world.bible.mainConflict}</span>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">世界规则:</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      {world.bible.worldRules.map((rule, i) => <li key={i}>{rule}</li>)}
                    </ul>
                  </div>
                  {world.bible.redLines.length > 0 && (
                    <div>
                      <p className="text-muted-foreground mb-1">红线 (禁止事项):</p>
                      <div className="flex flex-wrap gap-1">
                        {world.bible.redLines.map((rl, i) => (
                          <Badge key={i} variant="destructive" className="text-xs">{rl}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {world.seed.redLines.length > 0 && !world.bible && (
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">红线 (禁止事项)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {world.seed.redLines.map((rl, i) => (
                      <Badge key={i} variant="destructive" className="text-xs">{rl}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Characters */}
        <TabsContent value="characters">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {world.characters.map((char) => (
              <CharacterCard key={char.id} char={char} />
            ))}
          </div>
          {world.characters.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto opacity-30 mb-2" />
              <p>暂无角色数据</p>
            </div>
          )}
        </TabsContent>

        {/* Locations */}
        <TabsContent value="locations">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {world.locations.map((loc) => (
              <LocationCard key={loc.id} loc={loc} />
            ))}
          </div>
          {world.locations.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <MapPin className="h-10 w-10 mx-auto opacity-30 mb-2" />
              <p>暂无地点数据</p>
            </div>
          )}
        </TabsContent>

        {/* Power System */}
        <TabsContent value="power">
          {world.bible && world.bible.powerSystem.length > 0 ? (
            <div className="space-y-3">
              {[...world.bible.powerSystem]
                .sort((a, b) => a.levelRank - b.levelRank)
                .map((level, i) => (
                  <Card key={i}>
                    <CardContent className="flex items-start gap-4 p-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-lg">
                        {level.levelRank}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">{level.levelName}</p>
                        <p className="text-sm text-muted-foreground mt-1">{level.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-medium">突破边界: </span>{level.boundary}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="h-10 w-10 mx-auto opacity-30 mb-2" />
              <p>力量体系尚未结晶</p>
              <p className="text-xs mt-1">生成更多章节后，AI 将自动提炼力量体系</p>
            </div>
          )}
        </TabsContent>

        {/* Plot Threads */}
        <TabsContent value="threads">
          <div className="space-y-4">
            {world.openPlotThreads.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">当前开放伏笔</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    {world.openPlotThreads.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </CardContent>
              </Card>
            )}
            {world.plotThreadLedger.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">伏笔账本</h3>
                {world.plotThreadLedger.map((thread) => (
                  <Card key={thread.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium text-sm">{thread.label}</p>
                        <p className="text-xs text-muted-foreground">
                          设立: 第{thread.setupChapter}章 / 最近: 第{thread.lastTouchedChapter}章
                        </p>
                      </div>
                      <Badge
                        variant={thread.status === 'open' ? 'default' : thread.status === 'payoff' ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {thread.status === 'open' ? '进行中' : thread.status === 'payoff' ? '已回收' : '已过期'}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <GitBranch className="h-10 w-10 mx-auto opacity-30 mb-2" />
                <p>暂无伏笔线数据</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Relationship Graph */}
        <TabsContent value="relations">
          {world.relationGraph.length > 0 ? (
            <Card>
              <CardContent className="p-4">
                <RelationGraph
                  characters={world.characters}
                  relations={world.relationGraph}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-10 w-10 mx-auto opacity-30 mb-2" />
              <p>暂无角色关系数据</p>
              <p className="text-xs mt-1">生成更多章节后将自动建立关系图</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WorldBible;

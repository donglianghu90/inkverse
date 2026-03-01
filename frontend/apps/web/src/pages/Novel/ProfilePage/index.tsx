import React, { useState, useEffect, useCallback } from 'react';
import { history, useParams } from '@umijs/max';
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertCircle,
  RotateCcw,
  FileEdit,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  getBook,
  getBookProfile,
  updateBookProfile,
  getBookAudience,
  updateBookAudience,
  type BookPromptProfile,
  type AudienceDirective,
  type BookInfo,
} from '@/services/novel';
import ProfileEditor from '../ProfileEditor';
import AudienceEditor from './AudienceEditor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const ProfilePage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<BookInfo | null>(null);
  const [profile, setProfile] = useState<BookPromptProfile | null>(null);
  const [originalProfile, setOriginalProfile] = useState<BookPromptProfile | null>(null);
  const [audience, setAudience] = useState<AudienceDirective | null>(null);
  const [originalAudience, setOriginalAudience] = useState<AudienceDirective | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isProfileDirty = JSON.stringify(profile) !== JSON.stringify(originalProfile);
  const isAudienceDirty = JSON.stringify(audience) !== JSON.stringify(originalAudience);
  const isDirty = isProfileDirty || isAudienceDirty;

  const fetchData = useCallback(async () => {
    if (!bookId) return;
    try {
      const [bookInfo, profileData, audienceData] = await Promise.all([
        getBook(bookId),
        getBookProfile(bookId),
        getBookAudience(bookId).catch(() => null), // 兼容老书没有 audience 的情况
      ]);
      setBook(bookInfo);
      setProfile(profileData);
      setOriginalProfile(structuredClone(profileData));
      
      const defaultAudience: AudienceDirective = {
        audienceTags: [], protagonistFocus: 'male_lead', tonePreference: '',
        relationshipDensity: 'medium', hardConstraints: [], softPreferences: []
      };
      const finalAudience = audienceData || defaultAudience;
      setAudience(finalAudience);
      setOriginalAudience(structuredClone(finalAudience));
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!bookId || !profile || !audience) return;
    setSaving(true);
    setSaved(false);
    try {
      const [updatedProfile, updatedAudience] = await Promise.all([
        isProfileDirty ? updateBookProfile(bookId, profile) : Promise.resolve(profile),
        isAudienceDirty ? updateBookAudience(bookId, audience) : Promise.resolve(audience),
      ]);
      setProfile(updatedProfile);
      setOriginalProfile(structuredClone(updatedProfile));
      setAudience(updatedAudience);
      setOriginalAudience(structuredClone(updatedAudience));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originalProfile) setProfile(structuredClone(originalProfile));
    if (originalAudience) setAudience(structuredClone(originalAudience));
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !book || !profile) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p>{error ?? '数据不存在'}</p>
        <Button variant="outline" onClick={() => history.push('/novel')}>返回书架</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3.5 bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => history.push(`/novel/book/${bookId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-bold tracking-tight">写作手册</h1>
              <span className="text-sm text-muted-foreground">—《{book.title}》</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-sm text-emerald-600">
              <Check className="h-4 w-4" />
              已保存
            </span>
          )}
          {isDirty && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={handleReset}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重置修改
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1"
            disabled={!isDirty || saving}
            onClick={handleSave}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? '保存中...' : '保存修改'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="w-full grid grid-cols-2 mb-6">
              <TabsTrigger value="profile">写作档案</TabsTrigger>
              <TabsTrigger value="audience">受众策略</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-6">
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="flex items-start gap-3 p-4">
                  <FileEdit className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-amber-800 space-y-1.5">
                    <p className="font-medium">关于写作手册</p>
                    <p>写作手册是 AI 创建书籍时根据题材和读者画像自动生成的创作指南，相当于给 AI 写手的「操作手册」。它贯穿整个章节生成流水线——从写作、评审到修改的每个环节都会参照这份手册。</p>
                    <p>每个模块旁标注了<span className="font-medium text-rose-700">风险等级</span>，帮助你了解修改该项对后续章节的影响程度。展开模块后顶部有详细的功能说明和修改影响提示。</p>
                  </div>
                </CardContent>
              </Card>

              <ProfileEditor
                profile={profile}
                onChange={setProfile}
              />
            </TabsContent>

            <TabsContent value="audience" className="space-y-6">
              <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="flex items-start gap-3 p-4">
                  <FileEdit className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-blue-800 space-y-1.5">
                    <p className="font-medium">关于受众策略</p>
                    <p>受众策略定义了本书的目标读者群体以及对应的叙事偏好。它会直接影响 Agent 在规划情节、描写角色互动和设定悬念时的侧重点。</p>
                  </div>
                </CardContent>
              </Card>

              {audience && (
                <AudienceEditor
                  audience={audience}
                  onChange={setAudience}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
};

export default ProfilePage;

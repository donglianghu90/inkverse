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
  type BookPromptProfile,
  type BookInfo,
} from '@/services/novel';
import ProfileEditor from '../ProfileEditor';

const ProfilePage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<BookInfo | null>(null);
  const [profile, setProfile] = useState<BookPromptProfile | null>(null);
  const [originalProfile, setOriginalProfile] = useState<BookPromptProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isDirty = JSON.stringify(profile) !== JSON.stringify(originalProfile);

  const fetchData = useCallback(async () => {
    if (!bookId) return;
    try {
      const [bookInfo, profileData] = await Promise.all([
        getBook(bookId),
        getBookProfile(bookId),
      ]);
      setBook(bookInfo);
      setProfile(profileData);
      setOriginalProfile(structuredClone(profileData));
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
    if (!bookId || !profile) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateBookProfile(bookId, profile);
      setProfile(updated);
      setOriginalProfile(structuredClone(updated));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originalProfile) {
      setProfile(structuredClone(originalProfile));
    }
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
          <Card className="border-amber-200 bg-amber-50/50 mb-6">
            <CardContent className="flex items-start gap-3 p-4">
              <FileEdit className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium mb-1">关于写作手册</p>
                <p>
                  写作手册是 AI 在创建书籍时根据题材和读者自动生成的指导文档。
                  它控制着写手的语气、节奏、正反例参考、爽感类型定义、钩子类型、套话黑名单、评审标准等。
                  修改这些内容会直接影响后续所有章节的生成质量。
                </p>
              </div>
            </CardContent>
          </Card>

          <ProfileEditor
            profile={profile}
            onChange={setProfile}
          />
        </div>
      </ScrollArea>
    </div>
  );
};

export default ProfilePage;

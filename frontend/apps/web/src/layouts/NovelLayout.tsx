import React, { useEffect, useState, useMemo } from 'react';
import { Outlet, history, useLocation } from '@umijs/max';
import { BookOpen, PenTool, Sun, Moon, LogOut, ChevronDown, Plus, Menu, X, Sparkles, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDarkMode } from '@/hooks/useDarkMode';
import { isAuthenticated, getSavedUser, clearAuth, logout as apiLogout, UserInfo } from '@/services/auth';
import { cn } from '@/lib/utils';

const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-rose-500 to-pink-500',
  'from-amber-500 to-orange-500',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-purple-500',
  'from-teal-500 to-emerald-600',
  'from-red-500 to-rose-600',
  'from-sky-500 to-indigo-500',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function UserAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initial = (name || '?')[0].toUpperCase();
  const gradient = AVATAR_GRADIENTS[hashStr(name || '') % AVATAR_GRADIENTS.length];
  const cls = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs';
  return (
    <div className={cn(
      'rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-white shadow-sm select-none shrink-0',
      gradient, cls,
    )}>
      {initial}
    </div>
  );
}

const NovelLayout: React.FC = () => {
  const { isDark, toggle } = useDarkMode();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  const isBookshelf = location.pathname === '/novel';

  const joinDate = useMemo(() => {
    try {
      const raw = localStorage.getItem('user_info');
      if (!raw) return '';
      const info = JSON.parse(raw);
      if (info.createdAt) return new Date(info.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) + '加入';
    } catch {}
    return '创作者';
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      history.push('/login');
      return;
    }
    setUser(getSavedUser());
  }, []);

  useEffect(() => {
    setShowMenu(false);
    setMobileNav(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    try { await apiLogout(); } catch {}
    clearAuth();
    history.push('/login');
  };

  if (!isAuthenticated()) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
          <div className="h-0.5 bg-gradient-to-r from-primary/80 via-primary/40 to-transparent" />
          <div className="flex h-14 items-center justify-between px-4 sm:px-6">
            <div
              className="flex items-center gap-2 cursor-pointer group shrink-0"
              onClick={() => history.push('/novel')}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/80 shadow-sm shadow-primary/25 transition-shadow group-hover:shadow-md group-hover:shadow-primary/30">
                <PenTool className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold tracking-tight">InkVerse</span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase hidden sm:inline">
                创作平台
              </span>
            </div>

            {/* Desktop nav */}
            <nav className="hidden sm:flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => history.push('/novel')}
                className={cn(
                  'gap-1.5 transition-colors',
                  isBookshelf && 'bg-primary/8 text-primary hover:bg-primary/12 hover:text-primary',
                )}
              >
                <BookOpen className="h-4 w-4" />
                我的书架
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => history.push('/novel/create')}
                className={cn(
                  'gap-1.5 transition-colors',
                  location.pathname === '/novel/create' && 'bg-primary/8 text-primary hover:bg-primary/12 hover:text-primary',
                )}
              >
                <Plus className="h-4 w-4" />
                创建新书
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => history.push('/novel/templates')}
                className={cn(
                  'gap-1.5 transition-colors',
                  location.pathname === '/novel/templates' && 'bg-primary/8 text-primary hover:bg-primary/12 hover:text-primary',
                )}
              >
                <Palette className="h-4 w-4" />
                题材模板
              </Button>

              <div className="w-px h-5 bg-border mx-1.5" />

              <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8 rounded-lg">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className={cn(
                    'flex items-center gap-2 px-1.5 py-1 rounded-full transition-all',
                    showMenu
                      ? 'bg-accent ring-2 ring-primary/20'
                      : 'hover:bg-accent',
                  )}
                >
                  <UserAvatar name={user?.username || '?'} size="sm" />
                  <span className="text-sm font-medium text-foreground max-w-[100px] truncate">
                    {user?.username || '用户'}
                  </span>
                  <ChevronDown className={cn(
                    'w-3 h-3 text-muted-foreground transition-transform duration-200 mr-0.5',
                    showMenu && 'rotate-180',
                  )} />
                </button>

                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl border bg-card shadow-2xl shadow-black/10 dark:shadow-black/30 animate-scale-in overflow-hidden">
                      {/* Profile header */}
                      <div className="px-4 pt-5 pb-4 bg-gradient-to-b from-primary/5 to-transparent">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={user?.username || '?'} size="lg" />
                          <div className="min-w-0 flex-1">
                            <p className="text-base font-bold text-card-foreground truncate">
                              {user?.username || '用户'}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Sparkles className="w-3 h-3 text-primary" />
                              <span className="text-xs text-muted-foreground">{joinDate || '创作者'}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="h-px bg-border" />

                      {/* Menu items */}
                      <div className="p-1.5">
                        <button
                          onClick={() => { setShowMenu(false); history.push('/novel'); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-card-foreground hover:bg-accent rounded-lg transition-colors"
                        >
                          <BookOpen className="w-4 h-4 text-muted-foreground" />
                          我的书架
                        </button>
                        <button
                          onClick={() => { setShowMenu(false); history.push('/novel/create'); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-card-foreground hover:bg-accent rounded-lg transition-colors"
                        >
                          <Plus className="w-4 h-4 text-muted-foreground" />
                          创建新书
                        </button>
                        <button
                          onClick={() => { setShowMenu(false); history.push('/novel/templates'); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-card-foreground hover:bg-accent rounded-lg transition-colors"
                        >
                          <Palette className="w-4 h-4 text-muted-foreground" />
                          题材模板
                        </button>
                        <button
                          onClick={toggle}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-card-foreground hover:bg-accent rounded-lg transition-colors"
                        >
                          <span className="flex items-center gap-2.5">
                            {isDark ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
                            {isDark ? '浅色模式' : '深色模式'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                            {isDark ? '☀' : '🌙'}
                          </span>
                        </button>
                      </div>

                      <div className="h-px bg-border mx-3" />

                      <div className="p-1.5">
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/8 rounded-lg transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          退出登录
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </nav>

            {/* Mobile nav toggle */}
            <div className="flex items-center gap-1 sm:hidden">
              <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8 rounded-lg">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => setMobileNav(!mobileNav)}
              >
                {mobileNav ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {/* Mobile nav panel */}
          {mobileNav && (
            <div className="sm:hidden border-t bg-background animate-slide-up">
              <div className="px-4 py-3 space-y-1">
                <button
                  onClick={() => history.push('/novel')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isBookshelf ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
                  )}
                >
                  <BookOpen className="h-4 w-4" />
                  我的书架
                </button>
                <button
                  onClick={() => history.push('/novel/create')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    location.pathname === '/novel/create' ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
                  )}
                >
                  <Plus className="h-4 w-4" />
                  创建新书
                </button>
                <button
                  onClick={() => history.push('/novel/templates')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    location.pathname === '/novel/templates' ? 'bg-primary/10 text-primary' : 'hover:bg-accent',
                  )}
                >
                  <Palette className="h-4 w-4" />
                  题材模板
                </button>
                <div className="border-t my-2" />
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <UserAvatar name={user?.username || '?'} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{user?.username || '用户'}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Sparkles className="w-3 h-3 text-primary" />
                      <span className="text-xs text-muted-foreground">{joinDate || '创作者'}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="flex-1">
          <Outlet />
        </main>

        {(isBookshelf || location.pathname === '/novel/create' || location.pathname === '/novel/templates') && (
          <footer className="border-t py-4 text-center text-xs text-muted-foreground/50">
            InkVerse &copy; {new Date().getFullYear()} &middot; AI 小说创作平台
          </footer>
        )}
      </div>
    </TooltipProvider>
  );
};

export default NovelLayout;

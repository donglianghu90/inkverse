import React, { useEffect, useState } from 'react';
import { Outlet, history, useLocation } from '@umijs/max';
import { BookOpen, PenTool, Sun, Moon, LogOut, User, ChevronDown, Plus, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDarkMode } from '@/hooks/useDarkMode';
import { isAuthenticated, getSavedUser, clearAuth, logout as apiLogout, UserInfo } from '@/services/auth';
import { cn } from '@/lib/utils';

const NovelLayout: React.FC = () => {
  const { isDark, toggle } = useDarkMode();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  const isBookshelf = location.pathname === '/novel';

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

              <div className="w-px h-5 bg-border mx-1.5" />

              <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8 rounded-lg">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/20">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground max-w-[100px] truncate">
                    {user?.username || '用户'}
                  </span>
                  <ChevronDown className={cn(
                    'w-3 h-3 text-muted-foreground transition-transform duration-200',
                    showMenu && 'rotate-180',
                  )} />
                </button>

                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-xl border bg-card shadow-xl animate-scale-in py-1.5">
                      <div className="px-3.5 py-2.5 border-b">
                        <p className="text-sm font-semibold text-card-foreground truncate">
                          {user?.username}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{user?.role || '创作者'}</p>
                      </div>
                      <div className="py-1">
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors rounded-md mx-auto"
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
                <div className="border-t my-2" />
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/20">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user?.username || '用户'}</p>
                    <p className="text-xs text-muted-foreground">{user?.role || '创作者'}</p>
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
      </div>
    </TooltipProvider>
  );
};

export default NovelLayout;

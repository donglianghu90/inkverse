import React, { useEffect, useState } from 'react';
import { Outlet, history } from '@umijs/max';
import { BookOpen, PenTool, Sun, Moon, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDarkMode } from '@/hooks/useDarkMode';
import { isAuthenticated, getSavedUser, clearAuth, logout as apiLogout, UserInfo } from '@/services/auth';

const NovelLayout: React.FC = () => {
  const { isDark, toggle } = useDarkMode();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      history.push('/login');
      return;
    }
    setUser(getSavedUser());
  }, []);

  const handleLogout = async () => {
    try { await apiLogout(); } catch {}
    clearAuth();
    history.push('/login');
  };

  if (!isAuthenticated()) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-14 items-center justify-between px-6">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => history.push('/novel')}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <PenTool className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold tracking-tight">InkVerse</span>
              <span className="text-xs text-muted-foreground font-medium ml-1">创作平台</span>
            </div>

            <nav className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => history.push('/novel')}
                className="gap-1.5"
              >
                <BookOpen className="h-4 w-4" />
                我的书架
              </Button>
              <Button variant="ghost" size="icon" onClick={toggle} className="h-9 w-9">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              {/* 用户菜单 */}
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground max-w-[100px] truncate">
                    {user?.username || '用户'}
                  </span>
                </button>

                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border bg-card shadow-lg py-1">
                      <div className="px-3 py-2 border-b">
                        <p className="text-sm font-medium text-card-foreground truncate">
                          {user?.username}
                        </p>
                        <p className="text-xs text-muted-foreground">{user?.role}</p>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        退出登录
                      </button>
                    </div>
                  </>
                )}
              </div>
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
};

export default NovelLayout;

import React, { useState } from 'react';
import { history } from '@umijs/max';
import { message } from 'antd';
import { BookOpen, Sparkles, Eye, EyeOff } from 'lucide-react';
import { login, register, saveAuth, LoginParams } from '@/services/auth';

type Mode = 'login' | 'register';

const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState<LoginParams>({ username: '', password: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password) {
      message.warning('请填写用户名和密码');
      return;
    }
    if (form.username.length < 3) {
      message.warning('用户名至少 3 个字符');
      return;
    }
    if (form.password.length < 6) {
      message.warning('密码至少 6 个字符');
      return;
    }

    setLoading(true);
    try {
      const fn = mode === 'login' ? login : register;
      const result = await fn(form);
      saveAuth(result);
      message.success(mode === 'login' ? '登录成功' : '注册成功');
      history.push('/novel');
    } catch (err: any) {
      const msg = err?.data?.message || err?.response?.data?.message || err?.message || '操作失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-violet-50 via-white to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-violet-950">
      {/* 左侧品牌区 */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600 to-purple-700" />
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
        }} />
        <div className="relative z-10 text-center text-white px-12 max-w-lg">
          <div className="flex items-center justify-center mb-8">
            <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <BookOpen className="w-10 h-10 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4">InkVerse</h1>
          <p className="text-xl text-white/80 mb-6">AI 驱动的智能小说创作平台</p>
          <div className="space-y-4 text-left">
            <Feature icon={<Sparkles className="w-5 h-5" />} text="一键生成完整故事世界观" />
            <Feature icon={<Sparkles className="w-5 h-5" />} text="AI 智能续写，章章精彩" />
            <Feature icon={<Sparkles className="w-5 h-5" />} text="角色关系图谱可视化" />
            <Feature icon={<Sparkles className="w-5 h-5" />} text="自动连载，持续创作" />
          </div>
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* 移动端 Logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <BookOpen className="w-7 h-7 text-white" />
            </div>
            <span className="text-2xl font-bold ml-3 text-foreground">InkVerse</span>
          </div>

          <div className="bg-card rounded-2xl shadow-xl border border-border p-8">
            <h2 className="text-2xl font-bold text-center text-card-foreground mb-2">
              {mode === 'login' ? '欢迎回来' : '创建账号'}
            </h2>
            <p className="text-muted-foreground text-center mb-8">
              {mode === 'login' ? '登录你的创作空间' : '开始你的创作之旅'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-1.5">
                  用户名
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground
                    placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring
                    transition-colors"
                  placeholder="输入用户名（至少 3 个字符）"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-1.5">
                  密码
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground
                      placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring
                      transition-colors pr-12"
                    placeholder="输入密码（至少 6 个字符）"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium
                  hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                  transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading
                  ? (mode === 'login' ? '登录中...' : '注册中...')
                  : (mode === 'login' ? '登  录' : '注  册')}
              </button>
            </form>

            <div className="mt-6 text-center">
              <span className="text-sm text-muted-foreground">
                {mode === 'login' ? '没有账号？' : '已有账号？'}
              </span>
              <button
                type="button"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className="text-sm text-primary font-medium ml-1 hover:underline"
              >
                {mode === 'login' ? '立即注册' : '去登录'}
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            InkVerse &copy; {new Date().getFullYear()} · AI 小说创作平台
          </p>
        </div>
      </div>
    </div>
  );
};

const Feature: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex items-center space-x-3">
    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
      {icon}
    </div>
    <span className="text-white/90">{text}</span>
  </div>
);

export default LoginPage;

import { history } from '@umijs/max';
import { ArrowLeft, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import notFoundImg from '@/assets/illustrations/404-illustration.png';

const NotFoundPage: React.FC = () => (
  <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
    <img src={notFoundImg} alt="" className="w-64 h-auto mb-6 pointer-events-none select-none" draggable={false} />
    <h1 className="text-5xl font-extrabold text-primary mb-2 tracking-tight">404</h1>
    <p className="text-lg text-muted-foreground mb-1">哎呀，这一页还没有被写出来</p>
    <p className="text-sm text-muted-foreground/70 mb-8">你访问的故事章节似乎走丢了...</p>
    <div className="flex gap-3">
      <Button variant="outline" className="gap-2" onClick={() => history.go(-1)}>
        <ArrowLeft className="h-4 w-4" />
        返回上页
      </Button>
      <Button className="gap-2" onClick={() => history.push('/novel')}>
        <Home className="h-4 w-4" />
        回到书架
      </Button>
    </div>
  </div>
);

export default NotFoundPage;

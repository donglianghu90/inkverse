export default [
  {
    path: '/login',
    layout: false,
    component: './Login',
  },
  {
    path: '/',
    redirect: '/novel',
  },
  {
    path: '/novel',
    layout: false,
    component: '@/layouts/NovelLayout',
    routes: [
      { path: '/novel', component: './Novel/Bookshelf' },
      { path: '/novel/create', component: './Novel/CreateBook' },
      { path: '/novel/book/:bookId', component: './Novel/Workbench' },
      { path: '/novel/book/:bookId/world', component: './Novel/WorldBible' },
    ],
  },
  {
    component: './404',
  },
];

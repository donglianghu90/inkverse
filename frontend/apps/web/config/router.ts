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
      { path: '/novel/dramas', component: './Novel/DramaShelf' },
      { path: '/novel/create', component: './Novel/CreateBook' },
      { path: '/novel/create-drama', component: './Novel/CreateDrama' },
      { path: '/novel/templates', component: './Novel/GenreTemplates' },
      { path: '/novel/book/:bookId', component: './Novel/Workbench' },
      { path: '/novel/book/:bookId/world', component: './Novel/WorldBible' },
      { path: '/novel/book/:bookId/profile', component: './Novel/ProfilePage' },
      { path: '/novel/book/:bookId/pipeline', component: './Novel/Pipeline' },
      { path: '/novel/drama/:dramaId', component: './Novel/DramaWorkbench' },
      { path: '/novel/drama/:dramaId/episodes/:episodeNumber', component: './Novel/EpisodeProductionBoard' },
      { path: '/novel', component: './Novel/Bookshelf' },
    ],
  },
  {
    component: './404',
  },
];

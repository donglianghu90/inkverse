import { defineConfig } from '@umijs/max';
import proxy from './proxy';
import router from './router';

const { REACT_APP_ENV } = process.env;

const config: any = defineConfig({
  title: 'InkVerse - AI 小说创作平台',

  routes: router,

  proxy: proxy[(REACT_APP_ENV || 'dev') as keyof typeof proxy],

  npmClient: 'pnpm',

  hash: true,

  antd: {},

  extraPostCSSPlugins: [
    require('tailwindcss'),
    require('autoprefixer'),
  ],

  model: {},

  initialState: {},

  request: {},

  fastRefresh: true,

  devtool: REACT_APP_ENV === 'prd' ? 'source-map' : 'eval-cheap-module-source-map',

  mfsu: false,

  mock: {
    include: ['mock/**/*'],
  },

  codeSplitting: {
    jsStrategy: 'granularChunks',
  },
});

export default config;

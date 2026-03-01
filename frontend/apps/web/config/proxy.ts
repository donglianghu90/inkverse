/**
 * 代理配置
 * 在开发环境下将 API 请求代理到后端服务
 */
export default {
  dev: {
    '/api/novel': {
      target: 'http://localhost:8099',
      changeOrigin: true,
      pathRewrite: { '^/api/novel': '/api/inkverse/novel' },
      timeout: 900_000,
      proxyTimeout: 900_000,
    },
    '/api/drama': {
      target: 'http://localhost:8099',
      changeOrigin: true,
      pathRewrite: { '^/api/drama': '/api/inkverse/drama' },
      timeout: 900_000,
      proxyTimeout: 900_000,
    },
    '/api/auth': {
      target: 'http://localhost:8099',
      changeOrigin: true,
      pathRewrite: { '^/api/auth': '/api/inkverse/admin/auth' },
    },
  },

  // 测试环境
  test: {
    '/api': {
      target: 'http://test.example.com',
      changeOrigin: true,
      pathRewrite: { '^/api': '/api' },
    },
  },

  // 生产环境
  prd: {
    '/api': {
      target: 'https://api.example.com',
      changeOrigin: true,
      pathRewrite: { '^/api': '/api' },
    },
  },
};

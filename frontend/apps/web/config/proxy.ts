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
      timeout: 900_000,      // SSE/LLM长连接需要足够超时
      proxyTimeout: 900_000, // 代理端也需要
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

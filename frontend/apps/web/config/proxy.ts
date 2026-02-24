/**
 * 代理配置
 * 在开发环境下将 API 请求代理到后端服务
 */
export default {
  // 开发环境
  dev: {
    '/api/erp': {
      target: 'http://localhost:8082',
      changeOrigin: true,
      pathRewrite: { '^/api/erp': '/api' },
    },
    '/api/novel': {
      target: 'http://localhost:8081',
      changeOrigin: true,
      pathRewrite: { '^/api/novel': '/api/inkverse/novel' },
    },
    '/api/auth': {
      target: 'http://localhost:8081',
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

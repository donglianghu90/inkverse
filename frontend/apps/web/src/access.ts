/**
 * @description 权限定义
 */
export default function access(initialState: { currentUser?: API.CurrentUser } | undefined) {
  const { currentUser } = initialState ?? {};

  return {
    // 是否登录
    canLogin: !!currentUser,
    // 是否可以访问管理页面
    canAdmin: currentUser && currentUser?.id === '00000001',
  };
}

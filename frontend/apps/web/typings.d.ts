import '@umijs/max/typings';

declare module '*.less' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

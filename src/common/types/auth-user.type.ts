export type AuthUser = {
  sub: string;
  email: string;
  tokenType: 'access' | 'refresh';
};

'use client';

import { useSearchParams } from 'next/navigation';
import { Notice } from './page';
import { buttonVariants } from './ui/button';

export function LoginForm() {
  const denied = useSearchParams().get('denied') === '1';
  return (
    <div className="flex flex-col gap-3">
      {denied && (
        <Notice role="alert">Войти не получилось: этот аккаунт GitHub не имеет доступа, или вход был прерван.</Notice>
      )}
      {/* A plain link on purpose: the sign-in route answers with a redirect to GitHub. */}
      <a href="/auth/login" className={buttonVariants({ size: 'lg' })}>
        Войти через GitHub
      </a>
    </div>
  );
}

import { Suspense } from 'react';
import { Guides } from '@/components/guides';

// A static shell: the guidelines come from /api/guides, which answers only to the owner.
export default function GuidesPage() {
  return (
    <Suspense>
      <Guides />
    </Suspense>
  );
}
